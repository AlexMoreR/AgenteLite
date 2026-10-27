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

// BOT_VENTAS, META_ADS, LIBRO_V3 y CHATS (26-oct-2026) ya no piden el sí final del dueño (`repo.zonasQueSubenSolas`, la misma lista
// que ZONAS_QUE_SUBEN_SOLAS del CRM). A cambio: pruebas extra antes de subir y vigilancia de 30 minutos después.
// Meta Ads tiene UNA excepción: lo que gasta plata (presupuesto, prender, crear) sigue esperando el sí.

/** Marca del plan: el Coordinador la escribe cuando el cambio de Meta Ads puede gastar plata. */
export const MARCA_GASTO_META_ADS = "GASTO EN META ADS";

/** Lo que el que construye tiene que dejar escrito en sus pruebas / resumen (por zona) para que suba sola. */
export const CONFIRMACION_BOT_VENTAS = "✔ sin mensajes nuevos a clientes";
export const CONFIRMACION_CHATS = "✔ chats: sin mensajes nuevos a clientes";
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
 * `confirmaElCoordinador` (27-oct-2026): la prueba extra del bot y de chats ("sin mensajes nuevos a clientes") la hace el propio
 * Coordinador con el diff real: si el constructor no escribió la frase, ya no es un motivo para esperar el sí del dueño (la frase la
 * escribe `confirmacionesDelCoordinador`). Un envío nuevo en esas rutas sigue esperando. El libro V3 no cambia: su simulación
 * no se puede comprobar con el diff.
 */
export function motivoPorElQueNoSubeSola({ zonas, zonasQueSubenSolas, diffs, plan, texto, confirmaElCoordinador = false }) {
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
    if (!confirmaElCoordinador && !String(texto ?? "").includes(CONFIRMACION_BOT_VENTAS)) return "falta la prueba de que no se mandan mensajes nuevos a clientes";
    // Solo se miran los envíos que agregan los archivos del bot (no los de toda la tarjeta).
    const envios = enviosNuevosDeMensajes(diffDe("BOT_VENTAS"));
    if (envios.length && !planMencionaEnvios(plan)) return "el cambio agrega un envío de mensaje que el plan no menciona";
  }
  if (suben("CHATS")) {
    if (!confirmaElCoordinador && !String(texto ?? "").includes(CONFIRMACION_CHATS)) return "falta la prueba de que los chats no mandan mensajes nuevos a clientes (✔ chats: sin mensajes nuevos a clientes)";
    // Más duro que el bot: aunque el plan lo mencione, cualquier envío nuevo en los archivos de chats espera el sí del dueño.
    const envios = enviosNuevosDeMensajes(diffDe("CHATS"));
    if (envios.length) return "el cambio agrega un envío de mensaje en chats (espera el sí del dueño aunque el plan lo mencione)";
  }
  return null;
}

/**
 * Las frases de la prueba extra que escribe el Coordinador (27-oct-2026) por las zonas que suben solas y no las trae el texto del que
 * construyó. Solo se llama si `motivoPorElQueNoSubeSola` (con `confirmaElCoordinador`) no encontró motivo: es decir, el diff real no
 * agrega ningún envío de mensajes. Devuelve las líneas para dejar en las pruebas de la tarjeta.
 */
export function confirmacionesDelCoordinador({ zonas, zonasQueSubenSolas, texto }) {
  const suben = (zona) => zonasQueSubenSolas.includes(zona) && zonas.includes(zona);
  const lineas = [];
  if (suben("BOT_VENTAS") && !String(texto ?? "").includes(CONFIRMACION_BOT_VENTAS)) {
    lineas.push(`${CONFIRMACION_BOT_VENTAS} (comprobado por el Coordinador con el diff: ningún envío nuevo en los archivos del bot)`);
  }
  if (suben("CHATS") && !String(texto ?? "").includes(CONFIRMACION_CHATS)) {
    lineas.push(`${CONFIRMACION_CHATS} (comprobado por el Coordinador con el diff: ningún envío nuevo en las rutas de chats)`);
  }
  return lineas;
}

/**
 * La prueba extra completa, hecha por el Coordinador (27-oct-2026): { esperaPor, confirmaciones }. `esperaPor` es el motivo por el
 * que sigue esperando el sí del dueño (null = sube sola); `confirmaciones` son las frases que escribió el Coordinador.
 */
export function pruebaExtraDeLasZonas({ zonas, zonasQueSubenSolas, diffs, plan, texto }) {
  const esperaPor = motivoPorElQueNoSubeSola({ zonas, zonasQueSubenSolas, diffs, plan, texto, confirmaElCoordinador: true });
  return { esperaPor, confirmaciones: esperaPor ? [] : confirmacionesDelCoordinador({ zonas, zonasQueSubenSolas, texto }) };
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

/** Minutos después de subir en los que `Failed to find Server Action` no cuenta (un celular con la versión vieja abierta lo provoca). */
export const GRACIA_SERVER_ACTION_MIN = 10;

const SERVER_ACTION_VIEJA = /Failed to find Server Action/i;

/** Lo que parece error y no lo es: campos vacíos, resultados buenos y conteos en cero. Se quita de la línea antes de buscar errores. */
const SIN_ERROR_REAL = [
  /"error"\s*:\s*(?:null|false|"")/gi,
  /"resultado"\s*:\s*"ok"/gi,
  /"ok"\s*:\s*true/gi,
  /\berrores?\s*[:=]\s*0\b/gi,
  /\b0\s+errors?\b/gi,
];

/**
 * ¿La línea del log es una falla de verdad? Usa LINEA_DE_ERROR pero no cuenta `"error":null` / `""` / `false`, `"resultado":"ok"`,
 * `"ok":true` ni «errores: 0» / «0 errors» (si la línea trae además otra palabra de error, sí cuenta). `Failed to find Server Action`
 * no cuenta en los primeros `graciaServerActionMin` minutos desde la subida; sin `minutosDesdeSubir` cuenta siempre.
 */
export function esLineaDeErrorReal(linea, { minutosDesdeSubir, graciaServerActionMin = GRACIA_SERVER_ACTION_MIN } = {}) {
  const texto = String(linea ?? "");
  if (!LINEA_DE_ERROR.test(texto)) return false;
  if (SERVER_ACTION_VIEJA.test(texto) && Number.isFinite(minutosDesdeSubir) && minutosDesdeSubir < graciaServerActionMin) return false;
  return LINEA_DE_ERROR.test(SIN_ERROR_REAL.reduce((resto, patron) => resto.replace(patron, " "), texto));
}

/** Las líneas de error del log (huellas únicas). `opciones` = { minutosDesdeSubir, graciaServerActionMin }. */
export function erroresDeLog(log, opciones) {
  return [...new Set(String(log ?? "").split(/\r?\n/).filter((linea) => esLineaDeErrorReal(linea, opciones)).map(huellaDeLinea))];
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
export function enviosDeLog(log, patron = ENVIO_EN_LOG, minutos = 3, opciones) {
  const ventana = Number(minutos) > 0 ? Number(minutos) : 3;
  let enviados = 0;
  let fallidos = 0;
  for (const linea of String(log ?? "").split(/\r?\n/)) {
    if (!patron.test(linea)) continue;
    if (esLineaDeErrorReal(linea, opciones)) fallidos += 1;
    else enviados += 1;
  }
  return { enviados: enviados / ventana, fallidos: fallidos / ventana };
}

/** Las líneas de envío fallido del log, tal cual salieron (para nombrarlas en el motivo). */
export function lineasDeEnvioFallidoDeLog(log, patron = ENVIO_EN_LOG, opciones) {
  return String(log ?? "").split(/\r?\n/).filter((linea) => patron.test(linea) && esLineaDeErrorReal(linea, opciones));
}

/** Los errores del log que no estaban antes de subir, con la línea tal cual salió ({ huella, linea }); `base` = huellas de antes. */
export function lineasDeErrorNuevasDeLog(log, base = [], opciones) {
  const conocidos = new Set(base);
  const vistas = new Map();
  for (const linea of String(log ?? "").split(/\r?\n/)) {
    if (!esLineaDeErrorReal(linea, opciones)) continue;
    const huella = huellaDeLinea(linea);
    if (!conocidos.has(huella) && !vistas.has(huella)) vistas.set(huella, { huella, linea: linea.trim() });
  }
  return [...vistas.values()];
}

/** Los errores del log que no estaban antes de subir (`base` = huellas de antes). */
export function erroresNuevosDeLog(log, base = [], opciones) {
  return lineasDeErrorNuevasDeLog(log, base, opciones).map((nuevo) => nuevo.huella);
}
