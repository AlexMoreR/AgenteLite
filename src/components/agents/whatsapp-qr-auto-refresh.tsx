"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type WhatsappQrAutoRefreshProps = {
  isConnected: boolean;
};

export function WhatsappQrAutoRefresh({ isConnected }: WhatsappQrAutoRefreshProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (isConnected) {
      if (searchParams.has("error")) {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("error");
        const nextUrl = params.toString() ? `${pathname}?${params}` : pathname;
        router.replace(nextUrl);
      }
      return;
    }

    const intervalId = window.setInterval(() => {
      router.refresh();
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, [isConnected, pathname, router, searchParams]);

  if (isConnected) {
    return null;
  }

  return null;
}
