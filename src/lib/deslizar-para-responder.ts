// Reglas puras del gesto "deslizar un mensaje a la derecha para responderlo" (como WhatsApp).
// Sin React ni navegador: las usa el hook use-swipe-to-reply y las prueba check-deslizar-para-responder.

/** Cuanto hay que arrastrar a la derecha (px) para que, al soltar, se abra la respuesta. */
export const UMBRAL_DESLIZAR_PX = 60;
/** Lo maximo que la burbuja sigue al dedo (px): un tope, como en WhatsApp. */
export const TOPE_DESLIZAR_PX = 88;
/** Movimiento minimo (px) para decidir si el dedo va de lado o va scrolleando. */
export const DECISION_DESLIZAR_PX = 8;

export type DecisionDeDeslizar = "esperar" | "horizontal" | "vertical";

/**
 * Con el movimiento acumulado del dedo decide de que gesto se trata.
 * Solo cuenta un arrastre a la derecha y mayormente horizontal; todo lo demas
 * (scroll vertical, arrastre a la izquierda) se deja pasar y no se toca.
 */
export function decidirDeslizamiento(dx: number, dy: number): DecisionDeDeslizar {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < DECISION_DESLIZAR_PX && ay < DECISION_DESLIZAR_PX) {
    return "esperar";
  }
  if (dx > 0 && ax > ay * 1.5) {
    return "horizontal";
  }
  return "vertical";
}

/** Cuanto se mueve la burbuja: sigue al dedo y se frena en el tope. Nunca va a la izquierda. */
export function desplazamientoDeLaBurbuja(dx: number): number {
  return Math.min(Math.max(dx, 0), TOPE_DESLIZAR_PX);
}

/** Al soltar: true si el arrastre llego al umbral y hay que abrir la respuesta. */
export function debeResponder(dx: number): boolean {
  return dx >= UMBRAL_DESLIZAR_PX;
}
