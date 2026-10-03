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
 */
export function turnoMereceAsesora(
  mensajes: ReadonlyArray<{ direction: string; type?: string | null; content?: string | null }>,
  saludos: readonly string[] = SALUDOS_DEL_V3_DE_RESPALDO,
): boolean {
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
