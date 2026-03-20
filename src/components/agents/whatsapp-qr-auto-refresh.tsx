"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type WhatsappQrAutoRefreshProps = {
  hasQrCode: boolean;
  isConnected: boolean;
};

export function WhatsappQrAutoRefresh({ hasQrCode, isConnected }: WhatsappQrAutoRefreshProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (hasQrCode || isConnected) {
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
  }, [hasQrCode, isConnected, pathname, router, searchParams]);

  if (hasQrCode || isConnected) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-[rgba(148,163,184,0.14)] bg-white/90 px-4 py-3 text-sm text-slate-600">
      Actualizando el QR automáticamente...
    </div>
  );
}
