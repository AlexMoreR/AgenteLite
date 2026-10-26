// SALUD DE AIZEN1 (Agente de Sistemas). SOLO LECTURA: no cambia nada del PC.
//
//   node herramientas/salud-de-aizen1.mjs [--disco D:/ ]
//
// Imprime un JSON con el disco libre, la RAM y la CPU de aizen1, y si la tarea programada del trabajador existe (Windows).
// Un disco con menos de 10 % libre, o RAM / CPU por encima de 90 %, queda marcado "atencion".
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const UMBRAL_DISCO_LIBRE = 10;
export const UMBRAL_USO = 90;

const redondear = (n) => Math.round(n * 10) / 10;

export function evaluarSalud({ discoLibrePorciento, ramUsadaPorciento, cpuPorciento }) {
  const atencion = [];
  if (discoLibrePorciento !== null && discoLibrePorciento < UMBRAL_DISCO_LIBRE) atencion.push(`disco casi lleno: ${discoLibrePorciento} % libre`);
  if (ramUsadaPorciento > UMBRAL_USO) atencion.push(`RAM al ${ramUsadaPorciento} %`);
  if (cpuPorciento !== null && cpuPorciento > UMBRAL_USO) atencion.push(`CPU al ${cpuPorciento} %`);
  return { estado: atencion.length ? "atencion" : "ok", atencion };
}

/** La CPU en un instante: dos muestras con un segundo de por medio. */
async function leerCpu() {
  const muestra = () => os.cpus().reduce((a, c) => ({ libre: a.libre + c.times.idle, total: a.total + Object.values(c.times).reduce((x, y) => x + y, 0) }), { libre: 0, total: 0 });
  const a = muestra();
  await new Promise((r) => setTimeout(r, 1000));
  const b = muestra();
  const total = b.total - a.total;
  return total > 0 ? redondear((1 - (b.libre - a.libre) / total) * 100) : null;
}

function leerDisco(ruta) {
  try {
    const datos = fs.statfsSync(ruta);
    const total = datos.blocks * datos.bsize;
    const libre = datos.bavail * datos.bsize;
    return { ruta, libreGb: redondear(libre / 1024 ** 3), totalGb: redondear(total / 1024 ** 3), librePorciento: total ? redondear((libre / total) * 100) : null };
  } catch (error) {
    return { ruta, error: error.message, librePorciento: null };
  }
}

function tareaProgramada(nombre) {
  return new Promise((resolver) => {
    if (process.platform !== "win32") return resolver({ nombre, existe: null, nota: "solo se puede leer en Windows" });
    execFile("schtasks", ["/Query", "/TN", nombre, "/FO", "LIST"], { timeout: 15_000 }, (error, salida) => {
      if (error) return resolver({ nombre, existe: false });
      const estado = /Status:\s*(.+)/i.exec(salida)?.[1]?.trim() ?? null;
      resolver({ nombre, existe: true, estado });
    });
  });
}

export async function saludDeAizen1({ disco = process.platform === "win32" ? "D:/" : "/", tarea = "Trabajador del tablero" } = {}) {
  const libre = leerDisco(disco);
  const ram = redondear(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
  const cpu = await leerCpu();
  return {
    disco: libre,
    ramUsadaPorciento: ram,
    cpuPorciento: cpu,
    tareaDelTrabajador: await tareaProgramada(tarea),
    ...evaluarSalud({ discoLibrePorciento: libre.librePorciento, ramUsadaPorciento: ram, cpuPorciento: cpu }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--disco");
  console.log(JSON.stringify(await saludDeAizen1(i >= 0 ? { disco: argv[i + 1] } : {}), null, 2));
}
