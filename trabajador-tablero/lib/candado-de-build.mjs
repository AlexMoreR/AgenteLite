// QUE NO CHOQUEN LOS BUILDS (26-oct-2026). La tarjeta "Cerebro" quedó en ERROR con "Unable to acquire lock ... another
// instance of next build running": aizen1 compilaba otra cosa a la vez en la misma carpeta.
//
//   1. Un build a la vez por carpeta: `candadosDeBuild.tomar(carpeta)` hace fila (la cola de pasos pesados de cola.mjs
//      ya hace fila entre todas las sesiones; esto cubre además dos builds en la MISMA carpeta, p. ej. la verificación
//      y una subida que reutilizan el worktree).
//   2. Si aun así Next dice que el candado está tomado, se espera un minuto, se limpia el candado viejo (el que llama
//      lo limpia con `limpiar`: cierra procesos de la carpeta y borra .next/lock) y se reintenta.
//   3. Esas esperas NO cuentan como intento: si se acaban los reintentos, el error lleva `candadoDeBuild: true` y el
//      Coordinador (diagnostico.mjs: decidir) suelta la tarjeta sin error y sin gastar intento ni reparación.
// Puro en lo posible: sin procesos; el reloj y la limpieza se pueden cambiar (las pruebas).

/** Lo que dice Next (o npm) cuando otro build tiene tomado el candado de la carpeta. */
export const AVISO_DE_CANDADO = /unable to acquire lock|another instance of next build|another next build|next build process|\.next[\\/]+lock|el build est[aá] ocupado/i;

export const esAvisoDeCandado = (texto) => AVISO_DE_CANDADO.test(String(texto ?? ""));

/** Lo que viene por defecto en config.candadoDeBuild. */
export const CANDADO_DE_BUILD_POR_DEFECTO = { reintentos: 3, esperaSegundos: 60 };

/** Dormir `ms`, o menos si la señal se aborta (la tarjeta venció). */
function dormir(ms, senal) {
  return new Promise((resolver) => {
    if (senal?.aborted) return resolver();
    const reloj = setTimeout(() => {
      senal?.removeEventListener?.("abort", cortar);
      resolver();
    }, ms);
    function cortar() {
      clearTimeout(reloj);
      resolver();
    }
    senal?.addEventListener?.("abort", cortar, { once: true });
  });
}

const llave = (carpeta) => String(carpeta ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * Un candado por carpeta: `tomar(carpeta, senal)` espera su turno (de a uno por carpeta, en orden de llegada) y devuelve la
 * función que lo libera (una sola vez). Si la señal se aborta esperando, rechaza.
 */
export function crearCandadosDeBuild() {
  /** carpeta -> { ocupado: boolean, fila: [{ entregar, cancelar }] } */
  const carpetas = new Map();
  const entregarSiguiente = (clave) => {
    const estado = carpetas.get(clave);
    if (!estado) return;
    const siguiente = estado.fila.shift();
    if (siguiente) siguiente.entregar();
    else {
      estado.ocupado = false;
      carpetas.delete(clave);
    }
  };
  return {
    tomar(carpeta, senal) {
      const clave = llave(carpeta);
      return new Promise((resolver, rechazar) => {
        const estado = carpetas.get(clave) ?? { ocupado: false, fila: [] };
        carpetas.set(clave, estado);
        let liberada = false;
        const liberar = () => {
          if (liberada) return;
          liberada = true;
          entregarSiguiente(clave);
        };
        const entrada = {
          entregar: () => {
            senal?.removeEventListener?.("abort", cancelar);
            resolver(liberar);
          },
        };
        function cancelar() {
          const indice = estado.fila.indexOf(entrada);
          if (indice >= 0) estado.fila.splice(indice, 1);
          rechazar(Object.assign(new Error(`Se canceló la espera del candado de build de ${carpeta}.`), { cancelado: true }));
        }
        if (senal?.aborted) return cancelar();
        if (!estado.ocupado) {
          estado.ocupado = true;
          resolver(liberar);
          return;
        }
        estado.fila.push(entrada);
        senal?.addEventListener?.("abort", cancelar, { once: true });
      });
    },
    /** Cuántos builds esperan turno en esa carpeta (para el log y las pruebas). */
    esperando: (carpeta) => carpetas.get(llave(carpeta))?.fila.length ?? 0,
    ocupada: (carpeta) => carpetas.get(llave(carpeta))?.ocupado ?? false,
  };
}

/** El de todo el proceso del Coordinador. */
export const candadosDeBuild = crearCandadosDeBuild();

/**
 * Corre `fn` (el build); si falla con el aviso del candado, espera `esperaMs`, limpia el candado viejo y reintenta, hasta
 * `reintentos` veces. Estas esperas no cuentan como intento. Si se acaban, lanza el último error con `candadoDeBuild: true`.
 * Cualquier otro error pasa tal cual. `despuesDeEsperar(ms)` avisa cuánto se esperó (el reloj de la etapa no lo descuenta).
 */
export async function conReintentoDeCandado(fn, { reintentos = CANDADO_DE_BUILD_POR_DEFECTO.reintentos, esperaMs = CANDADO_DE_BUILD_POR_DEFECTO.esperaSegundos * 1000, limpiar, alEsperar, despuesDeEsperar, senal } = {}) {
  for (let vez = 0; ; vez += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!esAvisoDeCandado(error?.message) || senal?.aborted) throw error;
      if (vez >= reintentos) {
        error.candadoDeBuild = true;
        throw error;
      }
      alEsperar?.(vez + 1, esperaMs);
      const inicio = Date.now();
      await dormir(esperaMs, senal);
      try {
        await limpiar?.();
      } catch {
        // Limpiar no puede tumbar la tarjeta.
      }
      despuesDeEsperar?.(Date.now() - inicio);
    }
  }
}
