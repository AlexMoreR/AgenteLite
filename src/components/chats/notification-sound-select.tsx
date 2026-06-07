"use client";

import { useEffect, useRef, useState } from "react";

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  DEFAULT_NOTIFICATION_SOUND,
  NOTIFICATION_SOUND_OPTIONS,
  getStoredNotificationSound,
  playNotificationSound,
  setStoredNotificationSound,
  type NotificationSoundId,
} from "./chat-notification-sound";

export function NotificationSoundSelect() {
  const [value, setValue] = useState<NotificationSoundId>(DEFAULT_NOTIFICATION_SOUND);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Lee la preferencia guardada al montar (en cliente, evita mismatch de hidratación).
  useEffect(() => {
    setValue(getStoredNotificationSound());
  }, []);

  const handleChange = (next: NotificationSoundId) => {
    setValue(next);
    setStoredNotificationSound(next);

    // Vista previa del sonido elegido.
    if (next !== "silence") {
      if (!audioContextRef.current) {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) {
          audioContextRef.current = new Ctx();
        }
      }
      if (audioContextRef.current) {
        playNotificationSound(next, audioContextRef.current);
      }
    }
  };

  return (
    <NativeSelect
      className="w-full"
      value={value}
      onChange={(event) => handleChange(event.target.value as NotificationSoundId)}
      aria-label="Sonido de notificación de chat"
    >
      {NOTIFICATION_SOUND_OPTIONS.map((option) => (
        <NativeSelectOption key={option.value} value={option.value}>
          {option.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
