/**
 * Server-Timing para las rutas de Chats (fase 0 de "Chats instantaneo": medir antes de tocar).
 *
 * Cada ruta marca sus pasos (`t.marca("auth")`) y el envoltorio agrega el total y escribe la
 * cabecera `Server-Timing`, que se ve en la pestaña Network del navegador. No cambia la respuesta.
 *
 * Con `log`, ademas escribe UNA linea en los logs del contenedor por pedido:
 *   [timing] {"ruta":"chats/list","status":200,"ms":182.4,"pasos":{"auth":20.1,...}}
 * La cabecera solo la ve quien tiene el navegador abierto; esta linea deja comparar antes y
 * despues de un cambio en Portainer (buscar "[timing]"). No toca la base ni la respuesta.
 */
export type MedidorServerTiming = {
  /** Cierra el paso que venia corriendo con este nombre (ms desde la marca anterior). */
  marca: (nombre: string) => void;
};

export function conServerTiming(
  manejador: (request: Request, t: MedidorServerTiming) => Promise<Response>,
  opciones: { log?: string } = {},
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

    let respuesta: Response;
    try {
      respuesta = await manejador(request, t);
    } catch (error) {
      if (opciones.log) {
        escribirLinea(opciones.log, 500, performance.now() - inicio, pasos);
      }
      throw error;
    }
    const total = performance.now() - inicio;
    pasos.push(["total", total]);
    const valor = pasos
      .map(([nombre, ms]) => `${nombre.replace(/[^a-zA-Z0-9_-]/g, "")};dur=${ms.toFixed(1)}`)
      .join(", ");
    try {
      respuesta.headers.set("Server-Timing", valor);
    } catch {
      // Cabeceras inmutables (no deberia pasar con NextResponse): se omite la medicion.
    }
    if (opciones.log) {
      escribirLinea(opciones.log, respuesta.status, total, pasos.slice(0, -1));
    }
    return respuesta;
  };
}

function escribirLinea(ruta: string, status: number, ms: number, pasos: Array<[string, number]>) {
  try {
    console.log(
      `[timing] ${JSON.stringify({
        ruta,
        status,
        ms: Math.round(ms * 10) / 10,
        pasos: Object.fromEntries(pasos.map(([nombre, duracion]) => [nombre, Math.round(duracion * 10) / 10])),
      })}`,
    );
  } catch {
    // Medir nunca rompe un pedido.
  }
}
