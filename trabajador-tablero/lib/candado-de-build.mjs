// QUE LOS BUILDS NO CHOQUEN (26-oct-2026). Dos `next build` a la vez en la misma carpeta se pelean por `.next/lock`
// ("Unable to acquire lock … another instance of next build running"): una tarjeta (Cerebro) terminó en ERROR por eso.
//
// Dos piezas, ambas con relojes inyectables para probarlas sin esperar de verdad:
//   - crearSerieDeBuilds: en cada carpeta corre UN build a la vez; el siguiente hace fila (en el orden en que llegó).
//     Encima de la cola de pasos pesados de aizen1 (cola.mjs, un paso pesado a la vez en todo el PC): esta protege la
//     misma carpeta aunque la cola esté apagada (colaPesada.maximo = 0) o admita más de uno.
//   - conReintentoPorCandado: si aun así aparece el aviso de candado, espera, limpia el candado viejo SI el otro build ya
//     terminó y reintenta. Esas esperas NO cuentan como intento (no pasan por el CRM) ni se descuentan del reloj de la etapa.
import path from "node:path";

/** El aviso de candado de Next (y de git) cuando otro proceso tiene la carpeta. */
const AVISO_DE_CANDADO = /unable to acquire lock|another instance of next build|\.next[\\/]+lock|next build process|el build est[aá] ocupado/i;

/** ¿Este error (o texto) es el aviso de candado? */
export function esAvisoDeCandado(error) {
  const texto = typeof error === "string" ? error : `${error?.message ?? ""}\n${error?.detalle ?? ""}`;
  return AVISO_DE_CANDADO.test(texto);
}

/**
 * Una serie de builds por carpeta: `correr(carpeta, fn)` ejecuta `fn` cuando los anteriores de esa carpeta terminaron (bien o mal).
 * `estado()` dice cuántos corren y cuántos están en fila.
 */
export function crearSerieDeBuilds() {
  const colas = new Map();
  let corriendo = 0;
  let enFila = 0;
  return {
    async correr(carpeta, fn) {
      const llave = path.resolve(String(carpeta));
      const anterior = colas.get(llave) ?? Promise.resolve();
      let liberar;
      const mio = new Promise((resolver) => {
        liberar = resolver;
      });
      const cola = anterior.then(() => mio);
      colas.set(llave, cola);
      enFila += 1;
      await anterior;
      enFila -= 1;
      corriendo += 1;
      try {
        return await fn();
      } finally {
        corriendo -= 1;
        liberar();
        // Si nadie más hizo fila detrás de este, la carpeta queda libre.
        if (colas.get(llave) === cola) colas.delete(llave);
      }
    },
    estado: () => ({ corriendo, enFila }),
  };
}

/**
 * Corre `fn` (un build). Si falla con el aviso de candado: espera `esperaMs`, limpia el candado viejo si el otro build ya
 * terminó (`hayOtroBuild()` en false) y reintenta, hasta `maximoEsperas` veces. Cualquier otro error, o pasadas las esperas,
 * se relanza tal cual. -> { valor, esperas } (esperas = cuántas veces esperó: NO cuentan como intento de la tarjeta).
 *   limpiar()        borra el `.next/lock` viejo
 *   hayOtroBuild()   ¿hay otro build corriendo en esta carpeta? (si sí, no se toca el candado)
 *   esperar(ms)      duerme (inyectable)
 *   extender(ms)     devuelve ese tiempo al reloj de la etapa
 */
export async function conReintentoPorCandado(fn, { maximoEsperas = 10, esperaMs = 60_000, limpiar = async () => {}, hayOtroBuild = () => false, esperar = (ms) => new Promise((r) => setTimeout(r, ms)), extender = () => {}, registro = null, senal = null } = {}) {
  let esperas = 0;
  for (;;) {
    try {
      return { valor: await fn(), esperas };
    } catch (error) {
      if (!esAvisoDeCandado(error) || esperas >= maximoEsperas || senal?.aborted) throw error;
      esperas += 1;
      registro?.aviso?.(`el build encontró el candado (${esperas} de ${maximoEsperas}): espero ${Math.round(esperaMs / 1000)} s y reintento; la espera no cuenta como intento`);
      await esperar(esperaMs);
      extender(esperaMs);
      if (!(await hayOtroBuild())) await limpiar();
    }
  }
}
