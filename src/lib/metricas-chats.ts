/**
 * Medicion de Chats en el navegador (fase 0 de "Chats instantaneo": medir antes de tocar).
 *
 * Toma tiempos con `performance.now()` y los manda agrupados cada 10 s con `sendBeacon` a
 * POST /api/metricas/chats, que solo los escribe en el log. Nunca cambia lo que hace la bandeja:
 * todo va en try/catch y, si algo falla, la medicion se pierde y la pantalla sigue igual.
 *
 * Uso: `iniciarMedicion("abrir:<chatKey>")` donde empieza la accion y
 * `terminarMedicionAlPintar("abrir:<chatKey>", "abrir_chat", { origen: "cache" })` donde termina.
 */

type Extra = Record<string, string | number | boolean>;
type Medicion = { m: string; ms: number } & Extra;

const ENDPOINT = "/api/metricas/chats";
const INTERVALO_MS = 10_000;
const MAX_EN_COLA = 100;
// Una marca abierta mas vieja que esto ya no mide lo que deberia (la accion se abandono).
const MARCA_VENCIDA_MS = 60_000;

const marcas = new Map<string, number>();
const cola: Medicion[] = [];
let temporizador: ReturnType<typeof setInterval> | null = null;
let escuchandoSalida = false;

function hayNavegador() {
  return typeof window !== "undefined" && typeof performance !== "undefined";
}

function dispositivo(): "movil" | "escritorio" {
  try {
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? "movil" : "escritorio";
  } catch {
    return "escritorio";
  }
}

function enviar() {
  if (cola.length === 0 || !hayNavegador()) {
    return;
  }
  const lote = cola.splice(0, cola.length);
  try {
    const cuerpo = JSON.stringify({ dispositivo: dispositivo(), mediciones: lote });
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(ENDPOINT, new Blob([cuerpo], { type: "application/json" }));
    }
  } catch {
    // La medicion es prescindible.
  }
}

function asegurarEnvioPeriodico() {
  if (!hayNavegador()) {
    return;
  }
  if (!temporizador) {
    temporizador = setInterval(enviar, INTERVALO_MS);
  }
  if (!escuchandoSalida) {
    escuchandoSalida = true;
    try {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          enviar();
        }
      });
      window.addEventListener("pagehide", enviar);
    } catch {
      // Sin eventos de salida: lo que quede en cola se manda en el proximo intervalo.
    }
  }
}

/** Agrega una medicion ya calculada a la cola. */
export function registrarMedicion(metrica: string, ms: number, extra?: Extra) {
  if (!hayNavegador() || !Number.isFinite(ms) || ms < 0) {
    return;
  }
  try {
    if (cola.length >= MAX_EN_COLA) {
      cola.shift();
    }
    cola.push({ ...(extra ?? {}), m: metrica, ms: Math.round(ms) });
    asegurarEnvioPeriodico();
  } catch {
    // La medicion es prescindible.
  }
}

/** Abre una marca. Si ya habia una con la misma clave, la pisa (cuenta el ultimo intento). */
export function iniciarMedicion(clave: string) {
  if (!hayNavegador()) {
    return;
  }
  marcas.set(clave, performance.now());
}

/** Si la marca esta abierta, la cierra y registra el tiempo transcurrido. */
export function terminarMedicion(clave: string, metrica: string, extra?: Extra) {
  if (!hayNavegador()) {
    return;
  }
  const inicio = marcas.get(clave);
  if (inicio === undefined) {
    return;
  }
  marcas.delete(clave);
  const ms = performance.now() - inicio;
  if (ms > MARCA_VENCIDA_MS) {
    return;
  }
  registrarMedicion(metrica, ms, extra);
}

/** Si hay una marca abierta con esa clave. */
export function hayMedicionAbierta(clave: string) {
  return marcas.has(clave);
}

/**
 * Cierra la marca cuando el navegador ya pinto el cambio: el siguiente cuadro despues del render.
 * El tiempo se toma al momento del pintado, no al de esta llamada.
 */
export function terminarMedicionAlPintar(clave: string, metrica: string, extra?: Extra) {
  if (!hayNavegador() || !marcas.has(clave)) {
    return;
  }
  try {
    requestAnimationFrame(() => {
      setTimeout(() => terminarMedicion(clave, metrica, extra), 0);
    });
  } catch {
    terminarMedicion(clave, metrica, extra);
  }
}
