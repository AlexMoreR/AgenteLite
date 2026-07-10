"use client";

import { useEffect, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";

type WhatsappQrStaleWatcherProps = {
  qrDataUrl: string;
  isConnected: boolean;
};

// Un QR de WhatsApp sano rota cada ~20s. Si el MISMO QR sigue igual pasado este umbral,
// significa que Evolution no está generando uno nuevo (instancia pegada) y el QR ya venció.
const STALE_AFTER_MS = 45_000;

/**
 * Detecta cuando el QR mostrado lleva demasiado tiempo sin cambiar (vencido). El detalle del
 * canal hace router.refresh() cada 3s: si el `qrDataUrl` cambia, reiniciamos el reloj; si no
 * cambia en STALE_AFTER_MS, avisamos que el QR no sirve y sugerimos crear una cuenta nueva.
 */
export function WhatsappQrStaleWatcher({ qrDataUrl, isConnected }: WhatsappQrStaleWatcherProps) {
  const [isStale, setIsStale] = useState(false);
  const lastQrRef = useRef<string>(qrDataUrl);
  const changedAtRef = useRef<number>(0);

  // Stamp inicial tras montar (no llamamos Date.now() durante el render).
  useEffect(() => {
    changedAtRef.current = Date.now();
  }, []);

  // Cada vez que el QR cambia, reinicia el reloj de "vencimiento".
  useEffect(() => {
    if (qrDataUrl !== lastQrRef.current) {
      lastQrRef.current = qrDataUrl;
      changedAtRef.current = Date.now();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsStale(false);
    }
  }, [qrDataUrl]);

  useEffect(() => {
    // Si está conectado o no hay QR, no vigilamos (el render de abajo ya oculta la alerta).
    if (isConnected || !qrDataUrl) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (changedAtRef.current > 0 && Date.now() - changedAtRef.current > STALE_AFTER_MS) {
        setIsStale(true);
      }
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, [isConnected, qrDataUrl]);

  if (!isStale || isConnected) {
    return null;
  }

  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-800">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <p className="text-xs leading-5">
        Este QR parece <span className="font-semibold">vencido</span>: no se ha generado uno nuevo.
        Escanéalo cuanto antes, y si no conecta, usa <span className="font-semibold">&ldquo;Crear cuenta nueva&rdquo;</span>.
      </p>
    </div>
  );
}
