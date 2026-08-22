"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Una llamada de WhatsApp hecha desde el CRM, sin salir de la pantalla.
 *
 * El audio va por WebRTC directo entre el navegador y el servicio de llamadas; el CRM solo hace
 * de intermediario para el saludo inicial (por eso el token nunca llega acá). El recorrido es:
 *
 *   1. pedir el micrófono
 *   2. crear la conexión y esperar a tener TODAS las rutas de red (ICE)
 *   3. mandar esa oferta a nuestra ruta, que la reenvía y devuelve la respuesta
 *   4. reproducir lo que llega
 *
 * El paso 2 es el que no se puede saltear: el servicio recibe la oferta como UN texto y no acepta
 * candidatos sueltos después. Mandarla antes de tiempo da una llamada que conecta y no se escucha.
 */

export type EstadoLlamada = "libre" | "marcando" | "sonando" | "hablando" | "cortando";

type Opciones = {
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

/**
 * Espera a que el navegador termine de juntar rutas de red, con un tope.
 *
 * El tope existe porque un STUN que no responde puede dejar el proceso colgado para siempre, y
 * es preferible llamar con las rutas que se alcanzaron a juntar que no llamar nunca.
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

export function useLlamada({ onError, onTerminada }: Opciones = {}) {
  const [estado, setEstado] = useState<EstadoLlamada>("libre");
  const [silenciado, setSilenciado] = useState(false);
  const [segundos, setSegundos] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const callIdRef = useRef<string | null>(null);

  /** Suelta micrófono, conexión y audio. Se llama al colgar y al desmontar. */
  const limpiar = useCallback(() => {
    // El micrófono se apaga SIEMPRE, incluso si algo falló antes: dejar la lucecita del micro
    // encendida después de colgar es lo que hace que la gente desconfíe de la herramienta.
    micRef.current?.getTracks().forEach((track) => track.stop());
    micRef.current = null;
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

        const iniciada = (await pedir({ accion: "iniciar", phone: telefono })) as { callId?: string };
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

        mic.getTracks().forEach((track) => pc.addTrack(track, mic));

        pc.ontrack = (evento) => {
          if (audioRef.current) {
            audioRef.current.srcObject = evento.streams[0];
            void audioRef.current.play().catch(() => {
              onError?.("El navegador bloqueó el audio. Tocá la pantalla y volvé a intentar.");
            });
          }
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "connected") {
            setEstado("hablando");
          }
          if (pc.connectionState === "failed" || pc.connectionState === "closed") {
            void colgar();
          }
        };

        const oferta = await pc.createOffer({ offerToReceiveAudio: true });
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
        // Si ya se habia creado la llamada del otro lado, se corta: si no, el numero queda
        // sonando en el telefono del cliente sin nadie del otro lado.
        if (callIdRef.current) {
          void pedir({ accion: "colgar", callId: callIdRef.current }).catch(() => {});
        }
        limpiar();
        setEstado("libre");
      }
    },
    [estado, colgar, limpiar, onError],
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
