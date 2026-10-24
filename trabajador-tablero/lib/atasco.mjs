// Detectar una SESIÓN ATASCADA (24-oct-2026). El 24-oct una sesión de construir lanzó 2 subagentes en segundo
// plano, dijo "Revisaré de nuevo en unos 30 minutos" y se quedó quieta desde las 3:11 p. m.
// Una sesión está atascada si pasan `limiteMs` (15 min) SIN tocar archivos y SIN usar el procesador. Una
// sesión que piensa o corre pruebas sí usa el procesador (ella o sus hijos), así que no se corta.
//
// Todo lo que toca el sistema (archivos, CPU, reloj) entra por parámetros: así se prueba sin esperar 15 minutos.
import fs from "node:fs";
import path from "node:path";

import { correr } from "./procesos.mjs";

const ES_WINDOWS = process.platform === "win32";

/** Cuánta CPU (en segundos) tiene que gastar la sesión (y sus hijos) entre dos revisiones para contar como "activa". */
export const CPU_MINIMA_SEGUNDOS = 0.3;

/**
 * El vigilante. `leerHuella()` devuelve un texto que cambia cuando la sesión toca archivos; `leerCpu(pid)` los
 * segundos de CPU acumulados del proceso y sus hijos. `revisar(pid)` -> true si lleva `limiteMs` quieta.
 */
export function crearVigilante({ limiteMs, leerHuella, leerCpu, cpuMinimaSegundos = CPU_MINIMA_SEGUNDOS, ahora = () => Date.now() }) {
  let huella = null;
  let cpu = null;
  let ultimaActividad = ahora();
  let primera = true;
  return {
    async revisar(pid) {
      const [huellaAhora, cpuAhora] = await Promise.all([leerHuella(), leerCpu(pid)]);
      const cambioArchivos = !primera && huellaAhora !== huella;
      const usoCpu = !primera && cpu !== null && Number.isFinite(cpuAhora) && cpuAhora - cpu >= cpuMinimaSegundos;
      huella = huellaAhora;
      if (Number.isFinite(cpuAhora)) cpu = cpuAhora;
      // La primera lectura solo fija la línea de base. Si la CPU no se puede leer, cuentan solo los archivos.
      if (cambioArchivos || usoCpu || primera) ultimaActividad = ahora();
      primera = false;
      // Sin poder medir la CPU no se puede asegurar que esté quieta (podría estar pensando): no se corta.
      if (cpu === null) return false;
      return ahora() - ultimaActividad >= limiteMs;
    },
    /** Cuánto lleva quieta, en ms (para el mensaje). */
    quietoMs: () => ahora() - ultimaActividad,
  };
}

/** Los segundos de CPU de un proceso y todos sus descendientes. Nunca lanza: NaN si no se pudo leer. */
export async function cpuDelArbol(pid) {
  try {
    if (ES_WINDOWS) {
      const resultado = await correr(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,UserModeTime,KernelModeTime | ConvertTo-Json -Compress"],
        { timeoutMs: 30_000 },
      );
      const datos = JSON.parse(resultado.salida.trim() || "[]");
      const lista = (Array.isArray(datos) ? datos : [datos]).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, segundos: (Number(p.UserModeTime) + Number(p.KernelModeTime)) / 1e7 }));
      return sumarDescendientes(lista, pid);
    }
    const resultado = await correr(["ps", "-eo", "pid=,ppid=,time="], { timeoutMs: 15_000 });
    const lista = resultado.salida
      .split(/\r?\n/)
      .map((linea) => linea.trim().match(/^(\d+)\s+(\d+)\s+(?:(\d+)-)?(\d+):(\d+):?(\d+)?/))
      .filter(Boolean)
      .map(([, p, pp, dias, a, b, c]) => {
        const partes = c === undefined ? [0, Number(a), Number(b)] : [Number(a), Number(b), Number(c)];
        return { pid: Number(p), ppid: Number(pp), segundos: Number(dias ?? 0) * 86_400 + partes[0] * 3600 + partes[1] * 60 + partes[2] };
      });
    return sumarDescendientes(lista, pid);
  } catch {
    return Number.NaN;
  }
}

/** Suma `segundos` del proceso `pid` y de todos los que cuelgan de él. Pura. */
export function sumarDescendientes(lista, pid) {
  const hijos = new Map();
  for (const proceso of lista) {
    const ppid = Number(proceso.ppid);
    if (!hijos.has(ppid)) hijos.set(ppid, []);
    hijos.get(ppid).push(proceso);
  }
  const visto = new Set();
  let total = 0;
  const pendientes = [Number(pid)];
  while (pendientes.length) {
    const actual = pendientes.pop();
    if (visto.has(actual)) continue;
    visto.add(actual);
    const propio = lista.find((p) => Number(p.pid) === actual);
    if (propio) total += Number(propio.segundos) || 0;
    for (const hijo of hijos.get(actual) ?? []) pendientes.push(Number(hijo.pid));
  }
  return total;
}

/**
 * La huella de lo que la sesión cambió en `carpeta`: `git status --porcelain` más la fecha de modificación de
 * cada archivo que sale (se detecta tanto un archivo nuevo como uno editado otra vez).
 */
export async function huellaDeArchivos(carpeta) {
  try {
    const resultado = await correr(["git", "status", "--porcelain", "--untracked-files=all"], { cwd: carpeta, timeoutMs: 30_000 });
    const lineas = resultado.salida.split(/\r?\n/).filter(Boolean);
    const partes = lineas.map((linea) => {
      const ruta = linea.slice(3).replace(/^"|"$/g, "").split(" -> ").pop();
      try {
        return `${linea}@${fs.statSync(path.join(carpeta, ruta)).mtimeMs}`;
      } catch {
        return linea;
      }
    });
    return partes.join("\n");
  } catch {
    return "";
  }
}

/**
 * El vigilante para una sesión de Claude en `carpeta`, listo para pasarle a correr({ vigilar }).
 * `config.atasco`: { minutos (0 = apagado), revisarCadaSegundos, cpuMinimaSegundos }. null si está apagado.
 */
export function vigilarSesion(config, carpeta, inyectado = {}) {
  const minutos = Number(config?.atasco?.minutos ?? 0);
  if (!(minutos > 0)) return null;
  const vigilante = crearVigilante({
    limiteMs: minutos * 60_000,
    leerHuella: inyectado.leerHuella ?? (() => huellaDeArchivos(carpeta)),
    leerCpu: inyectado.leerCpu ?? cpuDelArbol,
    cpuMinimaSegundos: config.atasco.cpuMinimaSegundos ?? CPU_MINIMA_SEGUNDOS,
    ahora: inyectado.ahora,
  });
  return { cadaMs: Math.max(50, Number(config.atasco.revisarCadaSegundos ?? 60) * 1000), revisar: (pid) => vigilante.revisar(pid), quietoMs: vigilante.quietoMs };
}
