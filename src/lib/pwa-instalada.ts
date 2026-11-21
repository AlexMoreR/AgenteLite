/*
  Cómo está abierto el CRM en este dispositivo.

  Lo usan el interruptor de notificaciones de Ajustes y la franja que pide instalar la app en
  iPhone: en iPhone las notificaciones con el CRM cerrado solo llegan si la app está instalada en la
  pantalla de inicio (iOS 16.4+), no abierta en Safari.

  Solo tienen sentido en el navegador: en el servidor devuelven false.
*/

/** iPhone, iPad o iPod, por el agente del navegador. */
export function isProbablyIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** La PWA está instalada y abierta desde la pantalla de inicio (no en una pestaña del navegador). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}
