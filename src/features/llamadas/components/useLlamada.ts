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
import { ColaDeSonido, mezclaParaLlamada, mezclaParaParlante } from "./puente-de-llamadas";
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
 */

/**
 * "sonando" dura hasta que el CLIENTE contesta, no hasta que se conecta el audio con WaCalls: eso
 * pasa casi enseguida y antes se tomaba como "ya contesto" (ver revisarEstado).
 * "terminada" es el rato en que el panel dice como termino antes de cerrarse.
 */
export type EstadoLlamada = "libre" | "marcando" | "sonando" | "hablando" | "terminada" | "cortando";

/**
 * La persona agregada a la llamada (llamada de tres): "sonando" hasta que contesta, "hablando"
 * mientras esta en el puente, y como termino: "colgo" (ella, Alexander o la llamada principal) o
 * "error" (no se pudo marcar; `mensaje` dice por que, por ejemplo que no hay otra linea libre).
 */
export type EstadoSegunda = "sonando" | "hablando" | "colgo" | "error";

export type SegundaLlamada = {
  numero: string;
  estado: EstadoSegunda;
  /** Por que termino o fallo, en palabras de la asesora. */
  mensaje: string | null;
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
 * Cuelga sin esperar respuesta, para cuando la pantalla se cierra o la llamada se desmonta.
 *
 * Antes, al desmontar solo se soltaba el micrófono de este lado: WaCalls nunca se enteraba y el
 * cliente quedaba timbrando o en una llamada muda. `sendBeacon` sale aunque la pestaña se esté
 * cerrando; si el navegador no lo tiene, `fetch` con `keepalive` hace lo mismo. Va el mismo cuerpo
 * que usa colgar(), a la misma ruta.
 */
function colgarSinEsperar(callId: string, channelId: string | undefined, sessionId?: string) {
  // `sessionId` solo lo lleva la persona agregada: su llamada va por otra linea, no la del chat.
  const cuerpo = JSON.stringify({ accion: "colgar", callId, channelId, ...(sessionId ? { sessionId } : {}) });
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

/** Lo que llega por el canal "pcm", como enteros de 16 bits (para mezclar en el puente). */
function aInt16(buf: ArrayBuffer): Int16Array {
  return new Int16Array(buf, 0, Math.floor(buf.byteLength / 2));
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
 * Deja en los registros del servidor cuanto audio fue y vino en la llamada. `keepalive` hace que
 * salga aunque la pestaña se este cerrando.
 */
function enviarDiagnostico(
  callId: string,
  channelId: string | undefined,
  diagnostico: DiagnosticoDeLlamada,
  segundosHablados: number,
  sessionId?: string,
) {
  try {
    void fetch("/api/wacalls/llamada", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({
        accion: "diagnostico",
        callId,
        channelId,
        ...(sessionId ? { sessionId } : {}),
        segundosHablados,
        diagnostico,
      }),
    }).catch(() => {});
  } catch {
    // El diagnostico nunca puede romper el colgar.
  }
}

/*
  Lo que es de UNA llamada, sea la principal (el cliente) o la de la persona agregada.

  Las dos comparten el microfono y el AudioContext de la principal; cada una tiene su callId, su
  linea, su conexion con WaCalls y su canal de sonido "pcm".
*/

/** Con que se identifica una llamada ante la ruta: su callId y por que linea va. */
type IdentidadDeLlamada = {
  callId: string;
  /** El canal del chat: la principal va por la linea de su canal, como siempre. */
  channelId?: string;
  /** La linea exacta que devolvio "iniciar": la persona agregada sale por OTRA linea. */
  sessionId?: string;
};

/** La conexion con WaCalls y su canal de sonido. El canal se crea ANTES de la oferta (ver llamar). */
function crearConexion() {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  // Sin orden y sin reenvios: ver audio-de-llamada.ts, es LA causa de que a veces el cliente no
  // escuchara a la asesora.
  const canal = pc.createDataChannel(CANAL_PCM, OPCIONES_CANAL_PCM);
  canal.binaryType = "arraybuffer";
  return { pc, canal };
}

/** El saludo de audio con WaCalls: oferta, rutas de red y la respuesta del servicio. */
async function negociarAudio(pc: RTCPeerConnection, identidad: IdentidadDeLlamada) {
  const oferta = await pc.createOffer();
  await pc.setLocalDescription(oferta);
  await esperarRutas(pc);

  const respuesta = (await pedir({
    accion: "webrtc",
    ...identidad,
    sdpOffer: pc.localDescription?.sdp ?? oferta.sdp,
  })) as { sdpAnswer?: string };

  if (!respuesta.sdpAnswer) {
    throw new Error("El servicio no devolvió el audio.");
  }
  await pc.setRemoteDescription({ type: "answer", sdp: respuesta.sdpAnswer });
}

type RespuestaDeEstado = { status?: string; endReason?: string | null; enHistorial?: boolean };

/** En que va una llamada, segun WaCalls (ver revisarEstado). */
async function consultarEstado(identidad: IdentidadDeLlamada) {
  return (await pedir({ accion: "estado", ...identidad })) as RespuestaDeEstado;
}

/** Cuelga una llamada en WaCalls y espera la respuesta. */
async function colgarEnServidor(identidad: IdentidadDeLlamada) {
  await pedir({ accion: "colgar", ...identidad });
}

/**
 * Manda un paquete por el canal de una llamada. Con la red ahogada se tira audio NUEVO en vez de
 * apilarlo: apilado llega tarde y WaCalls lo descarta igual, despues de varios segundos de
 * silencio para el otro lado. Devuelve si salio.
 */
function mandarPaquete(canal: RTCDataChannel, datos: ArrayBuffer, diagnostico: DiagnosticoDeLlamada): boolean {
  const cola = canal.bufferedAmount;
  if (cola > diagnostico.colaMaxima) diagnostico.colaMaxima = cola;
  if (hayQueDescartar(cola)) {
    diagnostico.descartados += 1;
    return false;
  }
  try {
    canal.send(datos);
  } catch {
    diagnostico.descartados += 1;
    return false;
  }
  diagnostico.enviados += 1;
  return true;
}

/** La llamada de la persona agregada, con todo lo suyo. Vive en un ref: la leen los procesadores de audio. */
type SegundaInterna = {
  numero: string;
  estado: EstadoSegunda;
  callId: string | null;
  /** La linea por la que salio (la devuelve "iniciar"); va en colgar, estado, webrtc y diagnostico. */
  linea: string | undefined;
  pc: RTCPeerConnection | null;
  canal: RTCDataChannel | null;
  /** Lo que llego de ella y todavia no se mezclo. */
  cola: ColaDeSonido;
  diagnostico: DiagnosticoDeLlamada;
  sondeo: number | null;
  busquedasEnHistorial: number;
  hablandoDesde: number | null;
  /** Ya se le dijo a WaCalls que se cuelga (o ya termino alla): no se repite. */
  colgadaEnServidor: boolean;
  diagnosticoEnviado: boolean;
};

function identidadDeSegunda(s: SegundaInterna): IdentidadDeLlamada | null {
  return s.callId ? { callId: s.callId, sessionId: s.linea } : null;
}

/** Le avisa a WaCalls que la segunda se cuelga (sin esperar) y deja su diagnostico, una sola vez. */
function colgarSegundaSinEsperar(s: SegundaInterna) {
  if (!s.callId) {
    return;
  }
  if (!s.colgadaEnServidor) {
    s.colgadaEnServidor = true;
    colgarSinEsperar(s.callId, undefined, s.linea);
  }
  if (!s.diagnosticoEnviado) {
    s.diagnosticoEnviado = true;
    const segundos = s.hablandoDesde === null ? 0 : Math.round((performance.now() - s.hablandoDesde) / 1000);
    enviarDiagnostico(s.callId, undefined, s.diagnostico, segundos, s.linea);
  }
}

export function useLlamada({ onError, onTerminada }: Opciones = {}) {
  const [estado, setEstado] = useState<EstadoLlamada>("libre");
  const [silenciado, setSilenciado] = useState(false);
  const [segundos, setSegundos] = useState(0);
  /** Lo que dice el panel cuando la llamada termino sola: "No contesto", "Ocupado"... */
  const [motivoFin, setMotivoFin] = useState<string | null>(null);
  /** Los primeros segundos despues de que el cliente levanto, para decir "Contesto". */
  const [recienContesto, setRecienContesto] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const callIdRef = useRef<string | null>(null);
  /*
    La linea con la que se INICIO la llamada, para todos los pasos que siguen.

    Solo "iniciar" mandaba el canal: conectar el audio, colgar y silenciar iban sin el, y el
    servidor los mandaba a la linea por defecto del negocio (Ventas 1). En Ventas 2 la llamada
    existia en otra linea, WaCalls contestaba "no such call" y la asesora veia "Esa llamada ya
    terminó" mientras al cliente le seguia sonando (Alex, 16-sep-2026). Se guarda en un ref y no se
    lee de la prop: la llamada vive en SU linea aunque la pantalla cambie de chat en el medio.
  */
  const canalRef = useRef<string | undefined>(undefined);
  /** El estado leido desde los temporizadores, que no ven el `estado` de React actualizado. */
  const estadoRef = useRef<EstadoLlamada>("libre");
  const segundosRef = useRef(0);
  const sondeoRef = useRef<number | null>(null);
  const apagarTimbradoRef = useRef<(() => void) | null>(null);
  const temporizadoresRef = useRef<number[]>([]);
  /** Veces que se busco la llamada en el historial de WaCalls sin encontrarla todavia. */
  const busquedasEnHistorialRef = useRef(0);
  /** Lo que se cuenta del audio para saber despues si fue en los dos sentidos (audio-de-llamada.ts). */
  const diagnosticoRef = useRef<DiagnosticoDeLlamada>(diagnosticoVacio());
  /** La ultima llamada cuyo diagnostico ya salio: cada llamada manda uno solo. */
  const diagnosticoEnviadoDeRef = useRef<string | null>(null);
  const revisionRef = useRef<number | null>(null);
  /** La linea por la que salio la principal, como la devolvio "iniciar": la segunda sale por OTRA. */
  const lineaPrincipalRef = useRef<string | undefined>(undefined);
  /** Lo que llego del cliente y todavia no se mezclo; solo se usa mientras hay puente. */
  const colaPrincipalRef = useRef(new ColaDeSonido());
  /** El silencio leido desde el procesador del microfono, que no ve el estado de React. */
  const silenciadoRef = useRef(false);
  /** La persona agregada (llamada de tres). Una sola: mientras existe no se puede agregar otra. */
  const segundaRef = useRef<SegundaInterna | null>(null);
  const [segunda, setSegunda] = useState<SegundaLlamada | null>(null);

  const cambiarEstado = useCallback((siguiente: EstadoLlamada) => {
    estadoRef.current = siguiente;
    setEstado(siguiente);
  }, []);

  /**
   * Deja constancia en el servidor de cuanto audio fue y vino. Es lo que permite contestar "¿el
   * cliente la escuchaba?" sin depender de lo que cada uno recuerde. Tambien sale con cero audio:
   * una llamada en la que no paso nada es justo la que hay que poder ver.
   */
  const reportarDiagnostico = useCallback(() => {
    const callId = callIdRef.current;
    if (!callId || diagnosticoEnviadoDeRef.current === callId) {
      return;
    }
    diagnosticoEnviadoDeRef.current = callId;
    enviarDiagnostico(callId, canalRef.current, diagnosticoRef.current, segundosRef.current);
  }, []);

  /**
   * Cuelga y suelta a la persona agregada: su conexion, su sondeo y su cola. La llamada principal
   * sigue igual. Con `principalSigue` y Alexander silenciado, se lo vuelve a silenciar en WaCalls:
   * durante el puente ese silencio era solo local (ver alternarSilencio).
   */
  const soltarSegunda = useCallback(
    (final: "colgo" | "error", mensaje: string | null, principalSigue: boolean) => {
      const s = segundaRef.current;
      if (!s) {
        return;
      }
      segundaRef.current = null;
      if (s.sondeo !== null) {
        window.clearInterval(s.sondeo);
        s.sondeo = null;
      }
      colgarSegundaSinEsperar(s);
      s.pc?.close();
      s.pc = null;
      s.canal = null;
      s.cola.vaciar();
      colaPrincipalRef.current.vaciar();
      setSegunda({ numero: s.numero, estado: final, mensaje });
      const callIdPrincipal = callIdRef.current;
      if (principalSigue && silenciadoRef.current && callIdPrincipal) {
        void pedir({ accion: "silenciar", callId: callIdPrincipal, muted: true, channelId: canalRef.current }).catch(() => {});
      }
    },
    [],
  );

  /** Suelta micrófono, audio y conexión. Se llama al colgar y al desmontar. */
  const limpiar = useCallback(() => {
    // Sin la principal no hay microfono ni audio: la persona agregada se cuelga tambien.
    soltarSegunda("colgo", null, false);
    setSegunda(null);
    apagarTimbradoRef.current?.();
    apagarTimbradoRef.current = null;
    if (sondeoRef.current !== null) {
      window.clearInterval(sondeoRef.current);
      sondeoRef.current = null;
    }
    if (revisionRef.current !== null) {
      window.clearInterval(revisionRef.current);
      revisionRef.current = null;
    }
    reportarDiagnostico();
    diagnosticoRef.current = diagnosticoVacio();
    // El micrófono se apaga SIEMPRE, incluso si algo falló antes: dejar la lucecita del micro
    // encendida después de colgar es lo que hace que la gente desconfíe de la herramienta.
    micRef.current?.getTracks().forEach((track) => track.stop());
    micRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
    callIdRef.current = null;
    lineaPrincipalRef.current = undefined;
    colaPrincipalRef.current.vaciar();
    busquedasEnHistorialRef.current = 0;
    silenciadoRef.current = false;
    setSilenciado(false);
    setSegundos(0);
    segundosRef.current = 0;
    setRecienContesto(false);
  }, [reportarDiagnostico, soltarSegunda]);

  /** Si hay llamadas activas, le avisa a WaCalls que se cuelgan las DOS (la pantalla se va). */
  const colgarAlSalir = useCallback(() => {
    const callId = callIdRef.current;
    if (callId) {
      colgarSinEsperar(callId, canalRef.current);
    }
    const s = segundaRef.current;
    if (s) {
      colgarSegundaSinEsperar(s);
    }
  }, []);

  useEffect(() => {
    const temporizadores = temporizadoresRef.current;
    // Al cerrar la pestaña React no desmonta nada: sin esto la llamada se quedaba sin diagnostico
    // y, peor, sin colgar del lado de WaCalls.
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
    const callId = callIdRef.current;
    if (!callId) {
      return;
    }
    let respuesta: RespuestaDeEstado;
    try {
      respuesta = await consultarEstado({ callId, channelId: canalRef.current });
    } catch {
      // Un sondeo que falla no corta nada: se vuelve a preguntar en un segundo.
      return;
    }
    // Mientras se esperaba la respuesta pudieron colgar o empezar otra llamada.
    if (callIdRef.current !== callId) {
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
      if (!respuesta.enHistorial && busquedasEnHistorialRef.current < 3) {
        busquedasEnHistorialRef.current += 1;
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
    const callId = callIdRef.current;
    cambiarEstado("cortando");
    // Colgar la principal cuelga tambien a la persona agregada.
    soltarSegunda("colgo", null, false);
    try {
      if (callId) {
        await colgarEnServidor({ callId, channelId: canalRef.current });
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
      try {
        const mic = await navigator.mediaDevices.getUserMedia(RESTRICCIONES_MIC);
        micRef.current = mic;
        diagnosticoRef.current = diagnosticoVacio();

        // La linea queda fijada ANTES de iniciar: si algo falla despues, el colgar va a la misma.
        canalRef.current = channelId ?? undefined;
        const iniciada = (await pedir({
          accion: "iniciar",
          ...(esOculto ? { lid: telefono } : { phone: telefono }),
          channelId: canalRef.current,
        })) as { callId?: string; sessionId?: string };
        const callId = iniciada.callId;
        if (!callId) {
          throw new Error("El servicio no devolvió la llamada.");
        }
        callIdRef.current = callId;
        // Solo se guarda para agregar a alguien: la principal sigue mandando el canal del chat.
        lineaPrincipalRef.current = iniciada.sessionId;
        cambiarEstado("sonando");

        // El canal se crea ANTES de la oferta: si no, no aparece en el saludo y del otro lado
        // nunca llega el audio.
        const { pc, canal } = crearConexion();
        pcRef.current = pc;

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
        sondeoRef.current = window.setInterval(() => void revisarEstado(), SONDEO_MS);

        // Micrófono → canal de datos, en paquetes de 20 ms.
        const diagnostico = diagnosticoRef.current;
        const empaquetador = new EmpaquetadorPcm();
        let ultimoEnvio = 0;
        const captura = new AudioWorkletNode(ctx, "capture-processor");
        captura.port.onmessage = (evento: MessageEvent<Float32Array>) => {
          if (canal.readyState !== "open") {
            return;
          }
          for (const paquete of empaquetador.agregar(evento.data)) {
            const enteros = aEnteros(paquete);
            const s = segundaRef.current;
            if (s && s.estado === "hablando" && s.canal) {
              // Llamada de tres: cada paquete del microfono marca el paso del puente (20 ms).
              // A recibe microfono + B, B recibe microfono + A y el parlante suena A + B.
              // Silenciado, se quita solo el microfono: el cliente y la persona agregada se
              // siguen escuchando entre ellos.
              const microfono = new Int16Array(enteros);
              const deA = colaPrincipalRef.current.sacar();
              const deB = s.cola.sacar();
              const silencio = silenciadoRef.current;
              enviarALaPrincipal(mezclaParaLlamada({ microfono, otraLlamada: deB, silenciado: silencio }).buffer as ArrayBuffer);
              if (s.canal.readyState === "open") {
                mandarPaquete(
                  s.canal,
                  mezclaParaLlamada({ microfono, otraLlamada: deA, silenciado: silencio }).buffer as ArrayBuffer,
                  s.diagnostico,
                );
              }
              const parlante = mezclaParaParlante(deA, deB);
              if (parlante.length > 0) {
                reproduccion.port.postMessage(aFlotantes(parlante.buffer as ArrayBuffer));
              }
              continue;
            }
            enviarALaPrincipal(enteros);
          }
        };
        /** Un paquete al cliente, con lo que se cuenta para el diagnostico. */
        const enviarALaPrincipal = (datos: ArrayBuffer) => {
          if (!mandarPaquete(canal, datos, diagnostico)) {
            return;
          }
          const ahora = performance.now();
          if (ultimoEnvio && estadoRef.current === "hablando") {
            diagnostico.huecoMaximoEnviadoMs = Math.max(diagnostico.huecoMaximoEnviadoMs, Math.round(ahora - ultimoEnvio));
          }
          ultimoEnvio = ahora;
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
              diagnostico.microfonoCaido += 1;
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

        // Canal de datos → parlante.
        const reproduccion = new AudioWorkletNode(ctx, "playback-processor");
        const destino = ctx.createMediaStreamDestination();
        reproduccion.connect(destino);
        reproduccion.port.onmessage = (evento: MessageEvent<{ tipo: "corte"; objetivoMs: number }>) => {
          if (evento.data.tipo !== "corte" || estadoRef.current !== "hablando") {
            return;
          }
          diagnostico.cortesReproduccion += 1;
          diagnostico.objetivoColchonMaxMs = Math.max(diagnostico.objetivoColchonMaxMs, evento.data.objetivoMs);
        };
        let ultimoRecibido = 0;
        canal.onmessage = (evento: MessageEvent<ArrayBuffer>) => {
          const ahora = performance.now();
          if (ultimoRecibido && estadoRef.current === "hablando") {
            diagnostico.huecoMaximoRecibidoMs = Math.max(diagnostico.huecoMaximoRecibidoMs, Math.round(ahora - ultimoRecibido));
          }
          ultimoRecibido = ahora;
          diagnostico.recibidos += 1;
          diagnostico.bytesRecibidos += evento.data.byteLength;
          // Con la persona agregada en el puente, lo del cliente se mezcla (ver la captura).
          if (segundaRef.current?.estado === "hablando") {
            colaPrincipalRef.current.meter(aInt16(evento.data));
            return;
          }
          reproduccion.port.postMessage(aFlotantes(evento.data));
        };

        // Cada 5 s: cuanto paso de verdad por la red (sale en el diagnostico al colgar).
        revisionRef.current = window.setInterval(() => {
          if (pcRef.current !== pc) {
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
              if (callIdRef.current === callId && estadoRef.current !== "terminada" && estadoRef.current !== "libre") {
                void colgar();
              }
            }, 4000);
            temporizadoresRef.current.push(id);
          }
        };

        await negociarAudio(pc, { callId, channelId: canalRef.current });
      } catch (error) {
        const mensaje =
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Hay que permitir el micrófono para poder llamar."
            : error instanceof Error
              ? error.message
              : "No se pudo iniciar la llamada.";
        onError?.(mensaje);
        // Si ya se había creado la llamada del otro lado, se corta: si no, el número queda
        // sonando en el teléfono del cliente sin nadie del otro lado.
        if (callIdRef.current) {
          void pedir({ accion: "colgar", callId: callIdRef.current, channelId: canalRef.current }).catch(() => {});
        }
        limpiar();
        cambiarEstado("libre");
      }
    },
    [colgar, limpiar, onError, cambiarEstado, revisarEstado],
  );

  /**
   * En que va la llamada de la persona agregada, como revisarEstado para la principal. Cuando
   * contesta entra al puente; si termina, se suelta y la principal sigue igual.
   */
  const revisarSegunda = useCallback(
    async (s: SegundaInterna) => {
      const identidad = identidadDeSegunda(s);
      if (segundaRef.current !== s || !identidad) {
        return;
      }
      let respuesta: RespuestaDeEstado;
      try {
        respuesta = await consultarEstado(identidad);
      } catch {
        return;
      }
      if (segundaRef.current !== s) {
        return;
      }
      if (respuesta.status === "connected" && s.estado === "sonando") {
        s.estado = "hablando";
        s.hablandoDesde = performance.now();
        // El puente arranca de cero: lo que se junto antes ya llega tarde.
        s.cola.vaciar();
        colaPrincipalRef.current.vaciar();
        if (ctxRef.current) {
          pitidoDeContestada(ctxRef.current);
        }
        setSegunda({ numero: s.numero, estado: "hablando", mensaje: null });
        return;
      }
      if (respuesta.status === "ended") {
        if (!respuesta.enHistorial && s.busquedasEnHistorial < 3) {
          s.busquedasEnHistorial += 1;
          return;
        }
        // Ya termino en WaCalls: no hace falta colgarla alla.
        s.colgadaEnServidor = true;
        soltarSegunda("colgo", s.estado === "hablando" ? null : motivoSinHablar(respuesta.endReason ?? null), true);
      }
    },
    [soltarSegunda],
  );

  /**
   * Llamada de tres: suma a otra persona (por ejemplo el transportador) a la llamada en curso.
   *
   * WaCalls solo hace llamadas de a dos, asi que se abre una SEGUNDA llamada por OTRA linea del
   * negocio y el CRM hace de puente (ver la captura en llamar y puente-de-llamadas.ts). Usa el
   * mismo microfono y el mismo AudioContext. Si algo falla, la llamada con el cliente no se toca.
   */
  const agregarPersona = useCallback(
    async (numero: string) => {
      if (segundaRef.current) {
        onError?.("Ya hay una persona agregada. Solo se puede sumar una.");
        return;
      }
      const callIdPrincipal = callIdRef.current;
      const ctx = ctxRef.current;
      if (!callIdPrincipal || !ctx || estadoRef.current !== "hablando") {
        onError?.("Para agregar a alguien, el cliente tiene que haber contestado.");
        return;
      }
      const lineaPrincipal = lineaPrincipalRef.current;
      if (!lineaPrincipal) {
        onError?.("No se sabe por qué línea va la llamada: no se puede agregar a nadie.");
        return;
      }
      const telefono = numero.replace(/[^0-9+]/g, "");
      if (!telefono) {
        onError?.("Escribe el número de la persona que quieres agregar.");
        return;
      }

      const s: SegundaInterna = {
        numero: telefono,
        estado: "sonando",
        callId: null,
        linea: undefined,
        pc: null,
        canal: null,
        cola: new ColaDeSonido(),
        diagnostico: diagnosticoVacio(),
        sondeo: null,
        busquedasEnHistorial: 0,
        hablandoDesde: null,
        colgadaEnServidor: false,
        diagnosticoEnviado: false,
      };
      segundaRef.current = s;
      setSegunda({ numero: telefono, estado: "sonando", mensaje: null });
      // Mientras haya puente el silencio es solo local (ver alternarSilencio).
      if (silenciadoRef.current) {
        void pedir({ accion: "silenciar", callId: callIdPrincipal, muted: false, channelId: canalRef.current }).catch(() => {});
      }

      try {
        const iniciada = (await pedir({
          accion: "iniciar",
          phone: telefono,
          channelId: canalRef.current,
          otraLineaDistintaDe: lineaPrincipal,
        })) as { callId?: string; sessionId?: string };
        if (!iniciada.callId) {
          throw new Error("El servicio no devolvió la llamada.");
        }
        s.callId = iniciada.callId;
        s.linea = iniciada.sessionId;
        // La quitaron (o colgaron la principal) mientras se marcaba: se cuelga y no se sigue.
        if (segundaRef.current !== s) {
          colgarSegundaSinEsperar(s);
          return;
        }
        if (!s.linea) {
          throw new Error("El servicio no dijo por qué línea salió la llamada.");
        }

        const { pc, canal } = crearConexion();
        s.pc = pc;
        s.canal = canal;
        canal.onmessage = (evento: MessageEvent<ArrayBuffer>) => {
          s.diagnostico.recibidos += 1;
          s.diagnostico.bytesRecibidos += evento.data.byteLength;
          if (s.estado === "hablando") {
            s.cola.meter(aInt16(evento.data));
          }
        };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "failed" || pc.connectionState === "closed") {
            void revisarSegunda(s);
            const id = window.setTimeout(() => {
              if (segundaRef.current === s) {
                soltarSegunda("colgo", "Se cortó la llamada con la persona agregada.", true);
              }
            }, 4000);
            temporizadoresRef.current.push(id);
          }
        };
        s.sondeo = window.setInterval(() => void revisarSegunda(s), SONDEO_MS);

        await negociarAudio(pc, { callId: s.callId, sessionId: s.linea });
      } catch (error) {
        if (segundaRef.current !== s) {
          return;
        }
        // Por ejemplo "No hay otra línea libre para agregar a alguien": se muestra tal cual.
        const mensaje = error instanceof Error ? error.message : "No se pudo agregar a la persona.";
        onError?.(mensaje);
        soltarSegunda("error", mensaje, true);
      }
    },
    [onError, revisarSegunda, soltarSegunda],
  );

  /** Cuelga solo a la persona agregada: la llamada con el cliente sigue. */
  const quitarPersona = useCallback(() => {
    soltarSegunda("colgo", null, true);
  }, [soltarSegunda]);

  const alternarSilencio = useCallback(async () => {
    const callId = callIdRef.current;
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
    // Con una persona agregada el silencio es solo de este lado: silenciada en WaCalls, la llamada
    // del cliente tampoco dejaria pasar la voz de la persona agregada. Al soltarla se ajusta.
    if (segundaRef.current) {
      return;
    }
    try {
      await pedir({ accion: "silenciar", callId, muted: siguiente, channelId: canalRef.current });
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
