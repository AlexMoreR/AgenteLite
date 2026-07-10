"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(getStoredNotificationSound());
  }, []);

  const ensureAudioContext = () => {
    if (!audioContextRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        audioContextRef.current = new Ctx();
      }
    }
    if (audioContextRef.current?.state === "suspended") {
      void audioContextRef.current.resume();
    }
    return audioContextRef.current;
  };

  const preview = (soundId: NotificationSoundId) => {
    if (soundId === "silence") {
      return;
    }
    playNotificationSound(soundId, ensureAudioContext());
  };

  const handleChange = (next: NotificationSoundId) => {
    setValue(next);
    setStoredNotificationSound(next);
    // Vista previa del sonido elegido.
    preview(next);
  };

  return (
    <div className="flex items-center gap-2">
      <NativeSelect
        className="flex-1"
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

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => preview(value)}
        disabled={value === "silence"}
        aria-label="Probar sonido"
      >
        <Volume2 className="size-4" />
        Probar
      </Button>
    </div>
  );
}
