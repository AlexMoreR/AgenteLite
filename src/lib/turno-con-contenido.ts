/**
 * ¿LO QUE ESCRIBIÓ LA CLIENTA DICE ALGO, o es solo saludo y cortesía?
 *
 * Lo usa el reparto por turnos (ver reparto-por-turno.ts): una asesora recibe el chat cuando la
 * clienta contesta CON CONTENIDO a algo que le mandó el agente o un flujo. "pestañas y cejas",
 * "masajes", "cuánto vale" o "soy de Pereira" cuentan; "hola", "buenas tardes", "ok", "gracias"
 * o un emoji solo, no (Alex, 02-10-2026).
 *
 * Es código puro, sin base: la misma función corre en el webhook y en la simulación que se hizo
 * antes de prenderlo, así que lo que se midió es lo que hace.
 */

/**
 * Los saludos del Agente V3: la regla "Solo saluda sin decir qué busca" del libro. Se leen en vivo
 * del libro (ver reparto-por-turno.ts); esta copia es el respaldo si el libro no responde.
 */
export const SALUDOS_DEL_V3_DE_RESPALDO = [
  "hola",
  "buenas",
  "buenos dias",
  "buenas tardes",
  "buenas noches",
  "buen dia",
  "hola buenas",
  "buenas como estas",
];

/**
 * Palabras que solas no dicen qué busca la clienta: saludos sueltos ("tardes"), cortesía,
 * confirmaciones y risas. Se comparan palabra por palabra, así "hola buenas tardes" no cuenta y
 * "hola, cuánto vale" sí (queda "cuanto").
 */
const PALABRAS_SIN_CONTENIDO = [
  // Saludos sueltos y sus pedazos.
  "hola", "holi", "buenas", "buenos", "buena", "buen", "dia", "dias", "tarde", "tardes", "noche", "noches",
  "como", "estas", "esta", "estan", "que", "tal", "saludos", "hello", "hi", "hey",
  // Cortesía y confirmaciones.
  "ok", "okey", "okay", "oki", "okis", "vale", "dale", "listo", "bueno", "bien", "perfecto", "claro",
  "entendido", "gracias", "muchas", "mil", "muchisimas", "graciasss", "si", "no", "ya", "aja", "va",
  "super", "genial", "excelente", "chevere", "bendiciones", "amen", "igualmente",
  // Muletillas.
  "hmm", "mmm", "uy", "uf", "wow", "jum",
];

/** Palabras de relleno que no hacen contenido por sí solas ("y", "de", "reina"...). */
const PALABRAS_DE_RELLENO = [
  "y", "e", "o", "u", "de", "del", "la", "el", "los", "las", "lo", "le", "les", "a", "al", "en", "con",
  "por", "para", "me", "te", "se", "mi", "tu", "su", "un", "una", "es", "muy", "pues", "tan", "todo",
  "amiga", "amigo", "reina", "linda", "hermosa", "querida", "mor", "amor", "senora", "senor", "dona", "don",
];

/** Los tipos de mensaje que traen contenido por sí mismos: una nota de voz, una foto, una ubicación. */
const TIPOS_CON_CONTENIDO = new Set(["AUDIO", "IMAGE", "VIDEO", "DOCUMENT", "LOCATION", "CONTACTS"]);

/** "holaaa" y "graciasss" se comparan como "hola" y "gracias". */
function sinLetrasRepetidas(palabra: string) {
  return palabra.replace(/(.)\1+/g, "$1");
}

/**
 * Minúsculas, sin tildes y sin signos. NFKD y no NFD: las letras "decorativas" que mandan algunos
 * teclados (𝐡𝐨𝐥𝐚) con NFD quedaban como símbolos raros y el mensaje parecía vacío.
 */
export function normalizarParaTurno(texto: string) {
  return texto
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function armarConjunto(palabras: string[]) {
  const conjunto = new Set<string>();
  for (const palabra of palabras) {
    for (const parte of normalizarParaTurno(palabra)) {
      conjunto.add(parte);
      conjunto.add(sinLetrasRepetidas(parte));
    }
  }
  return conjunto;
}

const SIN_CONTENIDO = armarConjunto(PALABRAS_SIN_CONTENIDO);
const RELLENO = armarConjunto(PALABRAS_DE_RELLENO);

/** ¿Un mensaje de la clienta dice algo? */
export function mensajeConContenido(
  mensaje: { type?: string | null; content?: string | null },
  saludos: readonly string[] = SALUDOS_DEL_V3_DE_RESPALDO,
): boolean {
  const tipo = (mensaje.type ?? "TEXT").toUpperCase();
  if (TIPOS_CON_CONTENIDO.has(tipo)) {
    return true;
  }
  if (tipo !== "TEXT") {
    // Stickers, reacciones y lo demás: no dicen qué busca.
    return false;
  }

  const saludosDelV3 = armarConjunto([...saludos]);
  return normalizarParaTurno(mensaje.content ?? "").some((palabra) => {
    const plana = sinLetrasRepetidas(palabra);
    // Las risas ("jajaja", "jejeje") no son contenido.
    if (/^(ja|je|ji|ha|he|ka)+j?$/.test(palabra) || /^(ja|je|ha)+$/.test(plana)) {
      return false;
    }
    const sinNada = [palabra, plana].some(
      (forma) => SIN_CONTENIDO.has(forma) || RELLENO.has(forma) || saludosDelV3.has(forma),
    );
    return !sinNada;
  });
}

/**
 * ¿Este turno de la clienta merece una asesora?
 *
 * `mensajes` va del MÁS NUEVO al más viejo y sin notas del sistema. El turno es lo que escribió la
 * clienta desde la última vez que le escribimos: "hola", "buenas", "tardes" seguidos son UN turno.
 * Cuenta solo si antes de ese turno ya le había escrito el agente o un flujo (el primer mensaje
 * del lead no reparte: todavía no le contestó nadie) y si algo del turno tiene contenido.
 *
 * Con `exigirPrecioOFotos` (Alex, 12-10-2026) además el bot o un flujo tiene que haberle mandado
 * ANTES del turno el precio o fotos/video/catálogo (ver `botYaMandoPrecioOFotos`). Así "masajes"
 * contestado a la bienvenida sigue con el bot: todavía está calificando.
 */
export function turnoMereceAsesora(
  mensajes: ReadonlyArray<MensajeDelTurno>,
  saludos: readonly string[] = SALUDOS_DEL_V3_DE_RESPALDO,
  opciones: { exigirPrecioOFotos?: boolean } = {},
): boolean {
  if (opciones.exigirPrecioOFotos && !botYaMandoPrecioOFotos(mensajes)) {
    return false;
  }
  const turno: typeof mensajes[number][] = [];
  let huboRespuestaNuestra = false;
  for (const mensaje of mensajes) {
    if (mensaje.direction === "OUTBOUND") {
      huboRespuestaNuestra = true;
      break;
    }
    turno.push(mensaje);
  }
  if (!huboRespuestaNuestra || turno.length === 0) {
    return false;
  }
  return turno.some((mensaje) => mensajeConContenido(mensaje, saludos));
}

/**
 * ¿La clienta ya respondió la bienvenida? (Alex, 30-10-2026)
 *
 * True si hay al menos un mensaje de la clienta (INBOUND) que llegó DESPUÉS del primer mensaje
 * nuestro (OUTBOUND: bot, flujo o persona). Mira todo el chat, no "lo último": da igual que el bot
 * ya haya contestado después. Las notas del sistema y los mensajes borrados no cuentan, ni como
 * nuestros ni como de la clienta. Ordena por fecha; sin fecha, `mensajes` va del más viejo al más nuevo.
 */
export function respondioLaBienvenida(mensajes: ReadonlyArray<MensajeDelTurno>): boolean {
  const validos = mensajes
    .filter((m) => !m.borrado && (m.type ?? "TEXT").toUpperCase() !== "SYSTEM")
    .map((m, indice) => ({ m, indice, hora: m.createdAt == null ? null : new Date(m.createdAt).getTime() }));
  validos.sort((a, b) =>
    a.hora != null && b.hora != null && !Number.isNaN(a.hora) && !Number.isNaN(b.hora) && a.hora !== b.hora
      ? a.hora - b.hora
      : a.indice - b.indice,
  );
  const primerNuestro = validos.findIndex(({ m }) => m.direction === "OUTBOUND");
  if (primerNuestro === -1) return false;
  return validos.slice(primerNuestro + 1).some(({ m }) => m.direction === "INBOUND");
}

/* ------------------------------------------------------------------------------------------------
   ¿EL BOT YA LE MANDÓ PRECIO O FOTOS? (Alex, 12-10-2026)

   El reparto por turno solo pasa el chat a una asesora cuando la clienta ya vio el precio o las
   fotos y sigue escribiendo con contenido. Antes de eso el bot está calificando ("¿qué servicios
   vas a ofrecer?") y el chat se queda con él.

   La heurística, sobre los mensajes SALIENTES que están ANTES del turno actual de la clienta:
   - Quién: el bot o un flujo (`rawPayload.source` vacío), su eco por WAHA ("api") o un seguimiento
     automático ("follow", "agente-v3-seguimiento", …). NO cuentan la asesora ("manual"), el
     celular ("instance") ni lo importado del historial: la regla es sobre lo que mandó el bot.
   - Fotos: un mensaje IMAGE, VIDEO o DOCUMENT (fotos del combo, video, catálogo en PDF). Vale para
     cualquier producto: no depende del nombre del flujo ni de la regla del libro.
   - Precio: un texto con "$" seguido de cifra ("$989.000", "$ 450.000"), o una cifra con puntos de
     miles ("989.000") o "989 mil" en un mensaje que habla de plata (precio, valor, vale, cuesta,
     pesos, anticipo, separas…). "200 kg", "50 %", "1 año" o un teléfono no son precio.
------------------------------------------------------------------------------------------------ */

export type MensajeDelTurno = {
  direction: string;
  type?: string | null;
  content?: string | null;
  /** `rawPayload.source` del mensaje: quién lo mandó. null/undefined = el bot o un flujo. */
  origen?: string | null;
  /** Cuándo se escribió. Con fecha, `respondioLaBienvenida` ordena solo; sin ella, vale el orden recibido. */
  createdAt?: Date | string | number | null;
  /** El mensaje se borró (`deletedAt` lleno): no cuenta para nada. */
  borrado?: boolean;
};

/** Salientes que NO son del bot: una persona, o lo traído del historial (no se sabe quién fue). */
const ORIGENES_QUE_NO_SON_DEL_BOT = new Set(["manual", "instance", "evogo-history-sync", "evolution-sync", "activity", "llamada"]);

/** Tipos que son "fotos": foto, video o documento (catálogo). */
const TIPOS_DE_FOTOS = new Set(["IMAGE", "VIDEO", "DOCUMENT"]);

const PESOS_CON_SIGNO = /\$\s?\d/;
const CIFRA_CON_MILES = /(?<![\d.,])\d{1,3}(?:[.,]\d{3})+(?![.,]?\d)/;
const CIFRA_EN_MIL = /\b\d{2,3}\s?(?:mil|k)\b/i;
const HABLA_DE_PLATA = /\b(precio|precios|valor|vale|valen|cuesta|cuestan|costo|pesos|cop|anticipo|abono|separas|separar|pagas|pago|queda en|esta en|está en)\b/i;

/** ¿Este texto le da un precio? Ver la heurística arriba. */
export function textoConPrecio(texto: string | null | undefined): boolean {
  const limpio = (texto ?? "").replace(/\*/g, "");
  if (!limpio) return false;
  if (PESOS_CON_SIGNO.test(limpio)) return true;
  return (CIFRA_CON_MILES.test(limpio) || CIFRA_EN_MIL.test(limpio)) && HABLA_DE_PLATA.test(limpio);
}

/** ¿Este mensaje es del bot, de un flujo o de un seguimiento automático? */
export function esMensajeDelBot(mensaje: MensajeDelTurno): boolean {
  if (mensaje.direction !== "OUTBOUND") return false;
  if ((mensaje.type ?? "TEXT").toUpperCase() === "SYSTEM") return false;
  return !(mensaje.origen && ORIGENES_QUE_NO_SON_DEL_BOT.has(mensaje.origen));
}

/** ¿Este mensaje del bot es precio o fotos? */
export function esPrecioOFotosDelBot(mensaje: MensajeDelTurno): boolean {
  if (!esMensajeDelBot(mensaje)) return false;
  const tipo = (mensaje.type ?? "TEXT").toUpperCase();
  if (TIPOS_DE_FOTOS.has(tipo)) return true;
  // El pie de foto de un video o imagen también puede traer precio, pero ya contó como foto.
  return tipo === "TEXT" && textoConPrecio(mensaje.content);
}

/**
 * ¿Antes del turno actual de la clienta el bot ya le mandó precio o fotos?
 *
 * `mensajes` va del MÁS NUEVO al más viejo, sin notas del sistema. Se salta el turno (lo que
 * escribió la clienta desde nuestra última respuesta) y se mira todo lo de antes.
 */
export function botYaMandoPrecioOFotos(mensajes: ReadonlyArray<MensajeDelTurno>): boolean {
  let dentroDelTurno = true;
  for (const mensaje of mensajes) {
    if (dentroDelTurno && mensaje.direction !== "OUTBOUND") continue;
    dentroDelTurno = false;
    if (esPrecioOFotosDelBot(mensaje)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------------------------------------
   EL INTERRUPTOR: AppSetting `reparto:config:<workspaceId>` = {"exigirPrecioOFotos": true}.
   Sin la fila (o con otro valor) el reparto por turno queda como antes del 12-10-2026.
------------------------------------------------------------------------------------------------ */

export type ConfigReparto = { exigirPrecioOFotos: boolean };

export const CONFIG_REPARTO_DE_SIEMPRE: ConfigReparto = { exigirPrecioOFotos: false };

export const claveConfigReparto = (workspaceId: string) => `reparto:config:${workspaceId}`;

export function leerConfigRepartoDeTexto(texto: string | null | undefined): ConfigReparto {
  try {
    const valor = texto ? JSON.parse(texto) : null;
    if (valor && typeof valor === "object" && !Array.isArray(valor)) {
      const crudo = (valor as Record<string, unknown>).exigirPrecioOFotos;
      return { exigirPrecioOFotos: crudo === true || crudo === "true" };
    }
  } catch {
    // Texto roto: como antes.
  }
  return CONFIG_REPARTO_DE_SIEMPRE;
}
