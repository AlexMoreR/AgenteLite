"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  UMBRAL_DESLIZAR_PX,
  debeResponder,
  decidirDeslizamiento,
  desplazamientoDeLaBurbuja,
} from "@/lib/deslizar-para-responder";

// Lo que tiene su propio gesto de arrastre: el deslizar no debe pisarlo.
const SELECTOR_SIN_DESLIZAR = '[role="slider"], input[type="range"], audio, [data-no-swipe-reply]';

/**
 * Deslizar la burbuja a la derecha para responderla, como en WhatsApp.
 *
 * Solo dedo. Es la misma accion de "Responder" del menu: aca solo se elige el mensaje, nunca se
 * envia nada. Se apaga con la seleccion abierta y sobre el reproductor de audio.
 */
export function useSwipeToReply(onSwipe: () => void, enabled: boolean) {
  const origenRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const modoRef = useRef<"esperar" | "horizontal" | "vertical">("esperar");
  const dxRef = useRef(0);
  const vibroRef = useRef(false);
  // El deslizamiento termina en "click" al levantar el dedo: hay que tragarselo para no abrir
  // la foto o el documento de abajo.
  const firedRef = useRef(false);
  const [dx, setDx] = useState(0);

  const terminar = useCallback(() => {
    origenRef.current = null;
    modoRef.current = "esperar";
    dxRef.current = 0;
    vibroRef.current = false;
    setDx(0);
  }, []);

  useEffect(() => terminar, [terminar]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!enabled || event.pointerType !== "touch" || !event.isPrimary) {
        return;
      }
      if ((event.target as Element | null)?.closest?.(SELECTOR_SIN_DESLIZAR)) {
        return;
      }
      firedRef.current = false;
      origenRef.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
      modoRef.current = "esperar";
      dxRef.current = 0;
      vibroRef.current = false;
    },
    [enabled],
  );

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const origen = origenRef.current;
    if (!origen || event.pointerId !== origen.id || modoRef.current === "vertical") {
      return;
    }
    const movX = event.clientX - origen.x;
    const movY = event.clientY - origen.y;
    if (modoRef.current === "esperar") {
      const decision = decidirDeslizamiento(movX, movY);
      if (decision === "esperar") {
        return;
      }
      modoRef.current = decision;
      if (decision === "vertical") {
        return;
      }
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Sin captura igual funciona mientras el dedo siga encima.
      }
    }
    dxRef.current = movX;
    setDx(desplazamientoDeLaBurbuja(movX));
    if (!vibroRef.current && debeResponder(movX)) {
      vibroRef.current = true;
      navigator.vibrate?.(10);
    }
  }, []);

  const onPointerUp = useCallback(() => {
    const deslizo = modoRef.current === "horizontal";
    if (deslizo) {
      firedRef.current = true;
      if (debeResponder(dxRef.current)) {
        onSwipe();
      }
    }
    terminar();
  }, [onSwipe, terminar]);

  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (!firedRef.current) {
      return;
    }
    firedRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    /** Cuanto se movio la burbuja (px), para el translateX. */
    dx,
    /** 0 a 1: que tan cerca esta del umbral, para la flechita. */
    progreso: Math.min(dx / UMBRAL_DESLIZAR_PX, 1),
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: terminar,
      onClickCapture,
    },
  };
}
