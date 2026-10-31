import { normalizar, pesoDeLaRegla, type Accion, type ReglaV3 } from "../domain/reglas";
import { esReglaDeFotoYPrecio } from "./foto-y-precio";

/**
 * VARIAS PREGUNTAS EN UN MENSAJE: contestarlas todas, en un mensaje corto.
 *
 * Caso real (26-10-2026, Ventas 1, combo de camillas): la clienta escribió "Materiales garantía y
 * envío los costos es gratis??". Ganó solo "Pregunta por la garantía" y el agente contestó solo la
 * garantía: materiales y envío quedaron sin respuesta y la clienta dejó de escribir. El motor elige
 * UNA regla por mensaje, y para las preguntas informativas eso deja preguntas sin contestar.
 *
 * Esto es un desvío acotado, como el de foto + precio, no un cambio del desempate:
 *
 * - Solo juntan las reglas "de tema": las que contestan una pregunta informativa (envío, garantía,
 *   materiales, peso, colores, tiempo de entrega) y nada más. Una regla que mueve de paso, elige
 *   producto o manda un catálogo no se junta nunca: esas siguen ganando solas, como siempre.
 * - Se usan SOLO los textos escritos en cada regla: de cada una sale su primera frase útil, en una
 *   línea con su emoji. Al final va UNA sola pregunta de avance, sacada de las mismas reglas.
 * - Si encaja también una regla que pasa a una asesora (precio de otro producto, por ejemplo), se
 *   contestan los temas y solo esa parte pasa a la asesora, con las acciones de esa regla.
 * - Ninguna línea ni pregunta que hable de contraentrega entra al mensaje (política del 09-10-2026).
 */

export type TemaDePregunta = "garantia" | "envio" | "materiales" | "peso" | "colores" | "tiempo_de_entrega";

/*
  El orden importa: "tiempo de envío" es tiempo de entrega, no envío. Cada tema se come lo que
  reconoce antes de que miren los siguientes.
*/
const TEMAS: Array<{ tema: TemaDePregunta; emoji: string; patron: RegExp }> = [
  {
    tema: "tiempo_de_entrega",
    emoji: "⏱️",
    patron:
      /\b(tiempos? de (entrega|envio|fabricacion)|cuanto (se )?(demora|demoran|tarda|tardan)|cuando (llega|llegaria)|se demora|se demoran|demora|fabricacion|dias habiles)\b/g,
  },
  { tema: "garantia", emoji: "✅", patron: /\bgarantias?\b/g },
  { tema: "envio", emoji: "🚚", patron: /\b(envio|envios|envian|enviar|envias|domicilio|domicilios|flete)\b/g },
  {
    tema: "materiales",
    emoji: "🪑",
    patron: /\b(material|materiales|de que (esta|estan|es|son) hech[oa]s?)\b/g,
  },
  { tema: "peso", emoji: "⚖️", patron: /\b(peso|pesa|pesan|kilos)\b/g },
  { tema: "colores", emoji: "🎨", patron: /\b(color|colores)\b/g },
];

const EMOJI_DEL_TEMA = new Map(TEMAS.map(({ tema, emoji }) => [tema, emoji]));
const EMOJI_DE_LA_ASESORA = "👩🏻‍💻";

/** Los temas que nombra un texto, en el orden en que aparecen. */
export function temasQueNombra(texto: string): TemaDePregunta[] {
  let resto = ` ${normalizar(texto)} `;
  const encontrados: Array<{ tema: TemaDePregunta; posicion: number }> = [];
  for (const { tema, patron } of TEMAS) {
    let posicion = -1;
    resto = resto.replace(patron, (coincidencia, ...args) => {
      const donde = args.find((valor) => typeof valor === "number") as number;
      if (posicion < 0) posicion = donde;
      return " ".repeat(coincidencia.length);
    });
    if (posicion >= 0) encontrados.push({ tema, posicion });
  }
  return encontrados.sort((a, b) => a.posicion - b.posicion).map(({ tema }) => tema);
}

const ACCIONES_QUE_CONTESTAN = new Set<Accion["tipo"]>(["mensaje", "responder_con_ia"]);
const ACCIONES_DE_UNA_REGLA_DE_TEMA = new Set<Accion["tipo"]>(["mensaje", "responder_con_ia", "cambiar_etapa_crm"]);
const ACCIONES_QUE_MUEVEN_LA_CHARLA = new Set<Accion["tipo"]>(["activar_producto", "ir_al_paso", "flujo"]);

const seDisparaPorLoQueDice = (regla: ReglaV3) => regla.cuando.tipo === "frase" || regla.cuando.tipo === "intencion";

/**
 * ¿De qué tema es esta regla? null si no es una regla "de tema".
 *
 * Una regla de tema contesta una pregunta y nada más: se dispara por lo que dice la clienta (frase o
 * intención), solo manda texto (o la IA lo redacta) y a lo sumo mueve la etapa del CRM. El tema sale
 * del NOMBRE de la regla; si el nombre no lo dice, de sus frases o de su descripción. Si nombra dos
 * temas o ninguno, no es de tema: no se adivina.
 */
export function temaDeLaRegla(regla: ReglaV3): TemaDePregunta | null {
  if (!seDisparaPorLoQueDice(regla)) return null;
  if (esReglaDeFotoYPrecio(regla)) return null;
  if (!regla.entonces.some((accion) => ACCIONES_QUE_CONTESTAN.has(accion.tipo))) return null;
  if (!regla.entonces.every((accion) => ACCIONES_DE_UNA_REGLA_DE_TEMA.has(accion.tipo))) return null;

  const delNombre = [...new Set(temasQueNombra(regla.nombre))];
  if (delNombre.length === 1) return delNombre[0];
  if (delNombre.length > 1) return null;

  const delDisparador =
    regla.cuando.tipo === "frase" ? regla.cuando.frases.join(" . ") : regla.cuando.tipo === "intencion" ? regla.cuando.descripcion : "";
  const delTexto = [...new Set(temasQueNombra(delDisparador))];
  return delTexto.length === 1 ? delTexto[0] : null;
}

/**
 * ¿Es una regla que pasa la charla a una asesora (precio de otro producto, por ejemplo)?
 *
 * Se dispara por lo que dice la clienta, avisa a una asesora y no mueve la charla de producto ni de
 * paso. La de foto + precio no cuenta: esa tiene su propio desvío antes que éste.
 */
export function esReglaQuePasaAAsesora(regla: ReglaV3): boolean {
  if (!seDisparaPorLoQueDice(regla)) return false;
  if (esReglaDeFotoYPrecio(regla)) return false;
  if (!regla.entonces.some((accion) => accion.tipo === "avisar_asesor")) return false;
  return !regla.entonces.some((accion) => ACCIONES_QUE_MUEVEN_LA_CHARLA.has(accion.tipo));
}

/** Una regla que solo manda texto: no mueve nada de la charla ni pasa a nadie. */
function soloContesta(regla: ReglaV3): boolean {
  return seDisparaPorLoQueDice(regla) && regla.entonces.every((accion) => ACCIONES_DE_UNA_REGLA_DE_TEMA.has(accion.tipo));
}

const HABLA_DE_CONTRAENTREGA = /\b(contra ?entrega|contraentregas|pagas? al recibir|pago al recibir|pagar al recibir)\b/;
const ARRANCA_CON_EMOJI = /^\p{Extended_Pictographic}/u;
const RELLENO = /^(hola|holi|claro|si|con gusto|perfecto|listo|que bien|excelente|genial|por supuesto|buenas|buen dia|buenos dias|buenas tardes|buenas noches|super|vale|ok)\b/;

/** Las frases de un texto: separadas por renglón y por punto; lo que va desde "¿" es una pregunta aparte. */
function frasesDe(texto: string): Array<{ texto: string; esPregunta: boolean }> {
  const frases: Array<{ texto: string; esPregunta: boolean }> = [];
  for (const renglon of texto.split(/\n+/)) {
    for (const crudo of renglon.split(/(?<=[.!?])\s+/)) {
      const frase = crudo.trim();
      if (!frase) continue;
      const abre = frase.indexOf("¿");
      if (abre > 0) {
        const antes = frase.slice(0, abre).trim().replace(/[,;:\s]+$/, "");
        if (antes) frases.push({ texto: /[.!]$/.test(antes) ? antes : `${antes}.`, esPregunta: false });
        frases.push({ texto: frase.slice(abre).trim(), esPregunta: true });
        continue;
      }
      frases.push({ texto: frase, esPregunta: abre === 0 || frase.endsWith("?") });
    }
  }
  return frases;
}

/** ¿Dice algo? Un "¡Claro que sí!" o un "Hola" no contestan nada. */
function esUtil(frase: string): boolean {
  const limpia = normalizar(frase.replace(/\p{Extended_Pictographic}|‍|️/gu, " "));
  if (limpia.replace(/[^a-z0-9]/g, "").length < 12) return false;
  if (RELLENO.test(limpia) && limpia.split(" ").length <= 4) return false;
  return !HABLA_DE_CONTRAENTREGA.test(limpia);
}

function textosDe(regla: ReglaV3): string[] {
  return regla.entonces.flatMap((accion) => (accion.tipo === "mensaje" && accion.texto?.trim() ? [accion.texto] : []));
}

/** La primera frase útil de la regla, en una línea con el emoji del tema (si no trae uno propio). */
function lineaDe(regla: ReglaV3, emoji: string): string | null {
  for (const texto of textosDe(regla)) {
    const frase = frasesDe(texto).find((candidata) => !candidata.esPregunta && esUtil(candidata.texto));
    if (frase) {
      const linea = frase.texto.replace(/\s+/g, " ").trim();
      return ARRANCA_CON_EMOJI.test(linea) ? linea : `${emoji} ${linea}`;
    }
  }
  return null;
}

/** La última pregunta de la regla (la de avance, que es con la que terminan sus mensajes). */
function preguntaDe(regla: ReglaV3): string | null {
  const preguntas = textosDe(regla)
    .flatMap((texto) => frasesDe(texto))
    .filter((frase) => frase.esPregunta && !HABLA_DE_CONTRAENTREGA.test(normalizar(frase.texto)));
  return preguntas.length ? preguntas[preguntas.length - 1].texto.replace(/\s+/g, " ").trim() : null;
}

export type ReglaCandidata = { regla: ReglaV3; orden: number };

export type PreguntasJuntadas = {
  /** La regla que figura como ganadora (la de mayor peso entre las juntadas). */
  ganadora: ReglaV3;
  acciones: Accion[];
  porque: string;
  /** Las reglas que entraron al mensaje. */
  juntadas: ReglaV3[];
};

/**
 * Junta varias preguntas de tema en un solo mensaje. Devuelve null si no aplica, y entonces el motor
 * sigue con el desempate de siempre (gana una sola regla).
 *
 * `candidatas` son las reglas que ya se dispararon y cumplen sus condiciones, ordenadas por el
 * desempate (la primera es la que ganaría sola). `reglasQueAplican` son TODAS las reglas activas que
 * cumplen sus condiciones ahora, se disparen o no: de ahí sale la regla de un tema que la clienta
 * nombró con palabras aunque su frase exacta no haya enganchado (en el caso real, "materiales").
 */
export function juntarPreguntas(input: {
  mensaje: string;
  candidatas: ReglaCandidata[];
  reglasQueAplican: ReglaCandidata[];
}): PreguntasJuntadas | null {
  if (input.candidatas.length === 0) return null;
  const primera = input.candidatas[0].regla;
  const temaDeLaPrimera = temaDeLaRegla(primera);
  const asesora = input.candidatas.find(({ regla }) => esReglaQuePasaAAsesora(regla))?.regla ?? null;

  /*
    Qué NO cambia: si la que gana sola es una regla que mueve la charla (elige producto, cambia de
    paso, manda un catálogo) o un seguimiento, gana sola como siempre. Solo se junta cuando gana una
    regla de tema, la de asesora, o una que solo contesta y hay una asesora que se hace cargo.
  */
  const puedeJuntar =
    temaDeLaPrimera !== null || primera === asesora || (asesora !== null && soloContesta(primera));
  if (!puedeJuntar) return null;

  // Un tema = una regla: la que se disparó primero en el desempate.
  const porTema = new Map<TemaDePregunta, ReglaV3>();
  for (const { regla } of input.candidatas) {
    const tema = temaDeLaRegla(regla);
    if (tema && !porTema.has(tema)) porTema.set(tema, regla);
  }
  // Los temas que la clienta nombró con palabras y ninguna regla disparada cubre.
  const nombrados = temasQueNombra(input.mensaje);
  if (porTema.size > 0) {
    const porPeso = [...input.reglasQueAplican].sort((a, b) => {
      const peso = pesoDeLaRegla(a.regla) - pesoDeLaRegla(b.regla);
      return peso !== 0 ? peso : a.orden - b.orden;
    });
    for (const tema of nombrados) {
      if (porTema.has(tema)) continue;
      const delLibro = porPeso.find(({ regla }) => temaDeLaRegla(regla) === tema && regla.id !== asesora?.id);
      if (delLibro) porTema.set(tema, delLibro.regla);
    }
  }

  // Varias preguntas de tema, o una de tema más una que necesita asesora.
  if (porTema.size === 0 || (porTema.size < 2 && !asesora)) return null;

  // En el orden en que la clienta las preguntó; las que reconoció la IA sin nombrarlas, al final.
  const temas = [...porTema.keys()].sort((a, b) => {
    const ia = nombrados.indexOf(a);
    const ib = nombrados.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const deTema = temas.map((tema) => ({ tema, regla: porTema.get(tema)! }));
  const juntadas = [...deTema.map(({ regla }) => regla), ...(asesora ? [asesora] : [])];
  // La que figura como ganadora: la primera del desempate entre las juntadas.
  const ganadora = input.candidatas.find(({ regla }) => juntadas.includes(regla))?.regla ?? deTema[0].regla;

  // La pregunta del final sale de la ganadora; si no trae, de la asesora o de los otros temas.
  const pregunta = [ganadora, ...(asesora ? [asesora] : []), ...deTema.map(({ regla }) => regla)]
    .map(preguntaDe)
    .find((texto): texto is string => Boolean(texto));

  // La etapa del CRM: la de la ganadora, o la primera que traiga una regla de tema.
  const etapa =
    ganadora.entonces.find((accion) => accion.tipo === "cambiar_etapa_crm") ??
    deTema.flatMap(({ regla }) => regla.entonces).find((accion) => accion.tipo === "cambiar_etapa_crm");
  // De la asesora se toma lo que la pasa a una persona: el aviso, la pausa, su etapa.
  const deLaAsesora = asesora
    ? asesora.entonces.filter((accion) => accion.tipo !== "mensaje" && accion.tipo !== "responder_con_ia")
    : [];

  const conIa = juntadas.some((regla) => regla.entonces.some((accion) => accion.tipo === "responder_con_ia"));
  let contestar: Accion;
  if (conIa) {
    /*
      Si alguna regla deja que la IA redacte, no se mezcla a ciegas un texto fijo con uno de IA: se le
      pasa a la IA una sola guía con todo lo de cada regla y la orden de contestar en líneas cortas.
    */
    contestar = { tipo: "responder_con_ia", guia: guiaJuntada(deTema, asesora) };
  } else {
    const lineas: string[] = [];
    for (const { tema, regla } of deTema) {
      const linea = lineaDe(regla, EMOJI_DEL_TEMA.get(tema) ?? "•");
      if (linea && !lineas.includes(linea)) lineas.push(linea);
    }
    const lineaDeLaAsesora = asesora ? lineaDe(asesora, EMOJI_DE_LA_ASESORA) : null;
    if (lineaDeLaAsesora && !lineas.includes(lineaDeLaAsesora)) lineas.push(lineaDeLaAsesora);
    // Si de las reglas no sale lo suficiente para juntar, mejor el camino de siempre que un mensaje a medias.
    const lineasDeTema = lineas.length - (lineaDeLaAsesora ? 1 : 0);
    if (lineasDeTema === 0 || (lineasDeTema < 2 && !asesora)) return null;
    contestar = { tipo: "mensaje", texto: [...lineas, ...(pregunta ? [pregunta] : [])].join("\n") };
  }

  const nombres = juntadas.map((regla) => `"${regla.nombre}"`).join(", ");
  return {
    ganadora,
    acciones: [contestar, ...(etapa && !deLaAsesora.some((accion) => accion.tipo === "cambiar_etapa_crm") ? [etapa] : []), ...deLaAsesora],
    porque: asesora
      ? `La clienta hizo varias preguntas en un mensaje: se contestaron los temas en un solo mensaje corto con ${nombres}, y lo que necesita una persona pasó a la asesora con "${asesora.nombre}".`
      : `La clienta hizo varias preguntas en un mensaje: se contestaron todas en un solo mensaje corto con ${nombres}.`,
    juntadas,
  };
}

/** El texto sin las frases que hablan de contraentrega: a la IA no se le pasa lo que no puede ofrecer. */
function sinContraentrega(texto: string): string {
  return frasesDe(texto)
    .filter((frase) => !HABLA_DE_CONTRAENTREGA.test(normalizar(frase.texto)))
    .map((frase) => frase.texto)
    .join(" ");
}

function guiaJuntada(deTema: Array<{ tema: TemaDePregunta; regla: ReglaV3 }>, asesora: ReglaV3 | null): string {
  const datos = [
    ...deTema.map(({ tema, regla }) => ({ emoji: EMOJI_DEL_TEMA.get(tema) ?? "•", regla })),
    ...(asesora ? [{ emoji: EMOJI_DE_LA_ASESORA, regla: asesora }] : []),
  ].map(({ emoji, regla }) => {
    const lo = regla.entonces
      .map((accion) =>
        accion.tipo === "mensaje"
          ? `usa este dato tal cual: ${sinContraentrega(accion.texto ?? "")}`
          : accion.tipo === "responder_con_ia"
            ? accion.guia
            : "",
      )
      .filter(Boolean)
      .join(" / ");
    return `- ${emoji} ${regla.nombre}: ${lo}`;
  });
  return [
    "La clienta hizo varias preguntas en un mismo mensaje. Contéstalas TODAS en UN solo mensaje corto:",
    "una línea por tema, empezando con su emoji, sin párrafos. Usa SOLO estos datos, no inventes nada.",
    asesora ? "Lo que va con 👩🏻‍💻 no lo contestes: di en una línea que una asesora le escribe." : "",
    "Termina con UNA sola pregunta de avance. Nunca ofrezcas pago contraentrega.",
    ...datos,
  ]
    .filter(Boolean)
    .join("\n");
}
