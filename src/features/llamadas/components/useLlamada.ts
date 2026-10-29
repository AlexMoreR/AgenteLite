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
/** Se sube cuando cambian los procesadores de audio: el navegador guarda los .js y las asesoras seguirian con el viejo. */
const VERSION_WORKLETS = "2";
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
  /** Canal del chat: la llamada sale por SU numero. */
  channelId?: string | null;
  onError?: (mensaje: string) => void;
  onTerminada?: () => void;
};

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
 * salga aunque la asesora cierre la pestaña al colgar.
 */
function enviarDiagnostico(
  callId: string,
  channelId: string | undefined,
  diagnostico: DiagnosticoDeLlamada,
  segundosHablados: number,
) {
  try {
    void fetch("/api/wacalls/llamada", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({ accion: "diagnostico", callId, channelId, segundosHablados, diagnostico }),
    }).catch(() => {});
  } catch {
    // El diagnostico nunca puede romper el colgar.
  }
}

export function useLlamada({ channelId, onError, onTerminada }: Opciones = {}) {
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
  const revisionRef = useRef<number | null>(null);

  const cambiarEstado = useCallback((siguiente: EstadoLlamada) => {
    estadoRef.current = siguiente;
    setEstado(siguiente);
  }, []);

  /** Suelta micrófono, audio y conexión. Se llama al colgar y al desmontar. */
  const limpiar = useCallback(() => {
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
    // Antes de soltar todo, se deja constancia en el servidor de cuanto audio fue y vino. Es lo
    // que permite contestar "¿el cliente la escuchaba?" sin depender de lo que cada uno recuerde.
    if (callIdRef.current && (diagnosticoRef.current.enviados > 0 || diagnosticoRef.current.recibidos > 0)) {
      enviarDiagnostico(callIdRef.current, canalRef.current, diagnosticoRef.current, segundosRef.current);
    }
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
    busquedasEnHistorialRef.current = 0;
    setSilenciado(false);
    setSegundos(0);
    segundosRef.current = 0;
    setRecienContesto(false);
  }, []);

  useEffect(() => {
    const temporizadores = temporizadoresRef.current;
    return () => {
      limpiar();
      temporizadores.forEach((id) => window.clearTimeout(id));
    };
  }, [limpiar]);

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
    let respuesta: { status?: string; endReason?: string | null; enHistorial?: boolean };
    try {
      respuesta = (await pedir({ accion: "estado", callId, channelId: canalRef.current })) as typeof respuesta;
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
    try {
      if (callId) {
        await pedir({ accion: "colgar", callId, channelId: canalRef.current });
      }
    } catch {
      // Si el servicio no contesta igual se corta de este lado: lo que no puede pasar es que la
      // asesora quede con el micrófono abierto porque el otro extremo falló.
    } finally {
      limpiar();
      cambiarEstado("libre");
      onTerminada?.();
    }
  }, [cambiarEstado, limpiar, onTerminada]);

  const llamar = useCallback(
    /** `esOculto` = el destino es un identificador de WhatsApp, no un teléfono. */
    async (telefono: string, esOculto = false) => {
      if (estado !== "libre") {
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
        })) as { callId?: string };
        const callId = iniciada.callId;
        if (!callId) {
          throw new Error("El servicio no devolvió la llamada.");
        }
        callIdRef.current = callId;
        cambiarEstado("sonando");

        const pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });
        pcRef.current = pc;

        // El canal se crea ANTES de la oferta: si no, no aparece en el saludo y del otro lado
        // nunca llega el audio. Sin orden y sin reenvios: ver audio-de-llamada.ts, es LA causa de
        // que a veces el cliente no escuchara a la asesora.
        const canal = pc.createDataChannel(CANAL_PCM, OPCIONES_CANAL_PCM);
        canal.binaryType = "arraybuffer";

        const ctx = new AudioContext({ sampleRate: FRECUENCIA });
        ctxRef.current = ctx;
        // Si el sistema suspende el audio (otra app tomo el parlante, el celular bloqueo la
        // pantalla), se vuelve a encender: suspendido, no sale ni entra nada.
        ctx.onstatechange = () => {
          if (ctxRef.current === ctx && ctx.state !== "running" && ctx.state !== "closed") {
            void ctx.resume().catch(() => {});
          }
        };
        await ctx.audioWorklet.addModule(`/worklets/capture-processor.js?v=${VERSION_WORKLETS}`);
        await ctx.audioWorklet.addModule(`/worklets/playback-processor.js?v=${VERSION_WORKLETS}`);
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
            const cola = canal.bufferedAmount;
            if (cola > diagnostico.colaMaxima) diagnostico.colaMaxima = cola;
            // Con la red ahogada se tira audio NUEVO en vez de apilarlo: apilado llega tarde y
            // WaCalls lo descarta igual, despues de varios segundos de silencio para el cliente.
            if (hayQueDescartar(cola)) {
              diagnostico.descartados += 1;
              continue;
            }
            try {
              canal.send(aEnteros(paquete));
            } catch {
              diagnostico.descartados += 1;
              continue;
            }
            const ahora = performance.now();
            if (ultimoEnvio && estadoRef.current === "hablando") {
              diagnostico.huecoMaximoEnviadoMs = Math.max(diagnostico.huecoMaximoEnviadoMs, Math.round(ahora - ultimoEnvio));
            }
            ultimoEnvio = ahora;
            diagnostico.enviados += 1;
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
                  onError?.("Se desconectó el micrófono: el cliente no te escucha. Revisá el auricular y volvé a llamar.");
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
        let ultimoRecibido = 0;
        canal.onmessage = (evento: MessageEvent<ArrayBuffer>) => {
          const ahora = performance.now();
          if (ultimoRecibido && estadoRef.current === "hablando") {
            diagnostico.huecoMaximoRecibidoMs = Math.max(diagnostico.huecoMaximoRecibidoMs, Math.round(ahora - ultimoRecibido));
          }
          ultimoRecibido = ahora;
          diagnostico.recibidos += 1;
          diagnostico.bytesRecibidos += evento.data.byteLength;
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
            onError?.("El navegador bloqueó el audio. Tocá la pantalla y volvé a intentar.");
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

        const oferta = await pc.createOffer();
        await pc.setLocalDescription(oferta);
        await esperarRutas(pc);

        const respuesta = (await pedir({
          accion: "webrtc",
          callId,
          channelId: canalRef.current,
          sdpOffer: pc.localDescription?.sdp ?? oferta.sdp,
        })) as { sdpAnswer?: string };

        if (!respuesta.sdpAnswer) {
          throw new Error("El servicio no devolvió el audio.");
        }
        await pc.setRemoteDescription({ type: "answer", sdp: respuesta.sdpAnswer });
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
    [estado, channelId, colgar, limpiar, onError, cambiarEstado, revisarEstado],
  );

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
    setSilenciado(siguiente);
    try {
      await pedir({ accion: "silenciar", callId, muted: siguiente, channelId: canalRef.current });
    } catch {
      // El corte local ya ocurrió; que el servicio no se entere no cambia lo que se escucha.
    }
  }, [silenciado]);

  return { estado, silenciado, segundos, motivoFin, recienContesto, llamar, colgar, alternarSilencio, audioRef };
}
