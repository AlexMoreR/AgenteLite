// LEER EL SERVIDOR (VPS), SOLO LECTURA (Agente de Sistemas).
//
//   node herramientas/leer-servidor.mjs logs --ruta /cliente/crm/tablero [--horas 24]
//   node herramientas/leer-servidor.mjs disco
//   node herramientas/leer-servidor.mjs uptime
//   node herramientas/leer-servidor.mjs inicio
//
// Entra por ssh al VPS (la misma llave del trabajador) y SOLO corre una lista cerrada de comandos de lectura: los
// logs del contenedor de las últimas horas filtrados por ruta, el espacio en disco, `uptime` y si la página de inicio
// responde. Cualquier otro comando se rechaza sin tocar la red. Los argumentos se validan con una lista de letras
// permitidas: nada de lo que escriba el agente llega al shell sin pasar por ahí.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEGURO = /^[A-Za-z0-9/_.:\-]{1,160}$/;

/** Los comandos permitidos. Cada uno arma el comando REMOTO a partir de argumentos validados; nada más. */
export const COMANDOS = {
  logs: ({ ruta, horas = 24 }, vps) => {
    if (!ruta || !SEGURO.test(ruta) || !ruta.startsWith("/")) throw new Error("logs necesita --ruta con una ruta simple, como /cliente/crm/tablero");
    const h = Number(horas);
    if (!Number.isInteger(h) || h < 1 || h > 72) throw new Error("--horas tiene que ser un número entero de 1 a 72");
    if (!vps?.contenedor || !SEGURO.test(vps.contenedor)) throw new Error("falta vps.contenedor en la configuración (o tiene letras no permitidas)");
    return `docker logs --since ${h}h ${vps.contenedor} 2>&1 | grep -F -- '${ruta}' | tail -n 200`;
  },
  disco: () => "df -h",
  uptime: () => "uptime",
  inicio: (_args, vps) => {
    if (!vps?.urlInicio || !/^https:\/\/[A-Za-z0-9.\-]+(?::\d+)?\/?$/.test(vps.urlInicio)) throw new Error("falta vps.urlInicio en la configuración (https://dominio)");
    return `curl -s -o /dev/null -m 15 -w '%{http_code}' ${vps.urlInicio}`;
  },
};

/** Arma el comando remoto o lanza el error legible. Puro: se prueba sin red. */
export function armarComandoRemoto(nombre, args, vps) {
  const armar = Object.hasOwn(COMANDOS, nombre) ? COMANDOS[nombre] : null;
  if (!armar) throw new Error(`Comando no permitido: "${nombre}". Solo: ${Object.keys(COMANDOS).join(", ")}.`);
  return armar(args, vps);
}

export function leerServidor(nombre, args, vps, { correr = spawnSync } = {}) {
  const remoto = armarComandoRemoto(nombre, args, vps);
  if (!vps?.host || !vps?.usuario || !vps?.llave) throw new Error("falta vps.host, vps.usuario o vps.llave en la configuración");
  if (![vps.host, vps.usuario].every((v) => SEGURO.test(v))) throw new Error("vps.host o vps.usuario tienen letras no permitidas");
  const resultado = correr("ssh", ["-i", vps.llave, "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", `${vps.usuario}@${vps.host}`, remoto], { encoding: "utf8", timeout: 60_000 });
  return { codigo: resultado.status, salida: String(resultado.stdout ?? "").slice(-20_000), errores: String(resultado.stderr ?? "").slice(-2000) };
}

function leerArgumentos(argv) {
  const [nombre, ...resto] = argv;
  const args = {};
  for (let i = 0; i < resto.length; i += 1) if (resto[i].startsWith("--")) args[resto[i].slice(2)] = resto[++i];
  return { nombre, args };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { nombre, args } = leerArgumentos(process.argv.slice(2));
  let config = null;
  for (const candidato of [path.resolve("..", "config.local.json"), path.resolve("config.local.json")]) {
    if (fs.existsSync(candidato)) {
      config = JSON.parse(fs.readFileSync(candidato, "utf8").replace(/^﻿/, ""));
      break;
    }
  }
  try {
    const resultado = leerServidor(nombre, args, config?.vps ?? null);
    console.log(JSON.stringify(resultado, null, 2));
    process.exit(resultado.codigo === 0 ? 0 : 1);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
