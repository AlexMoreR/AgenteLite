// Cuidar aizen1 (Core i3, 40 GB de RAM): antes de abrir otra sesión de Claude Code se mira la CPU y la
// memoria. Si alguna pasa del límite de config.limites, no se abre otra (las que corren siguen).
// La CPU es el promedio del último minuto (una muestra cada 5 s): un pico de un segundo no frena nada.
import fs from "node:fs";
import os from "node:os";

function muestraDeCpu() {
  let libre = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const valor of Object.values(cpu.times)) total += valor;
    libre += cpu.times.idle;
  }
  return { libre, total };
}

export function crearMedidor({ cadaMs = 5000, muestras = 12 } = {}) {
  const historial = [muestraDeCpu()];
  const reloj = setInterval(() => {
    historial.push(muestraDeCpu());
    if (historial.length > muestras + 1) historial.shift();
  }, cadaMs);
  reloj.unref?.();

  return {
    /** { cpu, memoria } en % (enteros). */
    medir() {
      const primera = historial[0];
      const ahora = muestraDeCpu();
      const total = ahora.total - primera.total;
      const cpu = total > 0 ? Math.round(100 * (1 - (ahora.libre - primera.libre) / total)) : 0;
      const memoria = Math.round(100 * (1 - os.freemem() / os.totalmem()));
      return { cpu: Math.max(0, Math.min(100, cpu)), memoria };
    },
    parar: () => clearInterval(reloj),
  };
}

/** Una medida suelta (para cuando no hay medidor): la CPU de `ms` milisegundos y la memoria de ahora. */
export async function medirUnaVez(ms = 500) {
  const antes = muestraDeCpu();
  await new Promise((resolver) => setTimeout(resolver, ms));
  const ahora = muestraDeCpu();
  const total = ahora.total - antes.total;
  const cpu = total > 0 ? Math.round(100 * (1 - (ahora.libre - antes.libre) / total)) : 0;
  return { cpu: Math.max(0, Math.min(100, cpu)), memoria: Math.round(100 * (1 - os.freemem() / os.totalmem())) };
}

/**
 * Espera a que el PC tenga recursos (CPU y memoria bajo los límites), hasta `maximoMs`. Devuelve
 * { esperadoMs, liberado } (liberado = false si se acabó el tiempo y sigue saturado). Mira cada `cadaMs`.
 * Se corta (sin lanzar) si se aborta `senal`. `medir` y `dormir` se pueden reemplazar en las pruebas.
 */
export async function esperarRecursos({ medir, limites, maximoMs, cadaMs = 10_000, senal, dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms)), ahora = () => Date.now() }) {
  const inicio = ahora();
  for (;;) {
    if (!faltanRecursos(medir(), limites)) return { esperadoMs: ahora() - inicio, liberado: true };
    if (senal?.aborted || ahora() - inicio >= maximoMs) return { esperadoMs: ahora() - inicio, liberado: false };
    await dormir(Math.min(cadaMs, Math.max(1, maximoMs - (ahora() - inicio))));
  }
}

const GB = 1024 ** 3;
const unDecimal = (bytes) => Math.round((bytes / GB) * 10) / 10;

/**
 * Lo que el panel "Coordinador en vivo" muestra de aizen1 (en GB, con un decimal): memoria usada y total, y el
 * disco donde trabaja el Coordinador (`carpeta`). Lo que no se pueda leer (Node viejo sin `statfsSync`, una
 * carpeta que no existe) queda en null: nunca lanza.
 */
export function leerCarga(carpeta, { statfs = fs.statfsSync } = {}) {
  const total = os.totalmem();
  const resultado = {
    memoriaTotalGb: unDecimal(total),
    memoriaUsadaGb: unDecimal(total - os.freemem()),
    discoLibreGb: null,
    discoTotalGb: null,
  };
  try {
    const disco = statfs(carpeta);
    resultado.discoLibreGb = unDecimal(disco.bavail * disco.bsize);
    resultado.discoTotalGb = unDecimal(disco.blocks * disco.bsize);
  } catch {
    // Sin dato de disco: el panel lo deja en blanco.
  }
  return resultado;
}

/** null si hay recursos para otra sesión; si no, el motivo ("CPU 92 % (límite 85 %)"). */
export function faltanRecursos({ cpu, memoria }, limites) {
  const motivos = [];
  if (cpu > limites.cpuPorciento) motivos.push(`CPU ${cpu} % (límite ${limites.cpuPorciento} %)`);
  if (memoria > limites.memoriaPorciento) motivos.push(`memoria ${memoria} % (límite ${limites.memoriaPorciento} %)`);
  return motivos.length ? motivos.join(", ") : null;
}
