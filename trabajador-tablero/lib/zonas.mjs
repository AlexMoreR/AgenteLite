// Zonas protegidas: qué rutas del repo son de los chats, del bot de ventas (agentes y flujos), del libro
// V3 o de Meta Ads (globs en la configuración de cada repo). Si el cambio toca alguna, la tarjeta se
// construye y prueba igual pero NO sube sola: queda POR_REVISAR marcada con esa zona, esperando el sí
// del dueño en la pantalla.

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

/* ─────────────────────────── zonas que suben solas (24-oct-2026, decisión del dueño) ── */

// BOT_VENTAS, META_ADS y LIBRO_V3 ya no piden el sí final del dueño (`repo.zonasQueSubenSolas`, la misma lista
// que ZONAS_QUE_SUBEN_SOLAS del CRM). A cambio: pruebas extra antes de subir y vigilancia de 30 minutos después.
// Meta Ads tiene UNA excepción: lo que gasta plata (presupuesto, prender, crear) sigue esperando el sí.

/** Marca del plan: el Coordinador la escribe cuando el cambio de Meta Ads puede gastar plata. */
export const MARCA_GASTO_META_ADS = "GASTO EN META ADS";

/** Lo que el que construye tiene que dejar escrito en sus pruebas / resumen (por zona) para que suba sola. */
export const CONFIRMACION_BOT_VENTAS = "✔ sin mensajes nuevos a clientes";
export const CONFIRMACION_LIBRO_V3 = "✔ simulación V3: sin cambios fuera de lo pedido";

/** Señales de gasto en una línea AGREGADA de código de Meta Ads: presupuesto, puja, prender o crear algo. */
const SENALES_DE_GASTO_EN_META = [
  { motivo: "daily_budget", patron: /daily[_-]?budget/i },
  { motivo: "lifetime_budget", patron: /lifetime[_-]?budget/i },
  { motivo: "bid_amount", patron: /bid[_-]?amount/i },
  { motivo: "pasa algo a ACTIVE", patron: /\bstatus\b["'\]]?\s*[:=]+\s*["']?ACTIVE\b|\bACTIVE\b["']?\s*(?:,|\)|;|$)|=>\s*["']ACTIVE["']/ },
  { motivo: "activar", patron: /\b(activar|activate|enable[_-]?(?:campaign|adset|ad)s?|resume[_-]?(?:campaign|adset|ad)s?|unpause)\w*/i },
  {
    motivo: "crear campaña, conjunto o anuncio",
    patron: /\b(create|crear|nueva|nuevo)[_\s-]*(?:meta[_\s-]*)?(?:campaign|campana|campaña|adset|ad[_-]?set|conjunto|ad|anuncio)s?\b|\b(?:campaigns|adsets|ads)\s*\.\s*create\b|\/(?:campaigns|adsets|ads)['"`]?\s*,\s*\{[^}]*method\s*:\s*['"]POST/i,
  },
];

/** Las líneas agregadas (+) de un diff, sin las cabeceras `+++`. */
export function lineasAgregadas(diff) {
  return String(diff ?? "")
    .split(/\r?\n/)
    .filter((linea) => linea.startsWith("+") && !linea.startsWith("+++"))
    .map((linea) => linea.slice(1));
}

/** Las señales de gasto de Meta Ads que aparecen en lo que agrega el diff (vacío = ninguna). */
export function senalesDeGastoEnMetaAds(diff) {
  const lineas = lineasAgregadas(diff);
  return SENALES_DE_GASTO_EN_META.filter((senal) => lineas.some((linea) => senal.patron.test(linea))).map((senal) => senal.motivo);
}

/** ¿El plan declara que el cambio de Meta Ads gasta plata? Una línea "GASTO EN META ADS: <qué>" ("...: no" no cuenta). */
export function planDeclaraGastoEnMetaAds(plan) {
  return String(plan ?? "")
    .split(/\r?\n/)
    .some((original) => {
      const normal = original.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const calce = normal.match(/^[ \t>*_#-]*\**gasto en meta ads\**\s*[:.\u2014\u2013-]?\s*\**\s*(.*)$/);
      return Boolean(calce) && !/^(no|ninguno|ninguna|sin|n\/a|cero)(?![a-z])/.test(calce[1].trim());
    });
}

const ENVIOS_DE_MENSAJES = /\b(sendMessage|sendText|sendWhatsApp\w*|sendTemplate\w*|enviarMensaje\w*|mandarMensaje\w*|enviarWhatsApp\w*|enviarPlantilla\w*|messages\.create|sendMedia)\b|\/message\/send/i;

/** Los envíos de mensaje que agrega el diff de los archivos del bot (vacío = ninguno). */
export function enviosNuevosDeMensajes(diff) {
  return lineasAgregadas(diff).filter((linea) => ENVIOS_DE_MENSAJES.test(linea) && !/^\s*(\/\/|\*|\/\*|#)/.test(linea));
}

/** ¿El plan menciona que se enviará un mensaje nuevo? (si no lo menciona, un envío nuevo no sube solo) */
export function planMencionaEnvios(plan) {
  return /\b(envi\w*|mand\w*|mensaje\w* nuevo\w*|nuevo\w* mensaje\w*)\b/i.test(
    String(plan ?? "").normalize("NFD").replace(/[̀-ͯ]/g, ""),
  );
}

/** El número de la versión anterior del libro V3 que dejó escrito el que construyó (para v3_volver_a_version), o null. */
export function versionAnteriorDelLibro(texto) {
  const calce = String(texto ?? "").match(/versi[oó]n anterior(?: del libro)?(?: V3)?\s*[:=#]?\s*(?:v\.?\s*)?(\d+)/i);
  return calce ? Number(calce[1]) : null;
}

/**
 * Lo que falta para que una zona suba sola, según lo que escribió el que construyó (`texto` = su resumen y pruebas)
 * y el diff. Devuelve el motivo (una línea) o null si no falta nada. `zonas` = las zonas de la tarjeta (las que
 * toca el cambio y las que ya traía), `diffs` = { todo, BOT_VENTAS?, ... } (el diff de cada zona; si falta, el de todo).
 */
export function motivoPorElQueNoSubeSola({ zonas, zonasQueSubenSolas, diffs, plan, texto }) {
  const suben = (zona) => zonasQueSubenSolas.includes(zona) && zonas.includes(zona);
  const diffDe = (zona) => diffs?.[zona] ?? diffs?.todo ?? "";
  if (suben("META_ADS")) {
    const senales = senalesDeGastoEnMetaAds(diffDe("META_ADS"));
    if (planDeclaraGastoEnMetaAds(plan)) return "gasto en Meta Ads (el plan lo declara)";
    if (senales.length) return `gasto en Meta Ads (${senales.join(", ")})`;
  }
  if (suben("LIBRO_V3")) {
    if (!String(texto ?? "").includes(CONFIRMACION_LIBRO_V3)) return "falta la simulación V3 (✔ simulación V3: sin cambios fuera de lo pedido)";
    if (versionAnteriorDelLibro(texto) === null) return "falta el número de la versión anterior del libro V3 (para volver con v3_volver_a_version)";
  }
  if (suben("BOT_VENTAS")) {
    if (!String(texto ?? "").includes(CONFIRMACION_BOT_VENTAS)) return "falta la prueba de que no se mandan mensajes nuevos a clientes";
    // Solo se miran los envíos que agregan los archivos del bot (no los de toda la tarjeta).
    const envios = enviosNuevosDeMensajes(diffDe("BOT_VENTAS"));
    if (envios.length && !planMencionaEnvios(plan)) return "el cambio agrega un envío de mensaje que el plan no menciona";
  }
  return null;
}

/* ─────────────────────────── vigilancia de 30 minutos después de subir ── */

const LINEA_DE_ERROR = /\b(error|fatal|unhandled|uncaught|exception|panic|ECONNREFUSED|out of memory|SIGKILL)\b/i;

/** Una línea de log sin hora ni números, para comparar "el mismo error" aunque cambie la hora. */
function huellaDeLinea(linea) {
  return String(linea)
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?Z?/g, "")
    .replace(/\b[0-9a-f]{8,}\b/gi, "#")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

/** Las líneas de error del log (huellas únicas). */
export function erroresDeLog(log) {
  return [...new Set(String(log ?? "").split(/\r?\n/).filter((linea) => LINEA_DE_ERROR.test(linea)).map(huellaDeLinea))];
}

/** Las líneas del log que muestran un mensaje enviado: las palabras de ENVIOS_DE_MENSAJES más las del log. */
const ENVIO_EN_LOG = new RegExp(`${ENVIOS_DE_MENSAJES.source}|\\b(sendText|message sent)\\b|/message/send`, "i");

/** Los minutos que cubre el comando que lee el log (`--since 3m`, `--since=10m`, `--since 1h`); 3 si no lo dice. */
export function minutosDeLaVentana(comando) {
  const calce = String(comando ?? "").match(/--since[= ]\s*(\d+(?:\.\d+)?)\s*(s|m|h)?\b/i);
  if (!calce) return 3;
  const valor = Number(calce[1]) * ({ s: 1 / 60, m: 1, h: 60 }[(calce[2] ?? "m").toLowerCase()] ?? 1);
  return valor > 0 ? valor : 3;
}

/**
 * Los mensajes enviados y los envíos fallidos (envío y error en la misma línea) del log, POR MINUTO.
 * `patron` cambia las palabras que cuentan como envío; `minutos` es lo que cubre el comando que leyó el log.
 */
export function enviosDeLog(log, patron = ENVIO_EN_LOG, minutos = 3) {
  const ventana = Number(minutos) > 0 ? Number(minutos) : 3;
  let enviados = 0;
  let fallidos = 0;
  for (const linea of String(log ?? "").split(/\r?\n/)) {
    if (!patron.test(linea)) continue;
    if (LINEA_DE_ERROR.test(linea)) fallidos += 1;
    else enviados += 1;
  }
  return { enviados: enviados / ventana, fallidos: fallidos / ventana };
}

/** Los errores del log que no estaban antes de subir (`base` = huellas de antes). */
export function erroresNuevosDeLog(log, base = []) {
  const conocidos = new Set(base);
  return erroresDeLog(log).filter((huella) => !conocidos.has(huella));
}
