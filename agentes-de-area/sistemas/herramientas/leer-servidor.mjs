// LEER EL SERVIDOR (VPS) POR SSH (Agente de Sistemas). SOLO LECTURA.
//
//   node herramientas/leer-servidor.mjs --que logs --ruta /cliente/crm/pauta [--horas 24]
//   node herramientas/leer-servidor.mjs --que disco | uptime | inicio
//
// Entra por ssh al VPS con la misma llave del trabajador y corre SOLO una lista cerrada de comandos de lectura, armados
// aquí. No acepta ningún otro comando: lo que no está en LISTA se rechaza sin abrir la conexión.
//   logs   → los logs del contenedor de las últimas N horas (máx. 48), filtrados por una ruta
//   disco  → el espacio en disco del VPS
//   uptime → cuánto lleva prendido y la carga
//   inicio → si la página de inicio responde (solo el código HTTP)
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const CARPETA = path.dirname(fileURLToPath(import.meta.url));

/** Una ruta o texto de búsqueda seguro: letras, números y signos de rutas. Nada de espacios, comillas, `;`, `|`, `$`, etc. */
export const BUSQUEDA_SEGURA = /^[A-Za-z0-9/_.\-:=]{1,120}$/;

/** La lista cerrada. Cada entrada arma el comando remoto o lanza un error legible. */
export const LISTA = {
  logs: ({ ruta, horas, contenedor }) => {
    if (!BUSQUEDA_SEGURA.test(String(ruta ?? ""))) throw new Error("la ruta tiene caracteres que no se aceptan");
    const h = Math.min(Math.max(Math.round(Number(horas) || 24), 1), 48);
    return `docker logs --since ${h}h ${contenedor} 2>&1 | grep -F -- ${ruta} | tail -n 200`;
  },
  disco: () => "df -h --output=source,size,used,avail,pcent,target",
  uptime: () => "uptime",
  inicio: ({ urlInicio }) => `curl -s -o /dev/null -m 15 -w %{http_code} ${urlInicio}`,
};

/** El nombre del contenedor y el destino salen de la configuración, no del agente (y se validan). */
const NOMBRE_SEGURO = /^[A-Za-z0-9_.\-]{1,80}$/;
const URL_SEGURA = /^https:\/\/[A-Za-z0-9.\-]{1,100}\/?$/;

export function armarComandoRemoto(que, opciones, config) {
  if (!Object.prototype.hasOwnProperty.call(LISTA, que)) {
    throw new Error(`comando no permitido: "${que}". Solo: ${Object.keys(LISTA).join(", ")}`);
  }
  if (!NOMBRE_SEGURO.test(config.contenedor ?? "")) throw new Error("config.servidor.contenedor no es un nombre válido");
  if (!URL_SEGURA.test(config.urlInicio ?? "")) throw new Error("config.servidor.urlInicio tiene que ser https://dominio");
  return LISTA[que]({ ...opciones, contenedor: config.contenedor, urlInicio: config.urlInicio });
}

function correrSsh(config, remoto) {
  return new Promise((resolver) => {
    const comando = config.comandoSsh ?? ["ssh"];
    const hijo = spawn(comando[0], [...comando.slice(1), "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", config.destino, remoto], { stdio: ["ignore", "pipe", "pipe"] });
    let salida = "";
    let errores = "";
    const limite = setTimeout(() => hijo.kill(), 60_000);
    hijo.stdout.on("data", (d) => (salida += d));
    hijo.stderr.on("data", (d) => (errores += d));
    hijo.on("close", (codigo) => {
      clearTimeout(limite);
      resolver({ codigo, salida: salida.trim(), errores: errores.trim() });
    });
    hijo.on("error", (error) => resolver({ codigo: -1, salida: "", errores: error.message }));
  });
}

export async function leerServidor(que, opciones, config, correr = correrSsh) {
  const remoto = armarComandoRemoto(que, opciones, config); // rechaza antes de abrir ssh
  const r = await correr(config, remoto);
  return { que, ok: r.codigo === 0 || (que === "logs" && r.codigo === 1), salida: r.salida, errores: r.errores || null };
}

/* ──────────────────────────────────────────────────────────────── desde la línea de comandos ── */

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const pedido = { que: null, ruta: null, horas: 24, config: path.join(CARPETA, "../../config.local.json") };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--que") pedido.que = argv[++i];
    else if (argv[i] === "--ruta") pedido.ruta = argv[++i];
    else if (argv[i] === "--horas") pedido.horas = argv[++i];
    else if (argv[i] === "--config") pedido.config = path.resolve(argv[++i]);
  }
  try {
    if (!fs.existsSync(pedido.config)) throw new Error(`falta ${pedido.config}`);
    const config = JSON.parse(fs.readFileSync(pedido.config, "utf8").replace(/^﻿/, "")).servidor;
    if (!config?.destino) throw new Error('falta "servidor" en config.local.json (destino, contenedor, urlInicio)');
    const resultado = await leerServidor(pedido.que, { ruta: pedido.ruta, horas: pedido.horas }, config);
    console.log(JSON.stringify(resultado, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ que: pedido.que, ok: false, error: error.message }, null, 2));
    process.exit(1);
  }
}
