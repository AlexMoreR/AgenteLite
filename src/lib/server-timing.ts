/**
 * Server-Timing para las rutas de Chats (fase 0 de "Chats instantaneo": medir antes de tocar).
 *
 * Cada ruta marca sus pasos (`t.marca("auth")`) y el envoltorio agrega el total y escribe la
 * cabecera `Server-Timing`, que se ve en la pestaña Network del navegador. No cambia la respuesta.
 */
export type MedidorServerTiming = {
  /** Cierra el paso que venia corriendo con este nombre (ms desde la marca anterior). */
  marca: (nombre: string) => void;
};

export function conServerTiming(
  manejador: (request: Request, t: MedidorServerTiming) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const inicio = performance.now();
    let ultimo = inicio;
    const pasos: Array<[string, number]> = [];
    const t: MedidorServerTiming = {
      marca(nombre) {
        const ahora = performance.now();
        pasos.push([nombre, ahora - ultimo]);
        ultimo = ahora;
      },
    };

    const respuesta = await manejador(request, t);
    pasos.push(["total", performance.now() - inicio]);
    const valor = pasos
      .map(([nombre, ms]) => `${nombre.replace(/[^a-zA-Z0-9_-]/g, "")};dur=${ms.toFixed(1)}`)
      .join(", ");
    try {
      respuesta.headers.set("Server-Timing", valor);
    } catch {
      // Cabeceras inmutables (no deberia pasar con NextResponse): se omite la medicion.
    }
    return respuesta;
  };
}
