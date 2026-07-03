"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

type WhatsappQrCountdownProps = {
  isConnected: boolean;
  cycleSeconds?: number;
};

export function WhatsappQrCountdown({ isConnected, cycleSeconds = 40 }: WhatsappQrCountdownProps) {
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = useState(cycleSeconds);

  useEffect(() => {
    if (isConnected) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setSecondsLeft((current) => (current <= 1 ? cycleSeconds : current - 1));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [cycleSeconds, isConnected]);

  if (isConnected) {
    return null;
  }

  const progress = (secondsLeft / cycleSeconds) * 100;

  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">El QR puede renovarse en</span>
        <span className="font-semibold text-foreground">{secondsLeft}s</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:bg-muted"
          aria-label="Actualizar QR"
          title="Actualizar QR"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
