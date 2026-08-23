"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

export type EstadoLlamada = "libre" | "marcando" | "sonando" | "hablando" | "cortando";

const FRECUENCIA = 16000;
const CANAL_PCM = "pcm";

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

export function useLlamada({ channelId, onError, onTerminada }: Opciones = {}) {
  const [estado, setEstado] = useState<EstadoLlamada>("libre");
  const [silenciado, setSilenciado] = useState(false);
  const [segundos, setSegundos] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const callIdRef = useRef<string | null>(null);

  /** Suelta micrófono, audio y conexión. Se llama al colgar y al desmontar. */
  const limpiar = useCallback(() => {
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
    setSilenciado(false);
    setSegundos(0);
  }, []);

  useEffect(() => limpiar, [limpiar]);

  // Cronómetro de la conversación.
  useEffect(() => {
    if (estado !== "hablando") {
      return;
    }
    const intervalo = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(intervalo);
  }, [estado]);

  const colgar = useCallback(async () => {
    const callId = callIdRef.current;
    setEstado("cortando");
    try {
      if (callId) {
        await pedir({ accion: "colgar", callId });
      }
    } catch {
      // Si el servicio no contesta igual se corta de este lado: lo que no puede pasar es que la
      // asesora quede con el micrófono abierto porque el otro extremo falló.
    } finally {
      limpiar();
      setEstado("libre");
      onTerminada?.();
    }
  }, [limpiar, onTerminada]);

  const llamar = useCallback(
    async (telefono: string) => {
      if (estado !== "libre") {
        return;
      }
      setEstado("marcando");
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        micRef.current = mic;

        const iniciada = (await pedir({
          accion: "iniciar",
          phone: telefono,
          channelId: channelId ?? undefined,
        })) as { callId?: string };
        const callId = iniciada.callId;
        if (!callId) {
          throw new Error("El servicio no devolvió la llamada.");
        }
        callIdRef.current = callId;
        setEstado("sonando");

        const pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });
        pcRef.current = pc;

        // El canal se crea ANTES de la oferta: si no, no aparece en el saludo y del otro lado
        // nunca llega el audio.
        const canal = pc.createDataChannel(CANAL_PCM, { ordered: true });
        canal.binaryType = "arraybuffer";

        const ctx = new AudioContext({ sampleRate: FRECUENCIA });
        ctxRef.current = ctx;
        await ctx.audioWorklet.addModule("/worklets/capture-processor.js");
        await ctx.audioWorklet.addModule("/worklets/playback-processor.js");
        await ctx.resume();

        // Micrófono → canal de datos.
        const fuenteMic = ctx.createMediaStreamSource(mic);
        const captura = new AudioWorkletNode(ctx, "capture-processor");
        captura.port.onmessage = (evento: MessageEvent<Float32Array>) => {
          if (canal.readyState === "open") {
            canal.send(aEnteros(evento.data));
          }
        };
        fuenteMic.connect(captura);
        // El procesador no escribe nada en su salida; conectarlo al destino es lo que lo mantiene
        // vivo, no se escucha a si misma la asesora.
        captura.connect(ctx.destination);

        // Canal de datos → parlante.
        const reproduccion = new AudioWorkletNode(ctx, "playback-processor");
        const destino = ctx.createMediaStreamDestination();
        reproduccion.connect(destino);
        canal.onmessage = (evento: MessageEvent<ArrayBuffer>) => {
          reproduccion.port.postMessage(aFlotantes(evento.data));
        };
        if (audioRef.current) {
          audioRef.current.srcObject = destino.stream;
          void audioRef.current.play().catch(() => {
            onError?.("El navegador bloqueó el audio. Tocá la pantalla y volvé a intentar.");
          });
        }

        canal.onopen = () => setEstado("hablando");

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "failed" || pc.connectionState === "closed") {
            void colgar();
          }
        };

        const oferta = await pc.createOffer();
        await pc.setLocalDescription(oferta);
        await esperarRutas(pc);

        const respuesta = (await pedir({
          accion: "webrtc",
          callId,
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
          void pedir({ accion: "colgar", callId: callIdRef.current }).catch(() => {});
        }
        limpiar();
        setEstado("libre");
      }
    },
    [estado, channelId, colgar, limpiar, onError],
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
      await pedir({ accion: "silenciar", callId, muted: siguiente });
    } catch {
      // El corte local ya ocurrió; que el servicio no se entere no cambia lo que se escucha.
    }
  }, [silenciado]);

  return { estado, silenciado, segundos, llamar, colgar, alternarSilencio, audioRef };
}
