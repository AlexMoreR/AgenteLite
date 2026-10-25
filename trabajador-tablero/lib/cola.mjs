// La COLA DE PASOS PESADOS de aizen1 (25-oct-2026). aizen1 es un Core i3 de 2 núcleos: con 2 o 3 sesiones a la vez,
// dos `npm ci`, `eslint .`, `tsc` o `next build` juntos se pisaban (23-24-oct-2026: npm ci, build y pruebas pasadas de
// tiempo, ".next/lock", y antes de que Claude empezara a escribir ya se iban 8 a 38 min en instalar y medir el lint).
//
// Las sesiones de Claude (que casi no usan el procesador: esperan a la API) siguen corriendo en paralelo; lo que pasa
// por esta cola son los comandos pesados: instalar, lint, prisma generate, tsc, build, pruebas y el ensayo de la
// migración. Corren de a `maximo` (1 por defecto) en todo aizen1, con prioridad: primero lo que está más cerca de
// HECHO (subir), después verificar lo que ya se construyó, y al final instalar para empezar una nueva.
// Pura (sin procesos ni disco): se prueba con relojes falsos.

/** Prioridades: número más chico pasa primero. Dentro de la misma prioridad, en orden de llegada. */
export const PRIORIDAD = { subir: 0, verificar: 1, preparar: 2 };

/**
 * Una cola de `maximo` puestos con prioridad.
 *   tomar({ prioridad, senal, que }) -> Promise<liberar>  (espera su turno; rechaza si la señal se aborta esperando)
 *   estado() -> { maximo, ocupados, esperando, corriendo: [que…], enFila: [que…] }
 */
export function crearColaPesada({ maximo = 1, ahora = () => Date.now() } = {}) {
  const tope = Math.max(1, Math.floor(Number(maximo)) || 1);
  let ocupados = 0;
  let llegadas = 0;
  const corriendo = new Map();
  const fila = [];

  const entregar = () => {
    while (ocupados < tope && fila.length) {
      fila.sort((a, b) => a.prioridad - b.prioridad || a.orden - b.orden);
      const siguiente = fila.shift();
      ocupados += 1;
      siguiente.entregar();
    }
  };

  return {
    tomar({ prioridad = PRIORIDAD.preparar, senal, que = "un paso pesado" } = {}) {
      return new Promise((resolver, rechazar) => {
        const entrada = { prioridad, orden: (llegadas += 1), que, desde: ahora() };
        let liberada = false;
        const liberar = () => {
          if (liberada) return;
          liberada = true;
          ocupados -= 1;
          corriendo.delete(entrada);
          entregar();
        };
        function cancelar() {
          const indice = fila.indexOf(entrada);
          if (indice >= 0) fila.splice(indice, 1);
          rechazar(Object.assign(new Error(`Se canceló la espera en la cola de pasos pesados (${que}).`), { cancelado: true }));
        }
        entrada.entregar = () => {
          senal?.removeEventListener?.("abort", cancelar);
          corriendo.set(entrada, que);
          resolver(liberar);
        };
        if (senal?.aborted) {
          cancelar();
          return;
        }
        fila.push(entrada);
        senal?.addEventListener?.("abort", cancelar, { once: true });
        entregar();
      });
    },
    estado() {
      return {
        maximo: tope,
        ocupados,
        esperando: fila.length,
        corriendo: [...corriendo.values()],
        enFila: [...fila].sort((a, b) => a.prioridad - b.prioridad || a.orden - b.orden).map((entrada) => entrada.que),
      };
    },
  };
}

/** Una cola que no hace esperar a nadie (cuando no hay planificador: --una-vez y pruebas sueltas). */
export const COLA_LIBRE = {
  tomar: async () => () => undefined,
  estado: () => ({ maximo: Infinity, ocupados: 0, esperando: 0, corriendo: [], enFila: [] }),
};
