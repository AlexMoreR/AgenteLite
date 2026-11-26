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
 *
 * La misma linea trae (desde el 08-10-2026, ver medicion-de-pedido.ts):
 *   "poolEspera": pedidos esperando conexion del pool al EMPEZAR este (cola de conexiones).
 *   "consultas":  consultas SQL que mando este pedido a Postgres.
 *
 * Y (desde el 26-11-2026) "retrasoEventLoop": {"p99":..,"max":..} en ms, el retraso del event loop
 * de Node desde la linea [timing] anterior (de cualquier ruta). Si es alto y poolEspera es bajo, la
 * lentitud viene de Node (CPU, codigo sincrono) y no de la base. Solo va en el log, no en la cabecera.
 */
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { esperaDelPool, medirPedido } from "@/lib/medicion-de-pedido";

/*
  Un solo monitor del event loop para todo el proceso (igual que en migrar-tanda.ts). Se prende la
  primera vez que un pedido con log lo necesita, y cada linea [timing] lo reinicia: asi cada pedido
  mide desde el anterior. Medir nunca rompe un pedido: si algo falla, la linea sale sin el campo.
*/
let retrasoDelEventLoop: IntervalHistogram | null = null;

function prenderMonitorDelEventLoop() {
  if (retrasoDelEventLoop) return;
  try {
    const monitor = monitorEventLoopDelay({ resolution: 20 });
    monitor.enable();
    retrasoDelEventLoop = monitor;
  } catch {
    // Sin monitor: la linea [timing] sale sin retrasoEventLoop.
  }
}

/** p99 y maximo del retraso del event loop (ms, redondeados) desde la lectura anterior; null si falla. */
function leerRetrasoDelEventLoop(): { p99: number; max: number } | null {
  if (!retrasoDelEventLoop) return null;
  try {
    const p99 = Math.round(retrasoDelEventLoop.percentile(99) / 1e6);
    const max = Math.round(retrasoDelEventLoop.max / 1e6);
    retrasoDelEventLoop.reset();
    return Number.isFinite(p99) && Number.isFinite(max) ? { p99, max } : null;
  } catch {
    return null;
  }
}

export type MedidorServerTiming = {
  /** Cierra el paso que venia corriendo con este nombre (ms desde la marca anterior). */
  marca: (nombre: string) => void;
};

export function conServerTiming(
  manejador: (request: Request, t: MedidorServerTiming) => Promise<Response>,
  opciones: { log?: string } = {},
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (opciones.log) prenderMonitorDelEventLoop();
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

    const poolEspera = esperaDelPool();
    const { contador, resultado } = medirPedido(() => manejador(request, t));
    const extra = () => ({ poolEspera, consultas: contador.consultas, externas: contador.externas ?? [] });

    let respuesta: Response;
    try {
      respuesta = await resultado;
    } catch (error) {
      if (opciones.log) {
        escribirLinea(opciones.log, 500, performance.now() - inicio, pasos, extra());
      }
      throw error;
    }
    const total = performance.now() - inicio;
    pasos.push(["total", total]);
    // Las llamadas a WAHA (y otros de afuera) que terminaron dentro del pedido, para ver cual tarda.
    const externas = (contador.externas ?? []).slice(0, 20);
    /*
      Cuantas consultas SQL hizo el pedido y cuantos esperaban conexion al empezar, tambien en la
      cabecera (19-nov-2026): antes solo salian en la linea [timing] del servidor, y desde el
      navegador no se podia contar cuantas consultas cuesta cada accion. Van como "dur" porque es lo
      unico que el navegador expone como numero (PerformanceResourceTiming.serverTiming).
    */
    const conteos: Array<[string, number]> = [["consultas", contador.consultas]];
    if (typeof poolEspera === "number") {
      conteos.push(["poolEspera", poolEspera]);
    }
    const valor = [...pasos, ...conteos, ...externas]
      .map(([nombre, ms]) => `${nombre.replace(/[^a-zA-Z0-9_-]/g, "")};dur=${ms.toFixed(1)}`)
      .join(", ");
    try {
      respuesta.headers.set("Server-Timing", valor);
    } catch {
      // Cabeceras inmutables (no deberia pasar con NextResponse): se omite la medicion.
    }
    if (opciones.log) {
      escribirLinea(opciones.log, respuesta.status, total, pasos.slice(0, -1), extra());
    }
    return respuesta;
  };
}

function escribirLinea(
  ruta: string,
  status: number,
  ms: number,
  pasos: Array<[string, number]>,
  extra: { poolEspera: number | null; consultas: number; externas?: Array<[string, number]> },
) {
  try {
    const retrasoEventLoop = leerRetrasoDelEventLoop();
    console.log(
      `[timing] ${JSON.stringify({
        ruta,
        status,
        ms: Math.round(ms * 10) / 10,
        pasos: Object.fromEntries(pasos.map(([nombre, duracion]) => [nombre, Math.round(duracion * 10) / 10])),
        poolEspera: extra.poolEspera,
        consultas: extra.consultas,
        ...(retrasoEventLoop ? { retrasoEventLoop } : {}),
        ...(extra.externas?.length
          ? { externas: extra.externas.map(([nombre, duracion]) => [nombre, Math.round(duracion)]) }
          : {}),
      })}`,
    );
  } catch {
    // Medir nunca rompe un pedido.
  }
}
