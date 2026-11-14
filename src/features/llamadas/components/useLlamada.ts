"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  diagnosticoVacio,
  EmpaquetadorPcm,
  hayQueDescartar,
  leerRutaElegida,
  OPCIONES_CANAL_PCM,
  type DiagnosticoDeLlamada,
} from "./audio-de-llamada";
import { mezclaParaLlamada, mezclaParaParlante } from "./puente-de-llamadas";
import { empezarTimbrado, pitidoDeContestada, pitidoDeFin, vibrar } from "./sonidos-de-llamada";

/**
 * Una llamada de WhatsApp hecha desde el CRM, sin salir de la pantalla.
 *
 * OJO con cómo viaja el audio, porque no es lo que uno supone: WaCalls NO usa pistas de audio de
 * WebRTC. El sonido va crudo —PCM de 16 kHz, mono, enteros de 16 bits— por un CANAL DE DATOS
 * llamado "pcm", en las dos direcciones (ver internal/app/session/bridge.go). Implementarlo con
 * `addTrack`/`ontrack`, que es lo normal, da una llamada que suena, conecta, y no se escucha a
 * nadie de ninguno de los dos lados: la señalización funciona pero el audio va por otro carril.
 *
 * De ahí el rodeo del AudioContext: hay que capturar el micrófono a mano, convertirlo a enteros y
 * mandarlo por el canal; y a la inversa, recibir enteros y reproducirlos. Los dos procesadores
 * (`/worklets/*.js`) son los mismos que usa el cliente original.
 *
 * El CRM solo hace de intermediario para el saludo inicial (por eso el token nunca llega acá).
 *
 * Llamada de tres: WaCalls solo llama de una persona a otra, así que para sumar a alguien se abre
 * una SEGUNDA llamada por otra línea del negocio y el hook hace de puente (puente-de-llamadas.ts).
 * Las dos comparten el micrófono y el AudioContext; lo que es de cada una (su id, su línea, su
 * conexión, su canal de sonido, su consulta de estado y su colgar) vive en un `Llamada`.
 */

/**
 * "sonando" dura hasta que el CLIENTE contesta, no hasta que se conecta el audio con WaCalls: eso
 * pasa casi enseguida y antes se tomaba como "ya contesto" (ver revisarEstado).
 * "terminada" es el rato en que el panel dice como termino antes de cerrarse.
 */
export type EstadoLlamada = "libre" | "marcando" | "sonando" | "hablando" | "terminada" | "cortando";

/** En qué va la persona agregada a la llamada (la segunda llamada de una llamada de tres). */
export type EstadoSegunda = "sonando" | "hablando" | "colgo" | "error";

export type SegundaLlamada = {
  numero: string;
  estado: EstadoSegunda;
  /** Con "colgo" o "error": cómo terminó, en palabras de la asesora. */
  motivo: string | null;
};

/** Cada cuanto se le pregunta a WaCalls en que va la llamada. */
const SONDEO_MS = 1000;
/** Cuanto queda a la vista el motivo del final antes de cerrar el panel. */
const MOTIVO_VISIBLE_MS = 4000;
/** Cuanto queda el "Contesto" junto al reloj. */
const CONTESTO_VISIBLE_MS = 3000;

/**
 * Como termino una llamada que NO se hablo, en palabras de la asesora. Las claves son los motivos
 * de WaCalls (internal/voip/core/types.go).
 */
function motivoSinHablar(endReason: string | null): string {
  switch (endReason) {
    case "timeout":
    case "do_not_disturb":
      return "No contestó";
    case "declined":
      return "Rechazó la llamada";
    case "busy":
      return "Ocupado: está en otra llamada";
    case "failed":
      return "La llamada no se pudo completar";
    default:
      return "La llamada terminó sin que contestara";
  }
}

function reloj(segundos: number) {
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
}

const FRECUENCIA = 16000;
const CANAL_PCM = "pcm";
/** Cada cuanto se mira la red durante la llamada. */
const REVISION_MS = 5000;
/**
 * El microfono, con el procesamiento de una llamada: sin cancelacion de eco, si la asesora usa
 * parlantes el cliente se escucha a si mismo y el control de ganancia termina bajando su voz.
 */
const RESTRICCIONES_MIC: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
};

type Opciones = {
  onError?: (mensaje: string) => void;
  onTerminada?: () => void;
};

/** Lo que se dice al marcar, ademas del destino. */
type OpcionesDeMarcado = {
  /** El destino es un identificador de WhatsApp, no un teléfono. */
  esOculto?: boolean;
  /**
   * Canal del chat: la llamada sale por SU numero. Llega al marcar y no en las opciones del hook,
   * porque la llamada es una sola para todo el CRM (LlamadaEnCurso.tsx) y cada chat tiene su linea.
   */
  channelId?: string | null;
};

/**
 * Todo lo que es de UNA llamada. La principal (con el cliente) y la segunda (la persona agregada)
 * tienen cada una la suya; el micrófono y el AudioContext son de las dos y viven en el hook.
 */
type Llamada = {
  callId: string | null;
  /*
    La linea con la que se INICIO la llamada, para todos los pasos que siguen.

    Solo "iniciar" mandaba el canal: conectar el audio, colgar y silenciar iban sin el, y el
    servidor los mandaba a la linea por defecto del negocio (Ventas 1). En Ventas 2 la llamada
    existia en otra linea, WaCalls contestaba "no such call" y la asesora veia "Esa llamada ya
    terminó" mientras al cliente le seguia sonando (Alex, 16-sep-2026). Se guarda aparte y no se
    lee de la prop: la llamada vive en SU linea aunque la pantalla cambie de chat en el medio.
  */
  canalRef: { current: string | undefined };
  /** La linea por la que salio de verdad (el `sessionId` que devuelve "iniciar"). */
  linea: string | null;
  /**
   * La segunda llamada no sale por la linea del chat: sus pedidos llevan `sessionId` (su linea) en
   * vez de `channelId`. La principal sigue mandando el canal, como siempre.
   */
  porSuLinea: boolean;
  pc: RTCPeerConnection | null;
  canal: RTCDataChannel | null;
  sondeo: number | null;
  revision: number | null;
  /** Veces que se busco la llamada en el historial de WaCalls sin encontrarla todavia. */
  busquedasEnHistorial: number;
  /** Lo que se cuenta del audio para saber despues si fue en los dos sentidos (audio-de-llamada.ts). */
  diagnostico: DiagnosticoDeLlamada;
  /** La ultima llamada cuyo diagnostico ya salio: cada llamada manda uno solo. */
  diagnosticoEnviadoDe: string | null;
  ultimoEnvio: number;
  ultimoRecibido: number;
  /** Lo recibido que espera la mezcla del puente (solo con la llamada de tres andando). */
  paraElPuente: Int16Array[];
  /** Desde cuándo se habla, para los segundos del diagnóstico de la segunda llamada. */
  hablandoDesde: number | null;
};

function nuevaLlamada(porSuLinea: boolean): Llamada {
  return {
    callId: null,
    canalRef: { current: undefined },
    linea: null,
    porSuLinea,
    pc: null,
    canal: null,
    sondeo: null,
    revision: null,
    busquedasEnHistorial: 0,
    diagnostico: diagnosticoVacio(),
    diagnosticoEnviadoDe: null,
    ultimoEnvio: 0,
    ultimoRecibido: 0,
    paraElPuente: [],
    hablandoDesde: null,
  };
}

/** A qué linea va cada pedido de esta llamada. */
function lineaDe(llamada: Llamada): { channelId?: string; sessionId?: string } {
  return llamada.porSuLinea ? { sessionId: llamada.linea ?? undefined } : { channelId: llamada.canalRef.current };
}

/** Suelta la conexión de una llamada (no el micrófono ni el AudioContext, que son de las dos). */
function cerrarConexion(llamada: Llamada) {
  if (llamada.sondeo !== null) {
    window.clearInterval(llamada.sondeo);
    llamada.sondeo = null;
  }
  if (llamada.revision !== null) {
    window.clearInterval(llamada.revision);
    llamada.revision = null;
  }
  llamada.pc?.close();
  llamada.pc = null;
  llamada.canal = null;
  llamada.callId = null;
  llamada.busquedasEnHistorial = 0;
  llamada.paraElPuente = [];
  llamada.hablandoDesde = null;
  llamada.ultimoEnvio = 0;
  llamada.ultimoRecibido = 0;
}

/**
 * Cuelga sin esperar respuesta, para cuando la pantalla se cierra o la llamada se desmonta.
 *
 * Antes, al desmontar solo se soltaba el micrófono de este lado: WaCalls nunca se enteraba y el
 * cliente quedaba timbrando o en una llamada muda. `sendBeacon` sale aunque la pestaña se esté
 * cerrando; si el navegador no lo tiene, `fetch` con `keepalive` hace lo mismo. Va el mismo cuerpo
 * que usa colgar(), a la misma ruta. `sessionId` solo va en la segunda llamada.
 */
function colgarSinEsperar(callId: string, channelId: string | undefined, sessionId?: string) {
  const cuerpo = JSON.stringify({ accion: "colgar", callId, channelId, sessionId });
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon("/api/wacalls/llamada", cuerpo)) {
        return;
      }
    }
    void fetch("/api/wacalls/llamada", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: cuerpo,
    }).catch(() => {});
  } catch {
    // Colgar al salir nunca puede romper el cierre de la pantalla.
  }
}

async function pedir(body: unknown) {
  const respuesta = await fetch("/api/wacalls/llamada", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = (await respuesta.json().catch(() => null)) as { error?: string; [k: string]: unknown } | null;
  if (!respuesta.ok) {
    throw new Error(data?.error || "No se pudo completar la operación.");
  }
  return data ?? {};
}

/** Un pedido de ESTA llamada, a su linea. */
function pedirEn(llamada: Llamada, body: Record<string, unknown>) {
  return pedir({ ...body, ...lineaDe(llamada) });
}

function aEnteros(pcm: Float32Array): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(pcm.length * 2));
  for (let i = 0; i < pcm.length; i += 1) {
    let s = pcm[i];
    if (Number.isNaN(s)) s = 0;
    else if (s > 1) s = 1;
    else if (s < -1) s = -1;
    view.setInt16(i * 2, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
  }
  return view.buffer;
}

function aFlotantes(buf: ArrayBuffer): Float32Array {
  const view = new DataView(buf);
  const n = Math.floor(buf.byteLength / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

/**
 * Espera a que el navegador termine de juntar rutas de red, con un tope.
 *
 * El tope existe porque un STUN que no responde puede dejar el proceso colgado para siempre, y es
 * preferible llamar con las rutas que se alcanzaron a juntar que no llamar nunca.
 */
function esperarRutas(pc: RTCPeerConnection, topeMs = 3000) {
  if (pc.iceGatheringState === "complete") {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const listo = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", listo);
        clearTimeout(temporizador);
        resolve();
      }
    };
    const temporizador = setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", listo);
      resolve();
    }, topeMs);
    pc.addEventListener("icegatheringstatechange", listo);
  });
}

/**
 * Abre la conexión de una llamada y su canal de sonido. El canal se crea ANTES de la oferta: si
 * no, no aparece en el saludo y del otro lado nunca llega el audio. Sin orden y sin reenvios: ver
 * audio-de-llamada.ts, es LA causa de que a veces el cliente no escuchara a la asesora.
 */
function abrirConexion(llamada: Llamada) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  llamada.pc = pc;
  const canal = pc.createDataChannel(CANAL_PCM, OPCIONES_CANAL_PCM);
  canal.binaryType = "arraybuffer";
  llamada.canal = canal;
  return { pc, canal };
}

/** El saludo con WaCalls: oferta, rutas de red y la respuesta que conecta el sonido. */
async function negociar(llamada: Llamada, pc: RTCPeerConnection, callId: string) {
  const oferta = await pc.createOffer();
  await pc.setLocalDescription(oferta);
  await esperarRutas(pc);

  const respuesta = (await pedirEn(llamada, {
    accion: "webrtc",
    callId,
    sdpOffer: pc.localDescription?.sdp ?? oferta.sdp,
  })) as { sdpAnswer?: string };

  if (!respuesta.sdpAnswer) {
    throw new Error("El servicio no devolvió el audio.");
  }
  await pc.setRemoteDescription({ type: "answer", sdp: respuesta.sdpAnswer });
}

/** Cada 5 s: cuanto paso de verdad por la red (sale en el diagnostico al colgar). */
function vigilarRed(llamada: Llamada, pc: RTCPeerConnection) {
  const diagnostico = llamada.diagnostico;
  llamada.revision = window.setInterval(() => {
    if (llamada.pc !== pc) {
      return;
    }
    void pc
      .getStats()
      .then((reporte) => {
        const reportes: Array<Record<string, unknown>> = [];
        reporte.forEach((r) => reportes.push(r as Record<string, unknown>));
        const ruta = leerRutaElegida(reportes);
        if (ruta) {
          diagnostico.bytesEnviadosRed = ruta.bytesEnviados;
          diagnostico.bytesRecibidosRed = ruta.bytesRecibidos;
          if (ruta.rttMs !== null) diagnostico.rttMs = ruta.rttMs;
        }
      })
      .catch(() => {});
  }, REVISION_MS);
}

/** Manda un paquete por el canal de sonido de una llamada, contando lo que pasa en el diagnostico. */
function enviarPcm(llamada: Llamada, paquete: ArrayBuffer, hablando: boolean) {
  const canal = llamada.canal;
  if (!canal || canal.readyState !== "open") {
    return;
  }
  const diagnostico = llamada.diagnostico;
  const cola = canal.bufferedAmount;
  if (cola > diagnostico.colaMaxima) diagnostico.colaMaxima = cola;
  // Con la red ahogada se tira audio NUEVO en vez de apilarlo: apilado llega tarde y
  // WaCalls lo descarta igual, despues de varios segundos de silencio para el cliente.
  if (hayQueDescartar(cola)) {
    diagnostico.descartados += 1;
    return;
  }
  try {
    canal.send(paquete);
  } catch {
    diagnostico.descartados += 1;
    return;
  }
  const ahora = performance.now();
  if (llamada.ultimoEnvio && hablando) {
    diagnostico.huecoMaximoEnviadoMs = Math.max(diagnostico.huecoMaximoEnviadoMs, Math.round(ahora - llamada.ultimoEnvio));
  }
  llamada.ultimoEnvio = ahora;
  diagnostico.enviados += 1;
}

/** Cuenta en el diagnostico un paquete que llegó por el canal de sonido de una llamada. */
function contarRecibido(llamada: Llamada, datos: ArrayBuffer, hablando: boolean) {
  const diagnostico = llamada.diagnostico;
  const ahora = performance.now();
  if (llamada.ultimoRecibido && hablando) {
    diagnostico.huecoMaximoRecibidoMs = Math.max(diagnostico.huecoMaximoRecibidoMs, Math.round(ahora - llamada.ultimoRecibido));
  }
  llamada.ultimoRecibido = ahora;
  diagnostico.recibidos += 1;
  diagnostico.bytesRecibidos += datos.byteLength;
}

/**
 * Guarda lo que llegó de una llamada hasta que el puente lo mezcle. Si se atrasa (la otra llamada
 * manda más rápido de lo que el micrófono marca el paso), se bota lo más viejo con la misma regla
 * que el canal de salida: mejor un corte corto que un retraso que crece.
 */
function guardarParaElPuente(llamada: Llamada, datos: ArrayBuffer) {
  llamada.paraElPuente.push(new Int16Array(datos, 0, Math.floor(datos.byteLength / 2)));
  let enCola = llamada.paraElPuente.reduce((total, paquete) => total + paquete.byteLength, 0);
  while (llamada.paraElPuente.length > 1 && hayQueDescartar(enCola)) {
    enCola -= llamada.paraElPuente.shift()?.byteLength ?? 0;
  }
}

/** El paquete más viejo que espera el puente, o silencio si no llegó nada. */
function sacarDelPuente(llamada: Llamada): Int16Array {
  return llamada.paraElPuente.shift() ?? new Int16Array(0);
}

/**
 * Deja en los registros del servidor cuanto audio fue y vino en la llamada. `keepalive` hace que
 * salga aunque la pestaña se este cerrando.
 */
function enviarDiagnostico(
  callId: string,
  linea: { channelId?: string; sessionId?: string },
  diagnostico: DiagnosticoDeLlamada,
  segundosHablados: number,
) {
  try {
    void fetch("/api/wacalls/llamada", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({ accion: "diagnostico", callId, ...linea, segundosHablados, diagnostico }),
    }).catch(() => {});
  } catch {
    // El diagnostico nunca puede romper el colgar.
  }
}

/** Una sola vez por llamada: cuanto audio fue y vino. */
function reportarDiagnosticoDe(llamada: Llamada, segundosHablados: number) {
  const callId = llamada.callId;
  if (!callId || llamada.diagnosticoEnviadoDe === callId) {
    return;
  }
  llamada.diagnosticoEnviadoDe = callId;
  enviarDiagnostico(callId, lineaDe(llamada), llamada.diagnostico, segundosHablados);
}

function segundosDesde(desde: number | null) {
  return desde === null ? 0 : Math.round((performance.now() - desde) / 1000);
}

function mensajeDeError(error: unknown, porDefecto: string) {
  return error instanceof DOMException && error.name === "NotAllowedError"
    ? "Hay que permitir el micrófono para poder llamar."
    : error instanceof Error
      ? error.message
      : porDefecto;
}

export function useLlamada({ onError, onTerminada }: Opciones = {}) {
  const [estado, setEstado] = useState<EstadoLlamada>("libre");
  const [silenciado, setSilenciado] = useState(false);
  const [segundos, setSegundos] = useState(0);
  /** Lo que dice el panel cuando la llamada termino sola: "No contesto", "Ocupado"... */
  const [motivoFin, setMotivoFin] = useState<string | null>(null);
  /** Los primeros segundos despues de que el cliente levanto, para decir "Contesto". */
  const [recienContesto, setRecienContesto] = useState(false);
  /** La persona agregada (llamada de tres). Solo se permite una. */
  const [segunda, setSegunda] = useState<SegundaLlamada | null>(null);

  /** La llamada con el cliente. */
  const principalRef = useRef<Llamada>(nuevaLlamada(false));
  /** La llamada con la persona agregada. Se cambia por una nueva cada vez que se agrega a alguien. */
  const segundaRef = useRef<Llamada>(nuevaLlamada(true));
  const estadoSegundaRef = useRef<EstadoSegunda | null>(null);
  /** El puente anda: las dos llamadas están hablando y el sonido pasa de una a la otra. */
  const puenteRef = useRef(false);
  const silenciadoRef = useRef(false);

  const micRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Lo que suena en el parlante de la asesora. Lo usa también el puente. */
  const reproduccionRef = useRef<AudioWorkletNode | null>(null);
  /** El estado leido desde los temporizadores, que no ven el `estado` de React actualizado. */
  const estadoRef = useRef<EstadoLlamada>("libre");
  const segundosRef = useRef(0);
  const apagarTimbradoRef = useRef<(() => void) | null>(null);
  const temporizadoresRef = useRef<number[]>([]);

  const cambiarEstado = useCallback((siguiente: EstadoLlamada) => {
    estadoRef.current = siguiente;
    setEstado(siguiente);
  }, []);

  const cambiarSegunda = useCallback((siguiente: SegundaLlamada | null) => {
    estadoSegundaRef.current = siguiente?.estado ?? null;
    setSegunda(siguiente);
  }, []);

  /**
   * Prende o apaga el puente. Mientras anda, el silencio de la asesora es SOLO de su micrófono: si
   * WaCalls silenciara la llamada del cliente, el cliente dejaría de oír a la persona agregada.
   * Por eso, si estaba silenciada, se le quita el silencio en WaCalls al prender y se le vuelve a
   * poner al apagar (el micrófono sigue cortado de este lado todo el tiempo).
   */
  const ponerPuente = useCallback((activo: boolean, avisarAWaCalls = true) => {
    if (puenteRef.current === activo) {
      return;
    }
    puenteRef.current = activo;
    const principal = principalRef.current;
    principal.paraElPuente = [];
    segundaRef.current.paraElPuente = [];
    if (avisarAWaCalls && silenciadoRef.current && principal.callId) {
      void pedirEn(principal, { accion: "silenciar", callId: principal.callId, muted: !activo }).catch(() => {});
    }
  }, []);

  /**
   * Deja constancia en el servidor de cuanto audio fue y vino. Es lo que permite contestar "¿el
   * cliente la escuchaba?" sin depender de lo que cada uno recuerde. Tambien sale con cero audio:
   * una llamada en la que no paso nada es justo la que hay que poder ver.
   */
  const reportarDiagnostico = useCallback(() => {
    reportarDiagnosticoDe(principalRef.current, segundosRef.current);
    const segundaLlamada = segundaRef.current;
    reportarDiagnosticoDe(segundaLlamada, segundosDesde(segundaLlamada.hablandoDesde));
  }, []);

  /**
   * Corta la segunda llamada (la persona agregada) y suelta su conexión. No espera a WaCalls: lo
   * de este lado se suelta enseguida. Devuelve el pedido por si alguien quiere esperarlo.
   * `seCortaTodo`: se va también la llamada con el cliente, así que no hay silencio que devolverle.
   */
  const soltarSegunda = useCallback((seCortaTodo = false) => {
    const llamada = segundaRef.current;
    // Una llamada nueva en su lugar: si "iniciar" todavía no volvió, al volver ve que ya no es
    // la de turno y cuelga lo que haya creado.
    segundaRef.current = nuevaLlamada(true);
    ponerPuente(false, !seCortaTodo);
    const callId = llamada.callId;
    reportarDiagnosticoDe(llamada, segundosDesde(llamada.hablandoDesde));
    const pedido = callId
      ? pedirEn(llamada, { accion: "colgar", callId }).then(
          () => {},
          () => {},
        )
      : Promise.resolve();
    cerrarConexion(llamada);
    return pedido;
  }, [ponerPuente]);

  /** Suelta micrófono, audio y conexión. Se llama al colgar y al desmontar. */
  const limpiar = useCallback(() => {
    apagarTimbradoRef.current?.();
    apagarTimbradoRef.current = null;
    // Sin la llamada con el cliente no hay llamada de tres: la persona agregada se corta también.
    void soltarSegunda(true);
    cambiarSegunda(null);
    const principal = principalRef.current;
    reportarDiagnostico();
    principal.diagnostico = diagnosticoVacio();
    // El micrófono se apaga SIEMPRE, incluso si algo falló antes: dejar la lucecita del micro
    // encendida después de colgar es lo que hace que la gente desconfíe de la herramienta.
    micRef.current?.getTracks().forEach((track) => track.stop());
    micRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    reproduccionRef.current = null;
    cerrarConexion(principal);
    principal.linea = null;
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
    silenciadoRef.current = false;
    setSilenciado(false);
    setSegundos(0);
    segundosRef.current = 0;
    setRecienContesto(false);
  }, [cambiarSegunda, reportarDiagnostico, soltarSegunda]);

  /** Si hay llamadas activas, le avisa a WaCalls que se cuelgan las dos (la pantalla se va). */
  const colgarAlSalir = useCallback(() => {
    for (const llamada of [principalRef.current, segundaRef.current]) {
      const callId = llamada.callId;
      if (callId) {
        const { channelId, sessionId } = lineaDe(llamada);
        colgarSinEsperar(callId, channelId, sessionId);
      }
    }
  }, []);

  useEffect(() => {
    const temporizadores = temporizadoresRef.current;
    // Al cerrar la pestaña React no desmonta nada: sin esto la llamada se quedaba sin diagnostico
    // y, peor, sin colgar del lado de WaCalls. Pasa por las dos llamadas.
    const alCerrarPantalla = () => {
      reportarDiagnostico();
      colgarAlSalir();
    };
    window.addEventListener("pagehide", alCerrarPantalla);
    return () => {
      window.removeEventListener("pagehide", alCerrarPantalla);
      colgarAlSalir();
      limpiar();
      temporizadores.forEach((id) => window.clearTimeout(id));
    };
  }, [colgarAlSalir, limpiar, reportarDiagnostico]);

  // Cronómetro de la conversación.
  useEffect(() => {
    if (estado !== "hablando") {
      return;
    }
    const intervalo = setInterval(() => {
      segundosRef.current += 1;
      setSegundos(segundosRef.current);
    }, 1000);
    return () => clearInterval(intervalo);
  }, [estado]);

  /**
   * La llamada termino sola (el cliente colgo, no contesto, rechazo...): el panel dice como
   * termino durante unos segundos y despues se cierra.
   */
  const terminarConMotivo = useCallback(
    (motivo: string) => {
      if (estadoRef.current === "terminada" || estadoRef.current === "libre") {
        return;
      }
      limpiar();
      pitidoDeFin();
      vibrar(300);
      setMotivoFin(motivo);
      cambiarEstado("terminada");
      const id = window.setTimeout(() => {
        if (estadoRef.current === "terminada") {
          setMotivoFin(null);
          cambiarEstado("libre");
          onTerminada?.();
        }
      }, MOTIVO_VISIBLE_MS);
      temporizadoresRef.current.push(id);
    },
    [cambiarEstado, limpiar, onTerminada],
  );

  /**
   * Le pregunta a WaCalls en que va la llamada. Es la UNICA fuente de "el cliente contesto".
   *
   * Antes se tomaba como contestada cuando se abria el canal de audio con WaCalls, que pasa casi
   * enseguida, con el telefono del cliente todavia timbrando: el marcador mostraba el reloj
   * corriendo y nadie hablaba del otro lado (Alex, 02-10-2026).
   */
  const revisarEstado = useCallback(async () => {
    const principal = principalRef.current;
    const callId = principal.callId;
    if (!callId) {
      return;
    }
    let respuesta: { status?: string; endReason?: string | null; enHistorial?: boolean };
    try {
      respuesta = (await pedirEn(principal, { accion: "estado", callId })) as typeof respuesta;
    } catch {
      // Un sondeo que falla no corta nada: se vuelve a preguntar en un segundo.
      return;
    }
    // Mientras se esperaba la respuesta pudieron colgar o empezar otra llamada.
    if (principal.callId !== callId) {
      return;
    }

    if (respuesta.status === "connected" && estadoRef.current === "sonando") {
      apagarTimbradoRef.current?.();
      apagarTimbradoRef.current = null;
      if (ctxRef.current) {
        pitidoDeContestada(ctxRef.current);
      }
      vibrar([120, 80, 120]);
      segundosRef.current = 0;
      setSegundos(0);
      setRecienContesto(true);
      cambiarEstado("hablando");
      const id = window.setTimeout(() => setRecienContesto(false), CONTESTO_VISIBLE_MS);
      temporizadoresRef.current.push(id);
      return;
    }

    if (respuesta.status === "ended") {
      // WaCalls pasa la llamada a su historial un instante despues de cortarla: si todavia no
      // aparece, se espera un par de vueltas antes de dar el motivo por desconocido.
      if (!respuesta.enHistorial && principal.busquedasEnHistorial < 3) {
        principal.busquedasEnHistorial += 1;
        return;
      }
      const hablaron = estadoRef.current === "hablando";
      terminarConMotivo(
        hablaron ? `Llamada terminada · ${reloj(segundosRef.current)}` : motivoSinHablar(respuesta.endReason ?? null),
      );
    }
  }, [cambiarEstado, terminarConMotivo]);

  const colgar = useCallback(async () => {
    // Con el motivo a la vista, el boton rojo solo cierra el panel: la llamada ya no existe.
    if (estadoRef.current === "terminada") {
      setMotivoFin(null);
      cambiarEstado("libre");
      onTerminada?.();
      return;
    }
    const principal = principalRef.current;
    const callId = principal.callId;
    cambiarEstado("cortando");
    // Colgar la principal cuelga también a la persona agregada, sin esperarla.
    void soltarSegunda(true);
    try {
      if (callId) {
        await pedirEn(principal, { accion: "colgar", callId });
      }
    } catch {
      // Si el servicio no contesta igual se corta de este lado: lo que no puede pasar es que la
      // asesora quede con el micrófono abierto porque el otro extremo falló.
    } finally {
      limpiar();
      cambiarEstado("libre");
      onTerminada?.();
    }
  }, [cambiarEstado, limpiar, onTerminada, soltarSegunda]);

  /**
   * El puente, un paquete de 20 ms del micrófono a la vez (el micrófono marca el paso): a cada
   * llamada va el micrófono más lo de la otra, y al parlante las dos juntas.
   */
  const puentear = useCallback((paquete: Float32Array) => {
    const principal = principalRef.current;
    const segundaLlamada = segundaRef.current;
    const microfono = new Int16Array(aEnteros(paquete));
    const deA = sacarDelPuente(principal);
    const deB = sacarDelPuente(segundaLlamada);
    const silenciado = silenciadoRef.current;
    enviarPcm(principal, mezclaParaLlamada({ microfono, otraLlamada: deB, silenciado }).buffer as ArrayBuffer, true);
    enviarPcm(segundaLlamada, mezclaParaLlamada({ microfono, otraLlamada: deA, silenciado }).buffer as ArrayBuffer, true);
    const parlante = mezclaParaParlante(deA, deB);
    if (parlante.length > 0) {
      reproduccionRef.current?.port.postMessage(aFlotantes(parlante.buffer as ArrayBuffer));
    }
  }, []);

  const llamar = useCallback(
    async (telefono: string, { esOculto = false, channelId }: OpcionesDeMarcado = {}) => {
      // Se lee del ref y no del estado de React: la llamada es una sola para todo el CRM y dos
      // toques seguidos no pueden armar dos llamadas.
      // (El `as` evita que TypeScript dé por fijo "libre" el resto de la función: el ref cambia.)
      if ((estadoRef.current as EstadoLlamada) !== "libre") {
        return;
      }
      setMotivoFin(null);
      cambiarEstado("marcando");
      const principal = principalRef.current;
      try {
        const mic = await navigator.mediaDevices.getUserMedia(RESTRICCIONES_MIC);
        micRef.current = mic;
        principal.diagnostico = diagnosticoVacio();

        // La linea queda fijada ANTES de iniciar: si algo falla despues, el colgar va a la misma.
        principal.canalRef.current = channelId ?? undefined;
        const iniciada = (await pedir({
          accion: "iniciar",
          ...(esOculto ? { lid: telefono } : { phone: telefono }),
          channelId: principal.canalRef.current,
        })) as { callId?: string; sessionId?: string };
        const callId = iniciada.callId;
        if (!callId) {
          throw new Error("El servicio no devolvió la llamada.");
        }
        principal.callId = callId;
        // La linea usada de verdad: la segunda llamada de una llamada de tres sale por otra.
        principal.linea = iniciada.sessionId ?? null;
        cambiarEstado("sonando");

        const { pc, canal } = abrirConexion(principal);

        const ctx = new AudioContext({ sampleRate: FRECUENCIA });
        ctxRef.current = ctx;
        // Si el sistema suspende el audio (otra app tomo el parlante, el celular bloqueo la
        // pantalla), se vuelve a encender: suspendido, no sale ni entra nada.
        ctx.onstatechange = () => {
          if (ctxRef.current === ctx && ctx.state !== "running" && ctx.state !== "closed") {
            void ctx.resume().catch(() => {});
          }
        };
        await ctx.audioWorklet.addModule("/worklets/capture-processor.js");
        await ctx.audioWorklet.addModule("/worklets/playback-processor.js");
        await ctx.resume();

        // "Tuuu... tuuu..." hasta que el cliente conteste, y desde ya se pregunta en que va.
        if (estadoRef.current === "sonando") {
          apagarTimbradoRef.current = empezarTimbrado(ctx);
        }
        principal.sondeo = window.setInterval(() => void revisarEstado(), SONDEO_MS);

        // Micrófono → canal de datos, en paquetes de 20 ms. Con la llamada de tres andando, el
        // paquete pasa por el puente en vez de ir derecho.
        const empaquetador = new EmpaquetadorPcm();
        const captura = new AudioWorkletNode(ctx, "capture-processor");
        captura.port.onmessage = (evento: MessageEvent<Float32Array>) => {
          if (puenteRef.current) {
            for (const paquete of empaquetador.agregar(evento.data)) {
              puentear(paquete);
            }
            return;
          }
          if (canal.readyState !== "open") {
            return;
          }
          for (const paquete of empaquetador.agregar(evento.data)) {
            enviarPcm(principal, aEnteros(paquete), estadoRef.current === "hablando");
          }
        };
        let fuenteMic = ctx.createMediaStreamSource(mic);
        fuenteMic.connect(captura);

        /*
          Si el microfono se apaga solo (se desconecto el auricular, otro programa lo tomo), antes
          la llamada seguia "andando" y el cliente dejaba de escuchar sin que nadie se enterara.
          Ahora se pide de nuevo y se reconecta; si no se puede, se avisa.
        */
        const vigilarMicrofono = (stream: MediaStream) => {
          stream.getAudioTracks().forEach((pista) => {
            pista.addEventListener("ended", () => {
              if (micRef.current !== stream || ctxRef.current !== ctx) {
                return;
              }
              principal.diagnostico.microfonoCaido += 1;
              void navigator.mediaDevices
                .getUserMedia(RESTRICCIONES_MIC)
                .then((nuevo) => {
                  if (ctxRef.current !== ctx) {
                    nuevo.getTracks().forEach((t) => t.stop());
                    return;
                  }
                  // Si estaba silenciada, sigue silenciada.
                  const activo = pista.enabled;
                  nuevo.getAudioTracks().forEach((t) => {
                    t.enabled = activo;
                  });
                  fuenteMic.disconnect();
                  micRef.current = nuevo;
                  fuenteMic = ctx.createMediaStreamSource(nuevo);
                  fuenteMic.connect(captura);
                  vigilarMicrofono(nuevo);
                })
                .catch(() => {
                  onError?.("Se desconectó el micrófono: el cliente no te escucha. Revisa el auricular y vuelve a llamar.");
                });
            });
          });
        };
        vigilarMicrofono(mic);
        // El procesador no escribe nada en su salida; conectarlo al destino es lo que lo mantiene
        // vivo, no se escucha a si misma la asesora.
        captura.connect(ctx.destination);

        // Canal de datos → parlante (o al puente, con la llamada de tres andando).
        const reproduccion = new AudioWorkletNode(ctx, "playback-processor");
        reproduccionRef.current = reproduccion;
        const destino = ctx.createMediaStreamDestination();
        reproduccion.connect(destino);
        reproduccion.port.onmessage = (evento: MessageEvent<{ tipo: "corte"; objetivoMs: number }>) => {
          if (evento.data.tipo !== "corte" || estadoRef.current !== "hablando") {
            return;
          }
          principal.diagnostico.cortesReproduccion += 1;
          principal.diagnostico.objetivoColchonMaxMs = Math.max(principal.diagnostico.objetivoColchonMaxMs, evento.data.objetivoMs);
        };
        canal.onmessage = (evento: MessageEvent<ArrayBuffer>) => {
          contarRecibido(principal, evento.data, estadoRef.current === "hablando");
          if (puenteRef.current) {
            guardarParaElPuente(principal, evento.data);
            return;
          }
          reproduccion.port.postMessage(aFlotantes(evento.data));
        };

        vigilarRed(principal, pc);
        if (audioRef.current) {
          audioRef.current.srcObject = destino.stream;
          void audioRef.current.play().catch(() => {
            onError?.("El navegador bloqueó el audio. Toca la pantalla y vuelve a intentar.");
          });
        }

        // Que se abra el canal de audio NO quiere decir que el cliente contesto (ver revisarEstado).

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "failed" || pc.connectionState === "closed") {
            // Se corto el audio. Se le da al sondeo unos segundos para traer COMO termino (WaCalls
            // tarda un instante en pasarla a su historial) y, si no llega, se cuelga igual.
            void revisarEstado();
            const id = window.setTimeout(() => {
              if (principal.callId === callId && estadoRef.current !== "terminada" && estadoRef.current !== "libre") {
                void colgar();
              }
            }, 4000);
            temporizadoresRef.current.push(id);
          }
        };

        await negociar(principal, pc, callId);
      } catch (error) {
        onError?.(mensajeDeError(error, "No se pudo iniciar la llamada."));
        // Si ya se había creado la llamada del otro lado, se corta: si no, el número queda
        // sonando en el teléfono del cliente sin nadie del otro lado.
        if (principal.callId) {
          void pedirEn(principal, { accion: "colgar", callId: principal.callId }).catch(() => {});
        }
        limpiar();
        cambiarEstado("libre");
      }
    },
    [colgar, limpiar, onError, cambiarEstado, puentear, revisarEstado],
  );

  /** La persona agregada colgó (o se cortó): se suelta su llamada y se dice cómo terminó. */
  const terminarSegunda = useCallback(
    (llamada: Llamada, numero: string, motivo: string) => {
      if (segundaRef.current !== llamada) {
        return;
      }
      void soltarSegunda();
      pitidoDeFin();
      cambiarSegunda({ numero, estado: "colgo", motivo });
    },
    [cambiarSegunda, soltarSegunda],
  );

  /** En qué va la segunda llamada: lo mismo que revisarEstado, para la persona agregada. */
  const revisarSegunda = useCallback(
    async (llamada: Llamada, numero: string) => {
      const callId = llamada.callId;
      if (!callId) {
        return;
      }
      let respuesta: { status?: string; endReason?: string | null; enHistorial?: boolean };
      try {
        respuesta = (await pedirEn(llamada, { accion: "estado", callId })) as typeof respuesta;
      } catch {
        return;
      }
      if (segundaRef.current !== llamada || llamada.callId !== callId) {
        return;
      }
      if (respuesta.status === "connected" && estadoSegundaRef.current === "sonando") {
        if (ctxRef.current) {
          pitidoDeContestada(ctxRef.current);
        }
        llamada.hablandoDesde = performance.now();
        cambiarSegunda({ numero, estado: "hablando", motivo: null });
        ponerPuente(true);
        return;
      }
      if (respuesta.status === "ended") {
        if (!respuesta.enHistorial && llamada.busquedasEnHistorial < 3) {
          llamada.busquedasEnHistorial += 1;
          return;
        }
        const hablaron = estadoSegundaRef.current === "hablando";
        terminarSegunda(
          llamada,
          numero,
          hablaron ? `Salió de la llamada · ${reloj(segundosDesde(llamada.hablandoDesde))}` : motivoSinHablar(respuesta.endReason ?? null),
        );
      }
    },
    [cambiarSegunda, ponerPuente, terminarSegunda],
  );

  /**
   * Suma a otra persona a la llamada en curso (llamada de tres): la marca por OTRA linea del
   * negocio y, cuando contesta, el puente une el sonido de las dos llamadas. Si no hay otra linea
   * libre, avisa y la llamada con el cliente sigue igual.
   */
  const agregarPersona = useCallback(
    async (numero: string) => {
      const principal = principalRef.current;
      const ctx = ctxRef.current;
      if (estadoRef.current !== "hablando" || !principal.callId || !ctx) {
        onError?.("Para agregar a alguien, el cliente tiene que estar en la llamada.");
        return;
      }
      if (estadoSegundaRef.current === "sonando" || estadoSegundaRef.current === "hablando") {
        onError?.("Ya hay una persona agregada. Quítala para agregar a otra.");
        return;
      }
      const numeroLimpio = numero.trim();
      if (!numeroLimpio) {
        onError?.("Falta el número.");
        return;
      }

      const llamada = nuevaLlamada(true);
      segundaRef.current = llamada;
      cambiarSegunda({ numero: numeroLimpio, estado: "sonando", motivo: null });
      try {
        const iniciada = (await pedir({
          accion: "iniciar",
          phone: numeroLimpio,
          channelId: principal.canalRef.current,
          otraLineaDistintaDe: principal.linea ?? undefined,
        })) as { callId?: string; sessionId?: string };
        if (!iniciada.callId) {
          throw new Error("El servicio no devolvió la llamada.");
        }
        llamada.callId = iniciada.callId;
        llamada.linea = iniciada.sessionId ?? null;
        // Mientras se marcaba la quitaron, o se colgó la llamada con el cliente.
        if (segundaRef.current !== llamada || ctxRef.current !== ctx) {
          void pedirEn(llamada, { accion: "colgar", callId: iniciada.callId }).catch(() => {});
          cerrarConexion(llamada);
          return;
        }
        if (!llamada.linea) {
          throw new Error("El servicio no devolvió la línea de la llamada.");
        }
        const callId = iniciada.callId;

        const { pc, canal } = abrirConexion(llamada);
        // Lo que dice la persona agregada solo se oye con el puente andando (cuando contestó).
        canal.onmessage = (evento: MessageEvent<ArrayBuffer>) => {
          if (segundaRef.current !== llamada) {
            return;
          }
          contarRecibido(llamada, evento.data, estadoSegundaRef.current === "hablando");
          if (puenteRef.current) {
            guardarParaElPuente(llamada, evento.data);
          }
        };
        llamada.sondeo = window.setInterval(() => void revisarSegunda(llamada, numeroLimpio), SONDEO_MS);
        vigilarRed(llamada, pc);
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "failed" || pc.connectionState === "closed") {
            void revisarSegunda(llamada, numeroLimpio);
            const id = window.setTimeout(() => {
              if (segundaRef.current === llamada && llamada.callId === callId) {
                terminarSegunda(llamada, numeroLimpio, "Se cortó la llamada");
              }
            }, 4000);
            temporizadoresRef.current.push(id);
          }
        };

        await negociar(llamada, pc, callId);
      } catch (error) {
        const mensaje = mensajeDeError(error, "No se pudo agregar a la persona.");
        onError?.(mensaje);
        // Solo se toca la segunda llamada: la del cliente sigue tal cual.
        if (segundaRef.current === llamada) {
          void soltarSegunda();
          cambiarSegunda({ numero: numeroLimpio, estado: "error", motivo: mensaje });
        } else if (llamada.callId) {
          void pedirEn(llamada, { accion: "colgar", callId: llamada.callId }).catch(() => {});
          cerrarConexion(llamada);
        }
      }
    },
    [cambiarSegunda, onError, revisarSegunda, soltarSegunda, terminarSegunda],
  );

  /** Cuelga solo a la persona agregada; la llamada con el cliente sigue. */
  const quitarPersona = useCallback(async () => {
    if (estadoSegundaRef.current === null) {
      return;
    }
    const pedido = soltarSegunda();
    cambiarSegunda(null);
    await pedido;
  }, [cambiarSegunda, soltarSegunda]);

  const alternarSilencio = useCallback(async () => {
    const principal = principalRef.current;
    const callId = principal.callId;
    if (!callId) {
      return;
    }
    const siguiente = !silenciado;
    // Se corta el micrófono acá TAMBIÉN, sin esperar al servicio: si el pedido tarda, el cliente
    // seguiría escuchando durante ese rato a alguien que cree que ya se silenció.
    micRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !siguiente;
    });
    silenciadoRef.current = siguiente;
    setSilenciado(siguiente);
    // Con la llamada de tres andando, silenciar quita solo el micrófono: el puente sigue y el
    // cliente y la persona agregada se siguen oyendo (ver ponerPuente).
    if (puenteRef.current) {
      return;
    }
    try {
      await pedirEn(principal, { accion: "silenciar", callId, muted: siguiente });
    } catch {
      // El corte local ya ocurrió; que el servicio no se entere no cambia lo que se escucha.
    }
  }, [silenciado]);

  return {
    estado,
    silenciado,
    segundos,
    motivoFin,
    recienContesto,
    llamar,
    colgar,
    alternarSilencio,
    audioRef,
    segunda,
    agregarPersona,
    quitarPersona,
  };
}
