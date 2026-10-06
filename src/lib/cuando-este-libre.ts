/**
 * Corre una tarea cuando el navegador queda libre (requestIdleCallback; sin el, a los 300 ms).
 *
 * Para lecturas secundarias al abrir un chat: las server actions de Next se atienden de a una, asi
 * que una lectura que sale primero hace esperar a un envio inmediato. Devuelve como cancelarla.
 */
export function cuandoEsteLibre(tarea: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(() => tarea(), { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(tarea, 300);
  return () => window.clearTimeout(id);
}
