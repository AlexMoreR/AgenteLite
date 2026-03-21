"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type ChatsAutoRefreshProps = {
  intervalMs?: number;
};

export function ChatsAutoRefresh({ intervalMs = 3000 }: ChatsAutoRefreshProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const timer = window.setInterval(() => {
      router.refresh();
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [router, intervalMs, pathname, searchParams]);

  return null;
}
