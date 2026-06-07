// Preferencia y reproducción del sonido de notificación de chat.
// Se guarda en localStorage (preferencia por navegador/dispositivo) y la usan tanto
// el selector en Ajustes como el ChatIncomingNotifier en la página de chats.

export type NotificationSoundId = "silence" | "sound1" | "sound2" | "sound3";

export const NOTIFICATION_SOUND_STORAGE_KEY = "chat-notification-sound";
export const NOTIFICATION_SOUND_CHANGED_EVENT = "chat-notification-sound-changed";
export const DEFAULT_NOTIFICATION_SOUND: NotificationSoundId = "sound1";

export const NOTIFICATION_SOUND_OPTIONS: Array<{ value: NotificationSoundId; label: string }> = [
  { value: "silence", label: "Silenciar" },
  { value: "sound1", label: "Sonido 1" },
  { value: "sound2", label: "Sonido 2" },
  { value: "sound3", label: "Sonido 3" },
];

function isNotificationSoundId(value: unknown): value is NotificationSoundId {
  return value === "silence" || value === "sound1" || value === "sound2" || value === "sound3";
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
type Tone = { freq: number; start: number; duration: number };

const SOUND_PATTERNS: Record<Exclude<NotificationSoundId, "silence">, Tone[]> = {
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
};

export function playNotificationSound(soundId: NotificationSoundId, ctx: AudioContext) {
  if (soundId === "silence") {
    return;
  }

  const pattern = SOUND_PATTERNS[soundId];
  if (!pattern) {
    return;
  }

  if (ctx.state === "suspended") {
    void ctx.resume();
  }

  const baseTime = ctx.currentTime;
  for (const tone of pattern) {
    const startAt = baseTime + tone.start;
    const endAt = startAt + tone.duration;

    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.2, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(tone.freq, startAt);
    osc.connect(gain);
    osc.start(startAt);
    osc.stop(endAt + 0.02);
  }
}
