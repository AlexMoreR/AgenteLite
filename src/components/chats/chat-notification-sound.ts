// Preferencia y reproducción del sonido de notificación de chat.
// Se guarda en localStorage (preferencia por navegador/dispositivo) y la usan tanto
// el selector en Ajustes como el ChatIncomingNotifier en la página de chats.

export type NotificationSoundId =
  | "silence"
  | "sound1"
  | "sound2"
  | "sound3"
  | "sound4"
  | "sound5";

export const NOTIFICATION_SOUND_STORAGE_KEY = "chat-notification-sound";
export const NOTIFICATION_SOUND_CHANGED_EVENT = "chat-notification-sound-changed";
export const DEFAULT_NOTIFICATION_SOUND: NotificationSoundId = "sound1";

export const NOTIFICATION_SOUND_OPTIONS: Array<{ value: NotificationSoundId; label: string }> = [
  { value: "silence", label: "Silenciar" },
  { value: "sound1", label: "Sonido 1" },
  { value: "sound2", label: "Sonido 2" },
  { value: "sound3", label: "Sonido 3" },
  { value: "sound4", label: "Sonido 4" },
  { value: "sound5", label: "Sonido 5" },
];

function isNotificationSoundId(value: unknown): value is NotificationSoundId {
  return (
    value === "silence" ||
    value === "sound1" ||
    value === "sound2" ||
    value === "sound3" ||
    value === "sound4" ||
    value === "sound5"
  );
}

export function getStoredNotificationSound(): NotificationSoundId {
  if (typeof window === "undefined") {
    return DEFAULT_NOTIFICATION_SOUND;
  }
  const stored = window.localStorage.getItem(NOTIFICATION_SOUND_STORAGE_KEY);
  return isNotificationSoundId(stored) ? stored : DEFAULT_NOTIFICATION_SOUND;
}

export function setStoredNotificationSound(value: NotificationSoundId) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(NOTIFICATION_SOUND_STORAGE_KEY, value);
  window.dispatchEvent(new CustomEvent(NOTIFICATION_SOUND_CHANGED_EVENT, { detail: { value } }));
}

// Cada sonido es una secuencia de tonos (frecuencia + tiempos) generada con Web Audio.
// `gain` (0–1) escala el volumen del tono; sirve para superponer parciales sin saturar.
// `type` elige la forma de onda (triangle suena más cálido/agradable que sine).
type Tone = { freq: number; start: number; duration: number; gain?: number; type?: OscillatorType };

// Sonidos que usan un ARCHIVO de audio (en /public) en vez de tonos generados.
// El archivo debe existir en public/sounds/. Si no existe, se intenta reproducir y falla
// en silencio (no rompe nada); puedes volver a un tono generado quitando la entrada.
const SOUND_FILES: Partial<Record<NotificationSoundId, string>> = {
  sound1: "/sounds/sonido-1.mp3",
  sound2: "/sounds/sonido-2.mp3",
  sound3: "/sounds/sonido-3.mp3",
  // sound4 y sound5 aun no tienen archivo mp3: usan el tono generado de respaldo
  // (ver SOUND_PATTERNS) para que nunca queden en silencio.
};

// Tonos generados de respaldo (solo se usan si un sonido NO tiene archivo asociado).
const SOUND_PATTERNS: Partial<Record<NotificationSoundId, Tone[]>> = {
  // Ding-dong descendente suave.
  sound1: [
    { freq: 880, start: 0, duration: 0.18 },
    { freq: 1175, start: 0.12, duration: 0.3 },
  ],
  // Triple beep agudo.
  sound2: [
    { freq: 1320, start: 0, duration: 0.09 },
    { freq: 1320, start: 0.14, duration: 0.09 },
    { freq: 1320, start: 0.28, duration: 0.12 },
  ],
  // Tono ascendente tipo "pop" grave-agudo.
  sound3: [
    { freq: 523, start: 0, duration: 0.12 },
    { freq: 784, start: 0.1, duration: 0.22 },
  ],
  // Campanita doble media.
  sound4: [
    { freq: 660, start: 0, duration: 0.14 },
    { freq: 990, start: 0.13, duration: 0.2 },
  ],
  // Dos notas altas rápidas.
  sound5: [
    { freq: 1046, start: 0, duration: 0.1 },
    { freq: 1568, start: 0.12, duration: 0.18 },
  ],
};

/**
 * Reproduce el sonido de notificación. Devuelve `true` si se intentó reproducir algo.
 * Los sonidos con ARCHIVO usan un <audio> (funciona aunque la pestaña esté en segundo
 * plano, siempre que la página ya haya tenido una interacción del usuario) y NO dependen
 * del AudioContext. Los tonos generados sí necesitan un AudioContext activo (`ctx`).
 */
export function playNotificationSound(soundId: NotificationSoundId, ctx: AudioContext | null): boolean {
  if (soundId === "silence") {
    return false;
  }

  // Si el sonido tiene un archivo asociado, lo reproducimos con un <audio>.
  const fileUrl = SOUND_FILES[soundId];
  if (fileUrl && typeof Audio !== "undefined") {
    try {
      const audio = new Audio(fileUrl);
      audio.volume = 0.85;
      void audio.play().catch(() => {});
      return true;
    } catch {
      // Si falla (archivo ausente, etc.) no rompemos nada.
      return false;
    }
  }

  const pattern = SOUND_PATTERNS[soundId];
  if (!pattern || !ctx) {
    return false;
  }

  if (ctx.state === "suspended") {
    void ctx.resume();
  }

  const baseTime = ctx.currentTime;
  for (const tone of pattern) {
    const startAt = baseTime + tone.start;
    const endAt = startAt + tone.duration;

    const peak = 0.2 * (tone.gain ?? 1);
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

    const osc = ctx.createOscillator();
    osc.type = tone.type ?? "sine";
    osc.frequency.setValueAtTime(tone.freq, startAt);
    osc.connect(gain);
    osc.start(startAt);
    osc.stop(endAt + 0.02);
  }

  return true;
}
