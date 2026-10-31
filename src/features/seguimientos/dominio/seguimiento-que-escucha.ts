/**
 * SEGUIMIENTOS QUE ESCUCHAN AL CLIENTE (parte 1: el revisor). Codigo puro, sin base ni OpenAI.
 *
 * El seguimiento automatico de hoy es una plantilla igual para todos ("¿Pudiste ver lo que te
 * envié?"): el cliente no la contesta porque no habla de lo suyo. Aqui esta:
 *  - el pedido para la IA: mencionar lo que ESE cliente dijo (color, producto, ciudad, para cuando,
 *    duda), traer algo nuevo o util y cerrar con una pregunta facil, en maximo 2 lineas;
 *  - la revision del texto que proponga: si no pasa, no sale;
 *  - la cadena de respaldo: propuesta de la IA -> texto fijo (si pasa la revision) -> pregunta del
 *    producto del anuncio -> no se manda nada.
 *
 * Todavia no lo usa ningun envio (eso es la parte 2).
 */

import type { Linea } from "@/lib/sugerencia-de-respuesta";
import { problemasDeSeguimiento } from "@/lib/reglas-de-redaccion";

/** Lineas que puede tener un seguimiento en WhatsApp. */
export const LINEAS_MAXIMAS = 2;

/** Intentos de la IA: el primero y 2 reintentos. */
export const INTENTOS_MAXIMOS = 3;

/** Desde este parecido (0 a 1) un texto cuenta como repeticion de uno ya enviado. */
export const PARECIDO_MAXIMO = 0.6;

/** Lineas de la conversacion que se le pasan a la IA (las ultimas). */
const LINEAS_DE_CONTEXTO = 30;

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "setiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];

/** Minusculas, sin tildes, sin emojis ni signos y con un solo espacio. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** El saludo del principio ("¡Hola, Laura!") no cuenta para comparar dos seguimientos. */
function sinSaludo(texto: string): string {
  return texto.replace(/^\s*¡?\s*hola\b[^!.?¿¡\n]{0,25}[!.]\s*/i, "");
}

/** Parecido entre dos textos (0 a 1): coeficiente de Dice sobre las palabras normalizadas. */
export function parecido(a: string, b: string): number {
  const pa = new Set(normalizar(sinSaludo(a)).split(" ").filter(Boolean));
  const pb = new Set(normalizar(sinSaludo(b)).split(" ").filter(Boolean));
  if (!pa.size && !pb.size) return 1;
  if (!pa.size || !pb.size) return 0;
  let comunes = 0;
  for (const p of pa) if (pb.has(p)) comunes += 1;
  return (2 * comunes) / (pa.size + pb.size);
}

/** Lineas con texto (las vacias no cuentan). */
function contarLineas(texto: string): number {
  return texto.split(/\r?\n/).filter((l) => l.trim()).length;
}

/**
 * Las cifras y fechas que trae un texto, para buscarlas en el libro y en la conversacion.
 * "$150.000" y "150,000" quedan como "150000"; "150 mil" como "150" y "150000"; meses y dias de la
 * semana por su nombre.
 */
function cifrasYFechas(texto: string): { muestra: string; variantes: string[] }[] {
  const encontradas: { muestra: string; variantes: string[] }[] = [];
  for (const m of texto.matchAll(/\d[\d.,]*(\s*mil\b)?/gi)) {
    const digitos = m[0].replace(/\D/g, "");
    if (!digitos) continue;
    const variantes = [digitos];
    if (m[1]) variantes.push(`${digitos}000`);
    encontradas.push({ muestra: m[0].trim(), variantes });
  }
  const palabras = normalizar(texto).split(" ");
  for (const p of palabras) {
    if (MESES.includes(p) || DIAS.includes(p)) encontradas.push({ muestra: p, variantes: [p] });
  }
  return encontradas;
}

/** Lo que dice la fuente (libro + conversacion) en digitos y en palabras, para buscar ahi. */
function indiceDeLaFuente(fuente: string) {
  const digitos = new Set<string>();
  for (const m of fuente.matchAll(/\d[\d.,]*(\s*mil\b)?/gi)) {
    const d = m[0].replace(/\D/g, "");
    if (!d) continue;
    digitos.add(d);
    if (m[1]) digitos.add(`${d}000`);
  }
  const palabras = new Set(normalizar(fuente).split(" "));
  return { digitos, palabras };
}

export type RevisionDelSeguimiento = {
  /** La conversacion con el cliente (lo que dijo el y lo que le dijimos). */
  conversacion: Linea[];
  /** Los seguimientos que ya le llegaron a este chat. */
  yaEnviados: string[];
  /** El texto del libro V3 (precios, envios, formas de pago): de ahi pueden salir cifras. */
  textoDelLibro: string | null;
};

/**
 * Los problemas de un seguimiento propuesto (vacio = se puede mandar). Se rechaza si tiene mas de 2
 * lineas, una frase prohibida, no termina en pregunta, se parece a uno ya enviado o trae un precio,
 * una cifra o una fecha que no esta ni en el libro ni en la conversacion.
 */
export function revisarSeguimiento(texto: string, contexto: RevisionDelSeguimiento): string[] {
  const limpio = (texto ?? "").trim();
  if (!limpio) return ["está vacío"];

  const problemas: string[] = [];
  const lineas = contarLineas(limpio);
  if (lineas > LINEAS_MAXIMAS) problemas.push(`tiene ${lineas} líneas (máximo ${LINEAS_MAXIMAS})`);

  // Las frases prohibidas, el largo, una sola pregunta y que termine en pregunta.
  problemas.push(...problemasDeSeguimiento(limpio));

  const repetido = contexto.yaEnviados.find((enviado) => enviado.trim() && parecido(limpio, enviado) >= PARECIDO_MAXIMO);
  if (repetido !== undefined) problemas.push(`se parece a un seguimiento ya enviado («${repetido.trim().slice(0, 60)}»)`);

  const fuente = [contexto.textoDelLibro ?? "", ...contexto.conversacion.map((l) => l.texto)].join("\n");
  const indice = indiceDeLaFuente(fuente);
  for (const dato of cifrasYFechas(limpio)) {
    const esta = dato.variantes.some((v) => indice.digitos.has(v) || indice.palabras.has(v));
    if (!esta) problemas.push(`trae «${dato.muestra}», que no está ni en el libro ni en la conversación`);
  }

  return [...new Set(problemas)];
}

/**
 * Para el cliente que solo mando el texto del anuncio: una pregunta corta y concreta sobre el
 * producto. null si no se sabe el producto.
 */
export function seguimientoDelAnuncio(producto: string | null | undefined): string | null {
  const nombre = (producto ?? "").replace(/\s+/g, " ").trim();
  if (!nombre) return null;
  return `¿Te comparto fotos y medidas de ${nombre}?`;
}

function quien(linea: Linea) {
  return linea.de === "cliente" ? "Cliente" : "Nosotros";
}

/**
 * Las instrucciones y el contexto para que la IA escriba el seguimiento de ESTE cliente.
 * `paso` es el numero del seguimiento (1 = el primero despues del silencio).
 */
export function armarPedidoDeSeguimiento(input: {
  lineas: Linea[];
  producto: string | null;
  paso: number;
  yaEnviados: string[];
  datosDelLibro: string | null;
  soloMandoElAnuncio: boolean;
}): { instrucciones: string; contexto: string } {
  const reglas = [
    "Escribes UN mensaje de seguimiento por WhatsApp para un cliente que dejó de contestar. Tuteas, en español de Colombia.",
    "Menciona algo que ESTE cliente dijo en la conversación: el color, el producto, la ciudad, para cuándo lo necesita o la duda que tuvo. Si no dijo nada de eso, habla del producto que le interesa.",
    "Trae algo nuevo o útil para él (un dato del producto, del envío o de la forma de pago que esté en los DATOS DEL NEGOCIO); no repitas lo que ya le dijimos.",
    "Cierra con UNA sola pregunta fácil de contestar (de sí o no, o de elegir entre dos), al final del mensaje.",
    `Máximo ${LINEAS_MAXIMAS} líneas y unas 35 palabras.`,
    "No inventes precios, cifras ni fechas: solo puedes usar los que estén en la conversación o en los DATOS DEL NEGOCIO.",
    'Nunca escribas "pero" (usa "sin embargo"), "¿sigues interesada?", "cuando puedas me avisas", "¿pudiste ver lo que te envié?", "aquí estoy para ayudarte" ni "si te queda alguna duda". No trates de usted.',
    "No repitas ni parafrasees los SEGUIMIENTOS YA ENVIADOS.",
    "Responde solo con el texto del mensaje, sin comillas ni explicaciones.",
  ];
  if (input.soloMandoElAnuncio) {
    reglas.push(
      "Este cliente solo mandó el texto del anuncio y no escribió nada más: haz una pregunta corta y concreta sobre el producto del anuncio.",
    );
  }

  const conversacion = input.lineas
    .slice(-LINEAS_DE_CONTEXTO)
    .map((l) => `${quien(l)}: ${l.texto.replace(/\s+/g, " ").trim()}`)
    .filter((l) => !l.endsWith(": "));

  const contexto = [
    `PRODUCTO QUE LE INTERESA: ${input.producto?.trim() || "(no se sabe)"}`,
    `SEGUIMIENTO NÚMERO: ${input.paso}`,
    "",
    "CONVERSACIÓN (de la más vieja a la más nueva):",
    conversacion.length ? conversacion.join("\n") : "(sin mensajes)",
    "",
    "SEGUIMIENTOS YA ENVIADOS:",
    input.yaEnviados.filter((t) => t.trim()).length
      ? input.yaEnviados.filter((t) => t.trim()).map((t) => `- ${t.trim()}`).join("\n")
      : "(ninguno)",
    "",
    "DATOS DEL NEGOCIO (del libro):",
    input.datosDelLibro?.trim() || "(sin datos)",
  ].join("\n");

  return { instrucciones: reglas.join("\n"), contexto };
}

export type TextoElegido =
  | {
      enviar: true;
      texto: string;
      origen: "ia" | "fijo" | "producto";
      /** Lo que se descarto antes, con sus problemas (para el registro). */
      descartados: { texto: string; problemas: string[] }[];
    }
  | { enviar: false; motivo: string; descartados: { texto: string; problemas: string[] }[] };

/**
 * Decide que seguimiento sale, en orden: la primera propuesta de la IA que pase la revision (hasta 3
 * intentos); si ninguna pasa, el texto fijo, solo si tambien pasa; si no, la pregunta del producto
 * del anuncio; si no hay producto, no se manda nada.
 * `textoFijo` llega ya armado (con el nombre puesto).
 */
export function elegirTexto(
  input: {
    propuestas: string[];
    textoFijo: string | null;
    producto: string | null;
  } & RevisionDelSeguimiento,
): TextoElegido {
  const descartados: { texto: string; problemas: string[] }[] = [];
  // El nombre del producto tambien vale como fuente ("Combo 3 en 1" trae un 3 que no es inventado).
  const revision: RevisionDelSeguimiento = {
    conversacion: input.conversacion,
    yaEnviados: input.yaEnviados,
    textoDelLibro: [input.textoDelLibro ?? "", input.producto ?? ""].join("\n"),
  };

  for (const propuesta of input.propuestas.slice(0, INTENTOS_MAXIMOS)) {
    const problemas = revisarSeguimiento(propuesta, revision);
    if (!problemas.length) return { enviar: true, texto: propuesta.trim(), origen: "ia", descartados };
    descartados.push({ texto: propuesta, problemas });
  }

  if (input.textoFijo?.trim()) {
    const problemas = revisarSeguimiento(input.textoFijo, revision);
    if (!problemas.length) return { enviar: true, texto: input.textoFijo.trim(), origen: "fijo", descartados };
    descartados.push({ texto: input.textoFijo, problemas });
  }

  const delAnuncio = seguimientoDelAnuncio(input.producto);
  if (delAnuncio) return { enviar: true, texto: delAnuncio, origen: "producto", descartados };

  return {
    enviar: false,
    motivo: "ninguna propuesta pasó la revisión, el texto fijo tampoco y no se sabe el producto",
    descartados,
  };
}
