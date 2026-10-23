"use client";

/*
  EL CLIENTE DE LIVEKIT EN EL NAVEGADOR (livekit-client 2.x, Apache 2.0).

  Se carga del CDN (jsDelivr) solo al entrar a una sala, y no como paquete de npm: el trabajador que
  construyó el módulo no podía instalar paquetes (23-oct-2026). Cambiarlo por el paquete
  `livekit-client` es tocar solo este archivo: `cargarLivekit` devolvería el import del paquete.
  NEXT_PUBLIC_LIVEKIT_CLIENT_URL permite fijar otra dirección (por ejemplo una versión exacta).

  Abajo están solo los tipos de lo que usa la sala.
*/

const URL_DEL_CLIENTE =
  process.env.NEXT_PUBLIC_LIVEKIT_CLIENT_URL || "https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.umd.js";

export type PistaLK = {
  kind: string;
  source: string;
  attach: (elemento: HTMLMediaElement) => HTMLMediaElement;
  detach: (elemento?: HTMLMediaElement) => HTMLMediaElement[] | HTMLMediaElement;
};

export type PublicacionLK = {
  trackSid: string;
  source: string;
  kind: string;
  isMuted: boolean;
  track?: PistaLK;
};

export type ParticipanteLK = {
  identity: string;
  name?: string;
  isLocal: boolean;
  isSpeaking: boolean;
  isMicrophoneEnabled: boolean;
  isCameraEnabled: boolean;
  isScreenShareEnabled: boolean;
  getTrackPublication: (fuente: string) => PublicacionLK | undefined;
  trackPublications: Map<string, PublicacionLK>;
};

export type ParticipanteLocalLK = ParticipanteLK & {
  setMicrophoneEnabled: (prender: boolean) => Promise<unknown>;
  setCameraEnabled: (prender: boolean) => Promise<unknown>;
  setScreenShareEnabled: (prender: boolean, opciones?: Record<string, unknown>) => Promise<unknown>;
  publishData: (datos: Uint8Array, opciones?: { reliable?: boolean; topic?: string }) => Promise<void>;
};

export type SalaLK = {
  localParticipant: ParticipanteLocalLK;
  remoteParticipants: Map<string, ParticipanteLK>;
  canPlaybackAudio: boolean;
  connect: (url: string, pase: string) => Promise<void>;
  disconnect: () => Promise<void>;
  startAudio: () => Promise<void>;
  on: (evento: string, oyente: (...argumentos: never[]) => void) => SalaLK;
  off: (evento: string, oyente: (...argumentos: never[]) => void) => SalaLK;
};

export type LivekitClient = {
  Room: new (opciones?: Record<string, unknown>) => SalaLK;
  RoomEvent: Record<string, string>;
  Track: { Source: Record<"Camera" | "Microphone" | "ScreenShare" | "ScreenShareAudio", string> };
  DisconnectReason?: Record<string, number | string>;
};

declare global {
  interface Window {
    LivekitClient?: LivekitClient;
  }
}

let cargando: Promise<LivekitClient> | null = null;

export function cargarLivekit(): Promise<LivekitClient> {
  if (window.LivekitClient) {
    return Promise.resolve(window.LivekitClient);
  }
  if (cargando) {
    return cargando;
  }
  cargando = new Promise<LivekitClient>((resolver, rechazar) => {
    const script = document.createElement("script");
    script.src = URL_DEL_CLIENTE;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      if (window.LivekitClient) {
        resolver(window.LivekitClient);
      } else {
        rechazar(new Error("No se pudo cargar la videollamada."));
      }
    };
    script.onerror = () => {
      cargando = null;
      script.remove();
      rechazar(new Error("No se pudo cargar la videollamada. Revisa tu conexión."));
    };
    document.head.appendChild(script);
  });
  return cargando;
}
