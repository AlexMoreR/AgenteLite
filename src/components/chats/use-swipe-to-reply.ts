import { useCallback, useEffect, useRef, useState } from "react";

// Deslizar una burbuja a la derecha para responderla, como en WhatsApp.
// Solo abre la respuesta citada (la misma funcion `onReply` del menu): no envia nada.

/** Cuanto hay que arrastrar a la derecha (px) para que al soltar se abra la respuesta. */
export const SWIPE_REPLY_THRESHOLD = 60;
/** Hasta donde sigue la burbuja al dedo (px). */
export const SWIPE_REPLY_MAX_OFFSET = 80;
/** Desde que se mueve mas que esto (px) se decide si el gesto es horizontal o vertical. */
export const SWIPE_REPLY_DECIDE_DISTANCE = 10;

export type SwipeEstado = "indeciso" | "horizontal" | "vertical";

/**
 * Decide que gesto es segun lo que se movio el dedo. Horizontal solo si va a la derecha y
 * claramente mas de lado que hacia arriba o abajo; si no, es scroll (o un gesto hacia la izquierda).
 */
export function clasificarGesto(dx: number, dy: number): SwipeEstado {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < SWIPE_REPLY_DECIDE_DISTANCE) {
    return "indeciso";
  }
  return dx > 0 && ax > ay * 1.5 ? "horizontal" : "vertical";
}

export function desplazamientoDelSwipe(dx: number): number {
  return Math.min(Math.max(dx, 0), SWIPE_REPLY_MAX_OFFSET);
}

export function swipeAlcanzaUmbral(dx: number): boolean {
  return dx >= SWIPE_REPLY_THRESHOLD;
}

// Los reproductores de audio y sus barras tienen su propio gesto de arrastre.
const SELECTOR_SIN_SWIPE = 'audio, video, input, [role="slider"], [data-no-swipe]';

export function useSwipeToReply(onReply: () => void, enabled: boolean) {
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const estadoRef = useRef<SwipeEstado>("indeciso");
  const dxRef = useRef(0);
  const vibroRef = useRef(false);
  // Al soltar tras un deslizamiento llega un "click": hay que tragarselo para no abrir la foto.
  const firedRef = useRef(false);
  const [offset, setOffset] = useState(0);
  const [arrastrando, setArrastrando] = useState(false);

  const reset = useCallback(() => {
    originRef.current = null;
    estadoRef.current = "indeciso";
    dxRef.current = 0;
    vibroRef.current = false;
    setOffset(0);
    setArrastrando(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      reset();
    }
  }, [enabled, reset]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!enabled || event.pointerType !== "touch" || !event.isPrimary) {
        return;
      }
      if (event.target instanceof Element && event.target.closest(SELECTOR_SIN_SWIPE)) {
        return;
      }
      firedRef.current = false;
      originRef.current = { x: event.clientX, y: event.clientY };
      estadoRef.current = "indeciso";
      dxRef.current = 0;
      vibroRef.current = false;
    },
    [enabled],
  );

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const origin = originRef.current;
    if (!origin || estadoRef.current === "vertical") {
      return;
    }
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    if (estadoRef.current === "indeciso") {
      const decision = clasificarGesto(dx, dy);
      if (decision === "indeciso") {
        return;
      }
      estadoRef.current = decision;
      if (decision === "vertical") {
        return;
      }
      setArrastrando(true);
    }
    dxRef.current = dx;
    setOffset(desplazamientoDelSwipe(dx));
    if (swipeAlcanzaUmbral(dx) && !vibroRef.current) {
      vibroRef.current = true;
      navigator.vibrate?.(10);
    }
  }, []);

  const onPointerUp = useCallback(() => {
    const abrir = estadoRef.current === "horizontal" && swipeAlcanzaUmbral(dxRef.current);
    if (estadoRef.current === "horizontal") {
      firedRef.current = true;
    }
    reset();
    if (abrir) {
      onReply();
    }
  }, [onReply, reset]);

  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (!firedRef.current) {
      return;
    }
    firedRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: reset, onClickCapture },
    offset,
    arrastrando,
    listo: swipeAlcanzaUmbral(offset),
  };
}
