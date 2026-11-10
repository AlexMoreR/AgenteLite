#!/usr/bin/env node
/**
 * VIGILANTE DE MENSAJES INDESCIFRABLES (corre en el servidor de WAHA, fuera del CRM).
 *
 * WAHA (GOWS) escribe `Undecryptable message ...` en su log y no manda ningún evento; la app no tiene
 * docker.sock. Este script sigue `docker logs -f --timestamps` del contenedor, se queda con las líneas
 * de un cliente (`<dígitos>@lid`; nunca grupos, estados ni canales) y se las manda al CRM:
 *   POST <CRM_URL>/api/interno/mensajes-indescifrables   (cabecera x-indescifrables-secret)
 * El CRM es idempotente por (línea, id): repetir un evento no hace nada, así que al reiniciar se puede
 * releer desde el cursor sin miedo.
 *
 *   node vigilante.mjs                                   # en serio (systemd)
 *   node vigilante.mjs --desde-archivo muestra.log --simular   # lee un archivo y solo imprime
 *
 * Variables: CRM_URL, INDESCIFRABLES_SECRET, CONTENEDOR (crm-waha-1), CURSOR (archivo del cursor),
 * SESION_POR_DEFECTO (si la línea del log no dice la sesión).
 *
 * Sin dependencias: solo Node 18+.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const LATIDO_MS = 5 * 60_000;
const JUNTAR_MS = 2_000;
const MAXIMO_POR_ENVIO = 100;
const REINTENTOS = [1_000, 5_000, 15_000, 60_000];
const MAXIMO_EN_COLA = 5_000;

/* ------------------------------------------------------------------ lectura de una línea */

const RE_TIMESTAMP_DOCKER = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))\s+/;
const RE_NO_ES_DE_UN_CLIENTE = /@(g\.us|broadcast|newsletter)\b|status@/i;

/** La hora del timestamp de docker, recortada a milisegundos (docker da nanosegundos). */
function fechaDeDocker(texto) {
  const recortado = texto.replace(/(\.\d{3})\d+/, "$1");
  const fecha = new Date(recortado);
  return Number.isFinite(fecha.getTime()) ? fecha : null;
}

function primerCampo(objeto, nombres) {
  for (const nombre of nombres) {
    const valor = objeto?.[nombre];
    if (typeof valor === "string" && valor.trim()) return valor.trim();
  }
  return null;
}

/**
 * Una línea del log → { ocurridoEn, sesion, idCrudo, lid, cursor } o null si no es un indescifrable de
 * un cliente. Acepta el log en texto y en JSON: el formato exacto de GOWS no está documentado, así que
 * se busca cada dato por separado. Probar SIEMPRE con --desde-archivo --simular antes de instalar.
 */
export function leerLinea(lineaCruda, opciones = {}) {
  const linea = String(lineaCruda ?? "").replace(/\r$/, "");
  if (!/undecryptable/i.test(linea)) return null;
  const marca = RE_TIMESTAMP_DOCKER.exec(linea);
  const cursor = marca ? marca[1] : null;
  const resto = marca ? linea.slice(marca[0].length) : linea;
  if (RE_NO_ES_DE_UN_CLIENTE.test(resto)) return null;

  let json = null;
  const llave = resto.indexOf("{");
  if (llave >= 0) {
    try {
      json = JSON.parse(resto.slice(llave));
    } catch {
      json = null;
    }
  }
  const plano = json ? JSON.stringify(json) : resto;

  const lid = /(\d{5,20})@lid\b/i.exec(plano)?.[1] ?? null;
  if (!lid) return null;

  const idCrudo =
    (json && primerCampo(json, ["id", "messageId", "message_id", "msgId"])?.split("_").pop()) ||
    /\b(?:message\s*id|messageid|msgid|id)["']?\s*[:=]\s*["']?(?:[a-z]+_[^_\s"']+_)?([A-Za-z0-9]{8,128})\b/i.exec(resto)?.[1] ||
    /undecryptable message\s+(?:[a-z]+_[^_\s]+_)?([A-Za-z0-9]{8,128})\b/i.exec(resto)?.[1] ||
    // Los ids de WhatsApp son hexadecimales largos (3EB0..., 3A..., AC...).
    /\b([0-9A-F]{16,64})\b/.exec(resto)?.[1] ||
    null;
  if (!idCrudo || !/^[A-Za-z0-9]{8,128}$/.test(idCrudo) || idCrudo === lid) return null;

  const sesion =
    (json && primerCampo(json, ["session", "sesion", "sessionName"])) ||
    /\bsession["']?\s*[:=]\s*["']?([\w.-]+)/i.exec(resto)?.[1] ||
    /^\s*\[([\w.-]+)\]/.exec(resto)?.[1] ||
    opciones.sesionPorDefecto ||
    null;
  if (!sesion) return null;

  const ocurridoEn = (cursor && fechaDeDocker(cursor)) || (json && fechaDeDocker(String(json.time ?? json.timestamp ?? ""))) || opciones.ahora || new Date();
  return { ocurridoEn: ocurridoEn.toISOString(), sesion, idCrudo, lid, cursor };
}

/* ------------------------------------------------------------------ cursor en disco */

export function leerCursor(archivo) {
  try {
    const valor = fs.readFileSync(archivo, "utf8").trim();
    return RE_TIMESTAMP_DOCKER.test(`${valor} `) ? valor : null;
  } catch {
    return null;
  }
}

export function guardarCursor(archivo, valor) {
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  const temporal = `${archivo}.tmp`;
  fs.writeFileSync(temporal, `${valor}\n`);
  fs.renameSync(temporal, archivo);
}

/* ------------------------------------------------------------------ envío */

const esperar = (ms) => new Promise((listo) => setTimeout(listo, ms));

async function enviar(config, cuerpo) {
  if (config.simular) {
    console.log(JSON.stringify(cuerpo));
    return true;
  }
  for (let intento = 0; ; intento += 1) {
    try {
      const respuesta = await fetch(`${config.crmUrl}/api/interno/mensajes-indescifrables`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-indescifrables-secret": config.secreto },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(15_000),
      });
      if (respuesta.ok) return true;
      // Un 400 no se arregla reintentando: se deja rastro y se descarta el lote.
      if (respuesta.status === 400) {
        console.error(`[vigilante] el CRM rechazó el lote: ${(await respuesta.text()).slice(0, 300)}`);
        return true;
      }
      // Secreto mal puesto: se guarda el lote y se espera un minuto, sin llenar el log cada 2 s.
      if (respuesta.status === 401) {
        console.error("[vigilante] el CRM respondió 401: revisar INDESCIFRABLES_SECRET en los dos lados");
        await esperar(60_000);
        return false;
      }
      console.warn(`[vigilante] el CRM respondió ${respuesta.status}`);
    } catch (error) {
      console.warn(`[vigilante] no se pudo llegar al CRM: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (intento >= REINTENTOS.length) return false;
    await esperar(REINTENTOS[intento]);
  }
}

/* ------------------------------------------------------------------ principal */

function leerArgumentos(argv) {
  const config = {
    simular: argv.includes("--simular"),
    desdeArchivo: null,
    crmUrl: (process.env.CRM_URL || "https://crm.magilus.com").replace(/\/+$/, ""),
    secreto: (process.env.INDESCIFRABLES_SECRET || "").trim(),
    contenedor: process.env.CONTENEDOR || "crm-waha-1",
    cursor: process.env.CURSOR || "/var/lib/vigilante-indescifrables/cursor",
    sesionPorDefecto: process.env.SESION_POR_DEFECTO || null,
  };
  const i = argv.indexOf("--desde-archivo");
  if (i >= 0) config.desdeArchivo = argv[i + 1] ?? null;
  return config;
}

async function principal() {
  const config = leerArgumentos(process.argv.slice(2));
  if (process.argv.includes("--desde-archivo") && !config.desdeArchivo) {
    console.error("[vigilante] --desde-archivo necesita la ruta del archivo");
    process.exit(2);
  }
  if (!config.simular && !config.secreto) {
    console.error("[vigilante] falta INDESCIFRABLES_SECRET (o usar --simular)");
    process.exit(2);
  }

  const cola = [];
  let ultimoCursor = null;
  let enviando = false;
  let vistos = 0;

  const vaciar = async () => {
    if (enviando || cola.length === 0) return;
    enviando = true;
    try {
      while (cola.length > 0) {
        const lote = cola.slice(0, MAXIMO_POR_ENVIO);
        const eventos = lote.map(({ ocurridoEn, sesion, idCrudo, lid }) => ({ ocurridoEn, sesion, idCrudo, lid }));
        const ok = await enviar(config, { eventos });
        if (!ok) break; // se reintenta en la próxima vuelta; el cursor no avanza
        cola.splice(0, lote.length);
        const cursorDelLote = lote.map((evento) => evento.cursor).filter(Boolean).pop();
        if (cursorDelLote && !config.simular && !config.desdeArchivo) guardarCursor(config.cursor, cursorDelLote);
      }
    } finally {
      enviando = false;
    }
  };

  const alLeer = (linea) => {
    const marca = RE_TIMESTAMP_DOCKER.exec(linea);
    if (marca) ultimoCursor = marca[1];
    const evento = leerLinea(linea, { sesionPorDefecto: config.sesionPorDefecto });
    if (!evento) return;
    vistos += 1;
    cola.push(evento);
    if (cola.length > MAXIMO_EN_COLA) cola.splice(0, cola.length - MAXIMO_EN_COLA);
  };

  if (config.desdeArchivo) {
    const lector = readline.createInterface({ input: fs.createReadStream(config.desdeArchivo), crlfDelay: Infinity });
    for await (const linea of lector) alLeer(linea);
    await vaciar();
    console.error(`[vigilante] ${vistos} indescifrables de clientes en ${config.desdeArchivo}`);
    process.exit(cola.length === 0 ? 0 : 1);
  }

  setInterval(() => void vaciar(), JUNTAR_MS);
  const latir = () => void enviar(config, { latido: true, eventos: [] }).then((ok) => console.log(`[vigilante] latido ${ok ? "ok" : "falló"} (${vistos} vistos)`));
  latir();
  setInterval(latir, LATIDO_MS);

  // Sin cursor (primera vez): los últimos 10 minutos. Después, desde la última línea enviada.
  for (;;) {
    const desde = leerCursor(config.cursor) ?? ultimoCursor ?? new Date(Date.now() - 10 * 60_000).toISOString();
    console.log(`[vigilante] siguiendo ${config.contenedor} desde ${desde}`);
    const hijo = spawn("docker", ["logs", "-f", "--timestamps", "--since", desde, config.contenedor], { stdio: ["ignore", "pipe", "pipe"] });
    // docker logs manda lo del contenedor por los dos lados.
    readline.createInterface({ input: hijo.stdout, crlfDelay: Infinity }).on("line", alLeer);
    readline.createInterface({ input: hijo.stderr, crlfDelay: Infinity }).on("line", alLeer);
    const codigo = await new Promise((listo) => {
      hijo.on("close", listo);
      hijo.on("error", (error) => {
        console.error(`[vigilante] no se pudo correr docker: ${error.message}`);
        listo(-1);
      });
    });
    console.warn(`[vigilante] docker logs terminó (${codigo}); se vuelve a seguir en 5 s`);
    await vaciar();
    await esperar(5_000);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((error) => {
    console.error("[vigilante] se cayó:", error);
    process.exit(1);
  });
}
