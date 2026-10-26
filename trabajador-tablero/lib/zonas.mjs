// Zonas protegidas: qué rutas del repo son de los chats, del bot de ventas (agentes y flujos), del libro
// V3 o de Meta Ads (globs en la configuración de cada repo). Si el cambio toca alguna, la tarjeta se
// construye y prueba igual y queda marcada con esa zona. Las zonas que piden el sí del dueño (hoy CHATS)
// la dejan POR_REVISAR; las que suben solas (zonasQueSubenSolas del repo: BOT_VENTAS, META_ADS y
// LIBRO_V3, decisión del dueño del 24-oct-2026) suben como cualquier otra, con pruebas extra por zona
// (abajo) y vigilancia de 30 minutos después de subir.

/** Un glob simple a expresión regular: "**" = cualquier cosa (también "/"), "*" = sin "/", "?" = un carácter. */
export function globARegex(glob) {
  let regex = "";
  for (let i = 0; i < glob.length; i += 1) {
    const caracter = glob[i];
    if (caracter === "*") {
      if (glob[i + 1] === "*") {
        // "**/" también calza con nada ("src/**/a.ts" calza "src/a.ts").
        if (glob[i + 2] === "/") {
          regex += "(?:.*/)?";
          i += 2;
        } else {
          regex += ".*";
          i += 1;
        }
      } else {
        regex += "[^/]*";
      }
    } else if (caracter === "?") {
      regex += "[^/]";
    } else {
      regex += caracter.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${regex}$`);
}

/**
 * Qué zonas tocan los archivos cambiados. `zonas` = { BOT_VENTAS: ["src/bot/**"], ... }.
 * Devuelve { zona: [archivos que la tocan] } solo de las que se tocan.
 */
export function zonasTocadas(archivos, zonas = {}) {
  const tocadas = {};
  for (const [zona, globs] of Object.entries(zonas)) {
    const regexes = (globs ?? []).map(globARegex);
    const suyos = archivos.filter((archivo) => regexes.some((regex) => regex.test(archivo.replace(/\\/g, "/"))));
    if (suyos.length) tocadas[zona] = suyos;
  }
  return tocadas;
}

/** De las zonas tocadas, las que todavía piden el sí del dueño (no están en `zonasQueSubenSolas`). */
export function zonasQuePidenSi(zonas, zonasQueSubenSolas = []) {
  return zonas.filter((zona) => !zonasQueSubenSolas.includes(zona));
}

/** Solo las líneas AGREGADAS de un diff (sin las cabeceras "+++"), con su archivo: [{ archivo, linea }]. */
export function lineasAgregadas(diff) {
  const lineas = [];
  let archivo = "";
  for (const linea of String(diff ?? "").split(/\r?\n/)) {
    const cabecera = linea.match(/^\+\+\+ b\/(.+)$/);
    if (cabecera) archivo = cabecera[1];
    else if (linea.startsWith("+") && !linea.startsWith("+++")) lineas.push({ archivo, linea: linea.slice(1) });
  }
  return lineas;
}

/* ───────────────────────────────────────────── Meta Ads: la única excepción que sigue pidiendo el sí ── */

// Señales de gasto en el código: presupuestos, pasar algo a ACTIVE, activar o crear campaña, conjunto o anuncio.
const SENALES_DE_GASTO_EN_META = [
  /\bdaily_budget\b/i,
  /\blifetime_budget\b/i,
  /\bbid_amount\b/i,
  /\bstatus\b["']?\s*[:=]\s*["']ACTIVE["']/i,
  /["']ACTIVE["']\s*,?\s*\/\/?.*\bstatus\b/i,
  /\b(activar|activa|prender|encender|reanudar|lanzar)\w*(Campan|Conjunto|Anuncio|AdSet|Ad\b)\w*/i,
  /\b(crear|crea|create|nueva|nuevo)\w*(Campan|Conjunto|Anuncio|AdSet|Campaign)\w*/i,
  /\/(campaigns|adsets|ads)["'`]?\s*,\s*\{?\s*method\s*:\s*["']POST["']/i,
];

/** El plan trae la línea "GASTO EN META ADS" (la escribe el planeador cuando el cambio gasta): sin la línea, no hay marca. */
export function planDiceGastoEnMetaAds(plan) {
  return /^[\s>*#_-]*gasto en meta ads\b/im.test(String(plan ?? ""));
}

/**
 * Señales de gasto en Meta Ads en las líneas agregadas de los archivos de la zona META_ADS. Devuelve
 * ["archivo: línea", ...] (vacío = ninguna). Es una revisión por palabras: junto con el plan es el doble control.
 */
export function senalesDeGastoEnMetaAds(diff, archivosDeMeta = []) {
  const suyos = new Set(archivosDeMeta);
  return lineasAgregadas(diff)
    .filter(({ archivo }) => !suyos.size || suyos.has(archivo))
    .filter(({ linea }) => SENALES_DE_GASTO_EN_META.some((patron) => patron.test(linea)))
    .map(({ archivo, linea }) => `${archivo}: ${linea.trim().slice(0, 100)}`);
}

/* ───────────────────────────────────────────── Bot de ventas: nada nuevo a los clientes ── */

// Envíos de mensajes que el bot hace a los clientes (nombres de función o endpoint de envío).
const ENVIO_DE_MENSAJE = /\b(send(?:Text|Media|Message|WhatsApp|Audio|Template)\w*|enviar(?:Mensaje|Texto|Media|WhatsApp|Audio|Plantilla)\w*|sendMessage|message\/sendText)\b/gi;

/**
 * Envíos nuevos de mensajes en las líneas agregadas de los archivos del bot que el plan NO menciona. Cada
 * nombre de envío tiene que aparecer en el plan; si no, es un envío nuevo no pedido. Devuelve ["archivo: nombre"].
 */
export function enviosNuevosDelBot(diff, archivosDelBot = [], plan = "") {
  const suyos = new Set(archivosDelBot);
  const textoDelPlan = String(plan ?? "").toLowerCase();
  const nuevos = [];
  for (const { archivo, linea } of lineasAgregadas(diff)) {
    if (suyos.size && !suyos.has(archivo)) continue;
    for (const envio of linea.match(ENVIO_DE_MENSAJE) ?? []) {
      if (!textoDelPlan.includes(envio.toLowerCase())) nuevos.push(`${archivo}: ${envio}`);
    }
  }
  return [...new Set(nuevos)];
}

/** La construcción dejó escrito "✔ sin mensajes nuevos a clientes" (lo pide el prompt del bot de ventas). */
export function anotoSinMensajesNuevos(texto) {
  return /✔\s*sin mensajes nuevos a clientes/i.test(String(texto ?? ""));
}

/* ───────────────────────────────────────────── Libro V3: el simulador antes de subir ── */

/**
 * La construcción dejó escrito "✔ simulación V3: sin cambios fuera de lo pedido" y el número de la versión
 * anterior del libro ("versión anterior del libro: 12"), para volver con v3_volver_a_version.
 * Devuelve { ok, versionAnterior } (ok = las dos cosas).
 */
export function simulacionV3Anotada(texto) {
  const cuerpo = String(texto ?? "");
  const simulo = /✔\s*simulaci[oó]n V3:\s*sin cambios fuera de lo pedido/i.test(cuerpo);
  const version = cuerpo.match(/versi[oó]n anterior(?: del libro)?\s*(?:de V3)?\s*[:=]?\s*#?(\d+)/i)?.[1] ?? null;
  return { ok: simulo && version !== null, simulo, versionAnterior: version };
}
