// LA SALUD DE AIZEN1, SOLO LECTURA (Agente de Sistemas).
//
//   node herramientas/salud-de-aizen1.mjs
//
// Lee el disco, la CPU y la RAM de este PC y la fecha del último registro (log) del trabajador del tablero. No escribe
// nada. Imprime un JSON con los números y las alertas (disco con menos de 10 % libre, RAM o CPU por encima de 90 %).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const UMBRALES = { discoLibrePorCientoMinimo: 10, ramUsadaPorCientoMaximo: 90, cpuUsadaPorCientoMaximo: 90 };

const GB = 1024 ** 3;
const redondear = (n) => Math.round(n * 10) / 10;

/** Arma el informe y las alertas con los números ya leídos (puro). */
export function evaluarSalud({ discoLibre, discoTotal, ramLibre, ramTotal, cpuPorCiento, ultimoLogDelTrabajador = null, ahora = new Date() }) {
  const discoLibrePorCiento = discoTotal > 0 ? redondear((discoLibre / discoTotal) * 100) : null;
  const ramUsadaPorCiento = ramTotal > 0 ? redondear(((ramTotal - ramLibre) / ramTotal) * 100) : null;
  const alertas = [];
  if (discoLibrePorCiento !== null && discoLibrePorCiento < UMBRALES.discoLibrePorCientoMinimo) alertas.push(`disco casi lleno: queda ${discoLibrePorCiento} % libre`);
  if (ramUsadaPorCiento !== null && ramUsadaPorCiento > UMBRALES.ramUsadaPorCientoMaximo) alertas.push(`RAM al ${ramUsadaPorCiento} %`);
  if (cpuPorCiento !== null && cpuPorCiento > UMBRALES.cpuUsadaPorCientoMaximo) alertas.push(`CPU al ${cpuPorCiento} %`);
  return {
    disco: { libreGB: redondear(discoLibre / GB), totalGB: redondear(discoTotal / GB), librePorCiento: discoLibrePorCiento },
    ram: { libreGB: redondear(ramLibre / GB), totalGB: redondear(ramTotal / GB), usadaPorCiento: ramUsadaPorCiento },
    cpu: { usadaPorCiento: cpuPorCiento },
    trabajador: ultimoLogDelTrabajador
      ? { ultimoRegistro: ultimoLogDelTrabajador.toISOString(), haceMinutos: Math.max(0, Math.floor((ahora.getTime() - ultimoLogDelTrabajador.getTime()) / 60_000)) }
      : { ultimoRegistro: null, haceMinutos: null },
    alertas,
    estado: alertas.length ? "CON_ALERTAS" : "BIEN",
  };
}

/** La CPU usada en un segundo de muestra (promedio de todos los núcleos). */
export async function medirCpu(ms = 1000) {
  const foto = () => os.cpus().reduce((a, c) => ({ total: a.total + Object.values(c.times).reduce((x, y) => x + y, 0), libre: a.libre + c.times.idle }), { total: 0, libre: 0 });
  const antes = foto();
  await new Promise((r) => setTimeout(r, ms));
  const despues = foto();
  const total = despues.total - antes.total;
  return total > 0 ? redondear((1 - (despues.libre - antes.libre) / total) * 100) : null;
}

/** El archivo de registro más reciente de una carpeta (el log del trabajador). */
export function ultimoRegistro(carpeta) {
  try {
    const fechas = fs.readdirSync(carpeta, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => fs.statSync(path.join(carpeta, e.name)).mtime);
    return fechas.length ? new Date(Math.max(...fechas.map((f) => f.getTime()))) : null;
  } catch {
    return null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let carpetaLogs = null;
  for (const candidato of [path.resolve("..", "config.local.json"), path.resolve("config.local.json")]) {
    if (!fs.existsSync(candidato)) continue;
    try {
      const config = JSON.parse(fs.readFileSync(candidato, "utf8").replace(/^﻿/, ""));
      if (config.carpetaLogsTrabajador) carpetaLogs = path.resolve(path.dirname(candidato), config.carpetaLogsTrabajador);
    } catch {
      // sin carpeta de logs: se omite ese dato
    }
    break;
  }
  const disco = fs.statfsSync(path.parse(process.cwd()).root);
  const informe = evaluarSalud({
    discoLibre: Number(disco.bavail) * Number(disco.bsize),
    discoTotal: Number(disco.blocks) * Number(disco.bsize),
    ramLibre: os.freemem(),
    ramTotal: os.totalmem(),
    cpuPorCiento: await medirCpu(),
    ultimoLogDelTrabajador: carpetaLogs ? ultimoRegistro(carpetaLogs) : null,
  });
  console.log(JSON.stringify(informe, null, 2));
}
