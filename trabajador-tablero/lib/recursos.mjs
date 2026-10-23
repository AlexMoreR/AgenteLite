// Cuidar aizen1 (Core i3, 40 GB de RAM): antes de abrir otra sesión de Claude Code se mira la CPU y la
// memoria. Si alguna pasa del límite de config.limites, no se abre otra (las que corren siguen).
// La CPU es el promedio del último minuto (una muestra cada 5 s): un pico de un segundo no frena nada.
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

/** null si hay recursos para otra sesión; si no, el motivo ("CPU 92 % (límite 85 %)"). */
export function faltanRecursos({ cpu, memoria }, limites) {
  const motivos = [];
  if (cpu > limites.cpuPorciento) motivos.push(`CPU ${cpu} % (límite ${limites.cpuPorciento} %)`);
  if (memoria > limites.memoriaPorciento) motivos.push(`memoria ${memoria} % (límite ${limites.memoriaPorciento} %)`);
  return motivos.length ? motivos.join(", ") : null;
}
