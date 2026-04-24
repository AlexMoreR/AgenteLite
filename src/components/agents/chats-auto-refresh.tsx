"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type ChatsAutoRefreshProps = {
  intervalMs?: number;
  enabled?: boolean;
};

export function ChatsAutoRefresh({ intervalMs = 5000, enabled = true }: ChatsAutoRefreshProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [isVisible, setIsVisible] = useState(() => (typeof document === "undefined" ? true : document.visibilityState === "visible"));

  useEffect(() => {
    function handleVisibilityChange() {
      setIsVisible(document.visibilityState === "visible");
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    handleVisibilityChange();

    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (!enabled || !isVisible) {
      return;
    }

    const timer = window.setInterval(() => {
      startTransition(() => {
        router.refresh();
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [enabled, isVisible, intervalMs, pathname, router, searchParams, startTransition]);

  return null;
}
