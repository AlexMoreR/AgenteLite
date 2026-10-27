import { frasesProhibidas, frasesRoboticas, PALABRAS_MAXIMAS_DE_SEGUIMIENTO, terminaEnPregunta } from "@/lib/reglas-de-redaccion";

/**
 * SEGUIMIENTOS QUE ESCUCHAN AL CLIENTE (Alex, 26-10-2026): "Lo que importa es escuchar al cliente".
 *
 * Solo lógica, sin base ni red. Aquí está lo que se le pide a la IA y la revisión del texto que
 * devuelve: corto, sin frases de robot, sin repetir un seguimiento ya enviado y sin inventar
 * precios, cifras, plazos ni fechas. El servicio (services/seguimiento-que-escucha.ts) lee el chat
 * y llama a la IA; esto decide si el texto sirve.
 */

export type LineaDelChat = { de: "cliente" | "negocio"; texto: string; hace: string };

export type ProductoDelSeguimiento = {
  nombre: string;
  codigo: string | null;
  precio: string;
  descripcion: string | null;
  precioMayorista: number | null;
};

/** Máximo de líneas (no vacías) de un seguimiento. */
export const LINEAS_MAXIMAS = 2;

/** Desde esta parecida con un seguimiento ya enviado, se considera repetido. */
export const PARECIDO_MAXIMO = 0.7;

export const CLAVE_APAGADO = "seguimientos-que-escuchan:apagado";

export const REGLAS_DEL_SEGUIMIENTO = `REGLAS DEL SEGUIMIENTO (todas obligatorias):
- Máximo 2 líneas cortas (unas 30 palabras en total). Una sola pregunta, al final, fácil de contestar.
- Menciona lo que ESTE cliente dijo o pidió (color, producto, ciudad, para cuándo, una duda). Si dijo algo por nota de voz, úsalo igual que si lo hubiera escrito.
- Trae algo útil o nuevo (por ejemplo, dejarle apartada la opción que pidió o avanzar al siguiente paso), sin repetir lo que ya se le dijo.
- Prohibido: "¿pudiste ver lo que te envié?", "aquí estoy para ayudarte", "si te queda alguna duda", "quedo atenta", "cuando quieras", "¿sigues interesada?", "pero".
- No inventes precios, cifras, fechas, plazos ni promesas: usa solo los datos del negocio y de la conversación. Si no sabes un dato, no lo menciones.
- Nunca ofrezcas descuentos ni precio al por mayor.
- Español de Colombia, tutea (tú, nunca vos ni usted). Sin saludo largo ni firma. Un emoji como máximo.
- Negrita de WhatsApp con UN solo asterisco (*así*).`;

const FORMATO = `Responde SOLO un JSON: {"texto": "<el mensaje>"}`;

export function armarSistema(input: { comoHablamos: string; producto: ProductoDelSeguimiento | null; soloAnuncio: boolean }) {
  return [
    "Eres una vendedora experta de Magilus que le escribe por WhatsApp a un cliente que dejó de contestar. Redactas el SEGUIMIENTO: un mensaje corto que le demuestre que lo escuchaste.",
    REGLAS_DEL_SEGUIMIENTO,
    input.soloAnuncio
      ? "SITUACIÓN: el cliente solo mandó el texto del anuncio y no dijo nada más. No inventes lo que quiere: escribe un seguimiento corto con UNA pregunta concreta sobre el producto del anuncio (color, uso, ciudad o para cuándo lo necesita)."
      : "",
    input.comoHablamos
      ? `DATOS DEL NEGOCIO Y FORMA DE HABLAR (fuente de verdad: precios, pagos, envíos, materiales):\n${input.comoHablamos}`
      : "",
    input.producto
      ? `PRODUCTO DEL QUE SE HABLA:\n*${input.producto.nombre}*${input.producto.codigo ? ` (${input.producto.codigo})` : ""}\nPrecio: ${input.producto.precio}\n${input.producto.descripcion ? `Descripción:\n${input.producto.descripcion}` : "Sin descripción: no inventes características."}`
      : "No hay un producto identificado: no inventes precios ni características.",
    FORMATO,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function armarPedido(input: {
  lineas: LineaDelChat[];
  yaEnviados: string[];
  nombre: string | null;
  enviado: string;
}) {
  const conversacion = input.lineas
    .map((linea) => `[${linea.hace}] ${linea.de === "cliente" ? "Cliente" : "Vendedora"}: ${linea.texto}`)
    .join("\n");
  return [
    `Conversación completa (de la más vieja a la más nueva, con hace cuánto se escribió cada mensaje; [nota de voz] es un audio ya pasado a texto):\n${conversacion || "(sin mensajes)"}`,
    input.enviado ? `Ya se le envió en este chat: ${input.enviado}.` : "",
    input.yaEnviados.length > 0
      ? `Seguimientos que YA se le mandaron (no repitas ninguno, ni uno parecido):\n${input.yaEnviados.map((texto) => `- ${texto}`).join("\n")}`
      : "",
    input.nombre ? `El cliente se llama ${input.nombre} (úsalo solo si suena natural).` : "",
    "Escribe el próximo seguimiento.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Lo que dice el JSON del modelo (o el texto entero si no vino JSON), en un solo bloque limpio. */
export function leerTextoDelModelo(crudo: string): string {
  let texto = crudo;
  try {
    const datos = JSON.parse(crudo) as { texto?: unknown };
    texto = typeof datos.texto === "string" ? datos.texto : "";
  } catch {
    // Si no vino JSON, el texto entero es el mensaje.
  }
  return texto
    .replace(/^["“]|["”]$/g, "")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function sinTildes(texto: string) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function palabrasDe(texto: string) {
  return new Set(
    sinTildes(texto)
      .replace(/[^a-z0-9ñ\s]/g, " ")
      .split(/\s+/)
      .filter((palabra) => palabra.length > 2),
  );
}

/** Parecido entre dos textos (0 a 1): palabras en común sobre palabras en total. */
export function parecido(a: string, b: string) {
  const x = palabrasDe(a);
  const y = palabrasDe(b);
  if (x.size === 0 || y.size === 0) return 0;
  let comunes = 0;
  for (const palabra of x) if (y.has(palabra)) comunes += 1;
  return comunes / (x.size + y.size - comunes);
}

export function seRepite(texto: string, yaEnviados: string[]) {
  return yaEnviados.some((previo) => parecido(texto, previo) >= PARECIDO_MAXIMO);
}

/** Los números del texto, sin puntos ni comas ("$1.250.000" → "1250000"; "3" → "3"). */
function cifras(texto: string) {
  return [...texto.matchAll(/\d[\d.,]*/g)].map((m) => m[0].replace(/[.,]+$/, "").replace(/[.,]/g, "")).filter(Boolean);
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];

/**
 * Precios, cifras, plazos y fechas del texto que NO están en el contexto (libro, producto y
 * conversación). Una cifra vale también si es la mitad de una conocida (el anticipo del 50%).
 */
export function datosInventados(texto: string, contexto: string): string[] {
  const problemas: string[] = [];
  const conocidas = new Set<string>();
  for (const cifra of cifras(contexto)) {
    conocidas.add(cifra);
    const numero = Number(cifra);
    if (Number.isFinite(numero) && numero >= 1000) conocidas.add(String(Math.round(numero / 2)));
  }
  const inventadas = cifras(texto).filter((cifra) => !conocidas.has(cifra));
  if (inventadas.length > 0) problemas.push(`trae cifras que no están en los datos (${inventadas.join(", ")})`);

  const contextoPlano = sinTildes(contexto);
  const textoPlano = sinTildes(texto);
  const fechas = [...MESES, ...DIAS].filter((palabra) => new RegExp(`\\b${palabra}\\b`).test(textoPlano) && !new RegExp(`\\b${palabra}\\b`).test(contextoPlano));
  if (fechas.length > 0) problemas.push(`menciona una fecha que no está en los datos (${fechas.join(", ")})`);

  const plazos = textoPlano.match(/\d+(\s*(a|-|y)\s*\d+)?\s*(dias|semanas|horas|meses)(\s+habiles)?/g) ?? [];
  const sinPlazo = plazos.filter((plazo) => !contextoPlano.includes(plazo));
  if (sinPlazo.length > 0) problemas.push(`promete un tiempo que no está en los datos ("${sinPlazo.join('", "')}")`);
  return problemas;
}

export function lineasDe(texto: string) {
  return texto.split(/\n+/).map((linea) => linea.trim()).filter(Boolean).length;
}

/** Todo lo que puede fallar en un seguimiento. Lista vacía = puede salir. */
export function revisarSeguimiento(
  texto: string,
  datos: { contexto: string; yaEnviados: string[]; precioMayorista?: number | null },
): string[] {
  const limpio = texto.trim();
  if (!limpio) return ["está vacío"];
  const problemas: string[] = [];

  if (lineasDe(limpio) > LINEAS_MAXIMAS) problemas.push(`tiene más de ${LINEAS_MAXIMAS} líneas`);
  const palabras = limpio.split(/\s+/).filter(Boolean).length;
  if (palabras > PALABRAS_MAXIMAS_DE_SEGUIMIENTO) problemas.push(`es largo (${palabras} palabras)`);

  problemas.push(...frasesRoboticas(limpio));
  problemas.push(...frasesProhibidas(limpio));

  if (!terminaEnPregunta(limpio)) problemas.push("no termina con una pregunta");
  if ((limpio.match(/\?/g) ?? []).length > 1) problemas.push("hace más de una pregunta");

  if (seRepite(limpio, datos.yaEnviados)) problemas.push("se parece a un seguimiento que ya se le envió");

  problemas.push(...datosInventados(limpio, datos.contexto));

  if (/mayoris|al por mayor|descuento/i.test(limpio)) problemas.push("menciona descuentos o precio al por mayor");
  if (datos.precioMayorista && limpio.replace(/[.\s,$]/g, "").includes(String(Math.round(datos.precioMayorista)))) {
    problemas.push("incluye el precio mayorista");
  }
  return problemas;
}

/**
 * La pregunta corta del producto, sin IA: el último recurso cuando la IA falla o el cliente solo
 * mandó el anuncio. No lleva cifras ni promesas. Devuelve la primera que no se parezca a una ya enviada.
 */
export function preguntaDelProducto(producto: ProductoDelSeguimiento | null, yaEnviados: string[], nombre: string | null) {
  if (!producto) return null;
  const hola = nombre ? `${nombre}, ` : "";
  const candidatas = [
    `${hola}¿para qué ciudad sería tu *${producto.nombre}*? 😊`,
    `${hola}¿qué color del *${producto.nombre}* te gustó más? 😊`,
    `${hola}¿para cuándo necesitas tu *${producto.nombre}*? 😊`,
  ];
  return candidatas.find((texto) => !seRepite(texto, yaEnviados)) ?? null;
}
