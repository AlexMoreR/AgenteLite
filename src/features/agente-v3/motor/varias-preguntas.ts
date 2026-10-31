import { normalizar, type Accion, type ReglaV3 } from "../domain/reglas";
import { esReglaDeFotoYPrecio } from "./foto-y-precio";

/**
 * VARIAS PREGUNTAS EN UN MENSAJE: contestarlas todas, en un solo mensaje corto.
 *
 * Caso real (26-10-2026, combo de camillas): la clienta escribió "Materiales garantía y envío los
 * costos es gratis??". Encajaban las reglas de garantía, materiales y envío, pero el motor deja
 * ganar una sola: contestó la garantía y nada más. Nunca supo de qué estaba hecho ni si el envío era
 * gratis, y dejó de escribir.
 *
 * La idea es acotada a propósito:
 * - Solo se juntan reglas de PREGUNTA INFORMATIVA de un tema conocido (envío, garantía, materiales,
 *   peso, colores, medidas, tiempo de entrega), que solo contestan: nada de catálogos, mover de paso
 *   ni elegir producto. Si gana otra clase de regla, todo sigue igual que antes.
 * - Se usan SOLO los textos que ya están escritos en cada regla: de cada uno se toma su primera frase
 *   útil (no la pregunta del final), una línea por tema, con un emoji. No se inventa nada.
 * - Al final va UNA sola pregunta: la de la regla que habría ganado sola (o la primera que haya).
 * - Si además encaja una regla que pasa a una asesora (precio de otro producto, foto), se contestan
 *   los temas y solo esa parte pasa a la asesora, con las acciones que esa regla ya tiene.
 */

type Tema = { clave: string; emoji: string; palabras: string[] };

/*
  Los temas, en orden: el primero que aparezca en el nombre de la regla (o, si no, en sus frases o su
  descripción) es el suyo. Se compara por palabra entera, así "entrega" no engancha "contraentrega"
  (la contraentrega es una política aparte y no se mezcla).
*/
const TEMAS: Tema[] = [
  { clave: "envio", emoji: "🚚", palabras: ["envio", "envios", "envian", "domicilio", "flete", "despacho", "despachan"] },
  { clave: "garantia", emoji: "✅", palabras: ["garantia"] },
  {
    clave: "materiales",
    emoji: "🪑",
    palabras: ["material", "materiales", "cuero", "tela", "estructura", "de que esta hecho", "de que esta hecha"],
  },
  { clave: "peso", emoji: "⚖️", palabras: ["peso", "pesa", "kilos"] },
  { clave: "colores", emoji: "🎨", palabras: ["color", "colores"] },
  { clave: "medidas", emoji: "📏", palabras: ["medida", "medidas", "mide", "tamano", "dimensiones"] },
  {
    clave: "entrega",
    emoji: "⏱️",
    palabras: ["tiempo de entrega", "entrega", "demora", "se demora", "tarda", "cuando llega", "dias habiles"],
  },
];

const EMOJI_ASESORA = "👩🏻‍💼";

function contiene(texto: string, palabra: string): boolean {
  return ` ${texto} `.includes(` ${palabra} `);
}

function temaDe(texto: string): Tema | null {
  const limpio = normalizar(texto);
  return TEMAS.find((tema) => tema.palabras.some((palabra) => contiene(limpio, palabra))) ?? null;
}

/** El tema de una regla: por su nombre primero, después por sus frases o su descripción. */
export function temaDeLaRegla(regla: ReglaV3): Tema | null {
  const delNombre = temaDe(regla.nombre);
  if (delNombre) return delNombre;
  if (regla.cuando.tipo === "frase") {
    for (const frase of regla.cuando.frases) {
      const tema = temaDe(frase);
      if (tema) return tema;
    }
  }
  if (regla.cuando.tipo === "intencion") return temaDe(regla.cuando.descripcion);
  return null;
}

const ACCIONES_DE_UN_TEMA = new Set<Accion["tipo"]>(["mensaje", "responder_con_ia", "cambiar_etapa_crm"]);
const ACCIONES_DE_ASESORA = new Set<Accion["tipo"]>(["mensaje", "avisar_asesor", "pausar_ia"]);

function seDisparaPorLoQueDice(regla: ReglaV3): boolean {
  return regla.cuando.tipo === "frase" || regla.cuando.tipo === "intencion";
}

/** El precio NO es un tema que se junte: tiene su propio camino (foto + precio, por mayor, la asesora). */
function hablaDePrecio(regla: ReglaV3): boolean {
  const nombre = normalizar(regla.nombre);
  return contiene(nombre, "precio") || contiene(nombre, "valor") || contiene(nombre, "precios");
}

/**
 * ¿Es una regla de pregunta informativa que se puede juntar con otras?
 *
 * Tiene que dispararse por lo que dijo la clienta, tener un tema conocido, no hablar de precio y solo
 * contestar (mensaje fijo o "responder con IA"; a lo sumo mover la etapa del CRM).
 */
export function esReglaDeTema(regla: ReglaV3): boolean {
  if (!seDisparaPorLoQueDice(regla) || esReglaDeFotoYPrecio(regla) || hablaDePrecio(regla)) return false;
  if (regla.entonces.length === 0 || !regla.entonces.every((accion) => ACCIONES_DE_UN_TEMA.has(accion.tipo))) return false;
  if (!regla.entonces.some((accion) => accion.tipo === "mensaje" || accion.tipo === "responder_con_ia")) return false;
  return temaDeLaRegla(regla) !== null;
}

/**
 * ¿Es una regla que pasa la pregunta a una asesora (precio de otro producto, foto)?
 *
 * Solo las que avisan y, a lo sumo, dicen algo y pausan. Las que mueven a otra etapa (por ejemplo la
 * de "dio los datos para comprar") no se juntan: son de cierre, no de una pregunta suelta.
 */
export function esReglaDeAsesora(regla: ReglaV3): boolean {
  if (!seDisparaPorLoQueDice(regla)) return false;
  if (!regla.entonces.every((accion) => ACCIONES_DE_ASESORA.has(accion.tipo))) return false;
  return regla.entonces.some((accion) => accion.tipo === "avisar_asesor");
}

/*
  Frases de relleno que no contestan nada ("¡Claro!", "Con gusto 😊"): se saltan para tomar la frase
  útil. Solo cuando la frase es CORTA (3 palabras o menos): "Claro, la garantía es de un año" sí sirve.
*/
const RELLENOS = ["claro", "claro que si", "si", "si senor", "perfecto", "con gusto", "hola", "listo", "super", "excelente", "genial", "por supuesto", "que bien"];

function esRelleno(frase: string): boolean {
  const limpio = normalizar(frase.replace(/\p{Extended_Pictographic}|️|‍/gu, " "));
  if (!limpio) return true;
  const palabras = limpio.split(" ");
  return palabras.length <= 3 && RELLENOS.some((relleno) => limpio === relleno || limpio.startsWith(`${relleno} `));
}

function esPregunta(frase: string): boolean {
  return frase.includes("?") || frase.trim().startsWith("¿");
}

/**
 * Ofrecer contraentrega está suspendido (política temporal del 9-oct): una frase que la ofrezca no
 * entra en la mezcla. Una que diga que NO se maneja sí.
 */
function ofreceContraentrega(frase: string): boolean {
  const limpio = normalizar(frase);
  return /contra ?entrega/.test(limpio) && !contiene(limpio, "no");
}

/** Parte un texto en frases, sin perder los signos ni las líneas. */
function frasesDe(texto: string): string[] {
  return texto
    .split(/\n+/)
    .flatMap((linea) => linea.split(/(?<=[.!?])\s+(?=\S)/))
    .map((frase) => frase.trim())
    .filter(Boolean);
}

/** La primera frase útil de un texto (no relleno, no pregunta) y la primera pregunta. */
export function partesDelTexto(texto: string): { linea: string | null; pregunta: string | null } {
  const frases = frasesDe(texto).filter((frase) => !ofreceContraentrega(frase));
  const linea = frases.find((frase) => !esPregunta(frase) && !esRelleno(frase)) ?? null;
  const pregunta = frases.find((frase) => esPregunta(frase)) ?? null;
  return { linea, pregunta };
}

const EMPIEZA_CON_EMOJI = /^(\p{Extended_Pictographic}|\p{Regional_Indicator})/u;

function conEmoji(emoji: string, linea: string): string {
  return EMPIEZA_CON_EMOJI.test(linea) ? linea : `${emoji} ${linea}`;
}

function textosDeLaRegla(regla: ReglaV3): string[] {
  return regla.entonces.flatMap((accion) =>
    accion.tipo === "mensaje" && accion.texto?.trim() ? [accion.texto] : [],
  );
}

export type Mezcla = {
  /** Las reglas que se juntaron, en el orden en que salen en el mensaje. */
  juntas: ReglaV3[];
  acciones: Accion[];
  porque: string;
};

/**
 * Junta las reglas de tema (y, si hay, una de asesora) en UN mensaje. Devuelve null cuando no hay
 * nada que juntar: menos de dos preguntas, o ninguna de tema. Entonces el motor sigue como siempre.
 *
 * `ordenadas` viene ya en el orden del desempate: la primera es la que habría ganado sola.
 */
export function juntarVariasPreguntas(ordenadas: ReglaV3[]): Mezcla | null {
  const temas: Array<{ regla: ReglaV3; tema: Tema }> = [];
  const vistos = new Set<string>();
  for (const regla of ordenadas) {
    if (!esReglaDeTema(regla)) continue;
    const tema = temaDeLaRegla(regla);
    // Dos reglas del mismo tema ("¿el envío es gratis?" y "pregunta por el envío") darían la misma
    // respuesta dos veces: queda la que habría ganado.
    if (!tema || vistos.has(tema.clave)) continue;
    vistos.add(tema.clave);
    temas.push({ regla, tema });
  }
  // Una sola de asesora alcanza: la parte que necesita a una persona es una.
  const asesora = ordenadas.find((regla) => !esReglaDeTema(regla) && esReglaDeAsesora(regla)) ?? null;

  if (temas.length === 0 || temas.length + (asesora ? 1 : 0) < 2) return null;

  const juntas = [...temas.map(({ regla }) => regla), ...(asesora ? [asesora] : [])];
  // Si la que habría ganado sola no es de tema ni de asesora (un catálogo, mover de paso, el precio),
  // no se junta nada: manda ella, como siempre.
  if (!juntas.includes(ordenadas[0])) return null;
  // La pregunta del final: la de la regla que habría ganado sola; si no trae, la primera que haya.
  const conPregunta = [ordenadas[0], ...juntas.filter((regla) => regla !== ordenadas[0])];
  const pregunta =
    conPregunta
      .flatMap(textosDeLaRegla)
      .map((texto) => partesDelTexto(texto).pregunta)
      .find(Boolean) ?? null;

  // La etapa del CRM: solo la primera que pida una, para no mover dos veces en el mismo turno.
  const etapa = temas
    .flatMap(({ regla }) => regla.entonces)
    .find((accion): accion is Extract<Accion, { tipo: "cambiar_etapa_crm" }> => accion.tipo === "cambiar_etapa_crm");
  const deLaAsesora = (asesora?.entonces ?? []).filter((accion) => accion.tipo !== "mensaje");

  const lineaDeLaAsesora = asesora
    ? textosDeLaRegla(asesora)
        .map((texto) => partesDelTexto(texto).linea)
        .find(Boolean) ?? null
    : null;

  const nombres = juntas.map((regla) => `"${regla.nombre}"`).join(", ");
  const usaIa = temas.some(({ regla }) => regla.entonces.some((accion) => accion.tipo === "responder_con_ia"));

  if (usaIa) {
    /*
      Alguna regla contesta con IA: no se mezcla a ciegas un texto fijo con uno que todavía no existe.
      La IA recibe todo junto, con la orden de contestar en líneas cortas y usando solo estos datos.
    */
    const datos = temas.map(({ regla, tema }) => {
      const lo = regla.entonces
        .flatMap((accion) =>
          accion.tipo === "mensaje" ? [accion.texto] : accion.tipo === "responder_con_ia" ? [accion.guia] : [],
        )
        // La frase que ofrece contraentrega tampoco le llega a la IA (política temporal del 9-oct).
        .flatMap((texto) => frasesDe(texto ?? "").filter((frase) => !ofreceContraentrega(frase)))
        .join(" ");
      return `- ${tema.emoji} ${regla.nombre}: ${lo}`;
    });
    if (lineaDeLaAsesora) datos.push(`- ${EMOJI_ASESORA} ${lineaDeLaAsesora}`);
    const guia = [
      "La clienta hizo varias preguntas en un solo mensaje. Contéstalas TODAS en UN solo mensaje corto:",
      "una línea por tema, empezando con su emoji, sin párrafos. Usa SOLO estos datos, sin inventar nada:",
      ...datos,
      "No ofrezcas pago contraentrega.",
      pregunta ? `Termina con esta única pregunta: ${pregunta}` : "Termina con una sola pregunta que avance la venta.",
    ].join("\n");
    return {
      juntas,
      acciones: [{ tipo: "responder_con_ia", guia }, ...(etapa ? [etapa] : []), ...deLaAsesora],
      porque: `La clienta hizo varias preguntas juntas: se contestan todas en un solo mensaje con IA (${nombres}).`,
    };
  }

  const lineas = temas
    .map(({ regla, tema }) => {
      const linea = textosDeLaRegla(regla)
        .map((texto) => partesDelTexto(texto).linea)
        .find(Boolean);
      return linea ? conEmoji(tema.emoji, linea) : null;
    })
    .filter((linea): linea is string => Boolean(linea));
  if (lineaDeLaAsesora) lineas.push(conEmoji(EMOJI_ASESORA, lineaDeLaAsesora));

  // Sin al menos dos líneas no hay nada que juntar: mejor la regla sola, como antes.
  if (lineas.length < 2) return null;

  const texto = [...new Set(lineas), ...(pregunta ? [pregunta] : [])].join("\n");
  return {
    juntas,
    acciones: [{ tipo: "mensaje", texto }, ...(etapa ? [etapa] : []), ...deLaAsesora],
    porque: asesora
      ? `La clienta hizo varias preguntas juntas: se contestan en un solo mensaje (${nombres}) y solo "${asesora.nombre}" pasa a una asesora.`
      : `La clienta hizo varias preguntas juntas: se contestan todas en un solo mensaje (${nombres}).`,
  };
}
