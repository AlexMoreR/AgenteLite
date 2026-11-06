/**
 * SEGUIMIENTOS QUE ESCUCHAN AL CLIENTE (parte 1: el revisor). Codigo puro, sin base ni OpenAI.
 *
 * El seguimiento automatico de hoy es una plantilla igual para todos ("¿Pudiste ver lo que te
 * envié?"): el cliente no la contesta porque no habla de lo suyo. Aqui esta:
 *  - el pedido para la IA: mencionar lo que ESE cliente dijo (color, producto, ciudad, para cuando,
 *    duda), traer algo nuevo o util y cerrar con una pregunta facil, en maximo 2 lineas;
 *  - la revision del texto que proponga: si no pasa, no sale;
 *  - la cadena de respaldo: propuesta de la IA -> cierre de apartar (si ya dio la ciudad) -> texto
 *    fijo (si pasa la revision) -> pregunta del producto del anuncio -> no se manda nada.
 *
 * El revisor tambien hace cumplir "lo que el cliente ya dijo": no se le vuelve a preguntar la ciudad,
 * el color, la fecha ni el servicio, y si ya dio la ciudad el texto la nombra y pide apartar.
 */

import type { Linea } from "@/lib/sugerencia-de-respuesta";
import { problemasDeSeguimiento } from "@/lib/reglas-de-redaccion";
import { buscarPorReglas, type TurnoDelChat } from "@/features/cotizaciones/services/datos-de-cotizacion";
import { clienteConfirmoCompra, type MensajeDelChat } from "@/features/seguimientos/dominio/confirmacion-de-compra";
import { preguntaLaCiudad } from "@/features/supervisor/dominio/lead";

/**
 * Los origenes (`rawPayload.source`) de los mensajes de seguimiento: los follows y los del reloj del
 * V3. Los usan el redactor (seguimientos ya enviados) y `buscar_mensajes` (solo seguimientos).
 */
export const ORIGENES_DE_SEGUIMIENTO = ["follow", "agente-v3-seguimiento", "agente-v3-seguimiento-ia"];

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
  /** El producto del chat: la contraentrega solo vale si es un Combo. null o ausente = no se sabe. */
  producto?: string | null;
  /**
   * El texto agendado (el del libro o el del seguimiento): una promesa de llegada, de pago o de
   * contraentrega solo vale si ese mismo tema ya esta aqui. null o ausente = no hay texto agendado.
   */
  textoAgendado?: string | null;
};

/**
 * Los problemas de un seguimiento propuesto (vacio = se puede mandar). Se rechaza si tiene mas de 2
 * lineas, una frase prohibida, no termina en pregunta, se parece a uno ya enviado, vuelve a preguntar
 * lo que el cliente ya dijo (o no cierra pidiendo apartar cuando ya dio la ciudad), trae un precio,
 * una cifra o una fecha que no esta ni en el libro ni en la conversacion, o rompe una regla del libro:
 * da el valor del envio, ofrece contraentrega en un producto que no es el Combo o promete que llega a
 * San Andres, Leticia, Inirida o Mitu. Ademas, la regla de los seguimientos automaticos (6-nov-2026,
 * chat 8927): nada de "gratis" ni de envio sin costo o incluido, aunque lleve el 50 %, y nada de
 * prometer llegada, pago o contraentrega si el texto agendado no lo dice (ver revisarAntesDeEnviar).
 * Antes de revisar se quitan todos los asteriscos (la negrita de WhatsApp): "*envío*" o "*50* %" tienen
 * que caer en las mismas reglas que sin negrita. Un asterisco entre dos letras o numeros se vuelve un
 * espacio ("envio*gratis*" no puede quedar "enviogratis" y esconder el "gratis"). Solo se quitan para
 * revisar: lo que se manda los conserva (elegirTexto devuelve la propuesta tal cual).
 */
export function revisarSeguimiento(texto: string, contexto: RevisionDelSeguimiento): string[] {
  const limpio = (texto ?? "")
    .replace(/(?<=[\p{L}\p{N}])\*+(?=[\p{L}\p{N}])/gu, " ")
    .replace(/\*/g, "")
    .trim();
  if (!limpio) return ["está vacío"];

  const problemas: string[] = [];
  const lineas = contarLineas(limpio);
  if (lineas > LINEAS_MAXIMAS) problemas.push(`tiene ${lineas} líneas (máximo ${LINEAS_MAXIMAS})`);

  // Las frases prohibidas, el largo, una sola pregunta y que termine en pregunta.
  problemas.push(...problemasDeSeguimiento(limpio));

  const repetido = contexto.yaEnviados.find((enviado) => enviado.trim() && parecido(limpio, enviado) >= PARECIDO_MAXIMO);
  if (repetido !== undefined) problemas.push(`se parece a un seguimiento ya enviado («${repetido.trim().slice(0, 60)}»)`);

  // Lo que el cliente ya dijo: no se le vuelve a preguntar y, si dio la ciudad, se cierra pidiendo apartar.
  problemas.push(...problemasConLoQueDijo(limpio, loQueDijoElCliente(contexto.conversacion)));

  // Lo que el libro prohibe: valor del envio, envio gratis sin condicion, contraentrega fuera del Combo...
  problemas.push(...problemasConElLibro(limpio, contexto.producto ?? null));

  // Lo que un seguimiento automatico nunca promete: envio gratis, llegada, pago o contraentrega.
  problemas.push(...revisarAntesDeEnviar(limpio, contexto.textoAgendado ?? null));

  const fuente = [contexto.textoDelLibro ?? "", ...contexto.conversacion.map((l) => l.texto)].join("\n");
  const indice = indiceDeLaFuente(fuente);
  // El "50 %" del cierre de apartar es la regla del anticipo, no una cifra inventada. Solo esa forma:
  // "50 mil" sigue siendo un precio y se revisa.
  for (const dato of cifrasYFechas(limpio.replace(/\b50\s?%/g, " "))) {
    const esta = dato.variantes.some((v) => indice.digitos.has(v) || indice.palabras.has(v));
    if (!esta) problemas.push(`trae «${dato.muestra}», que no está ni en el libro ni en la conversación`);
  }

  return [...new Set(problemas)];
}

/* ----------------------------------------------------------------------------------------------
   Las reglas del libro V3 que el seguimiento no puede romper (el libro solo se respeta, no se edita).
---------------------------------------------------------------------------------------------- */

/** Minusculas y sin tildes, pero con "$", puntos y comas (para reconocer un valor en pesos). */
function sinTildes(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

/**
 * Un valor en pesos: "$20.000", "20 mil", "20.000", "15000 pesos". Un plazo ("2 a 4 dias") no es
 * un valor: no lleva "$", ni "mil", ni separador de miles.
 */
const VALOR = String.raw`(?:\$\s*\d[\d.,]*(?:\s*mil\b)?|\d[\d.,]*\s*(?:mil|pesos)\b|\d{1,3}(?:[.,]\d{3})+)`;

/** Formas de dar el valor del envio. "$350.000 con envio incluido" no es una: es el precio del producto. */
const VALOR_DEL_ENVIO = [
  /\bfletes?\b/,
  new RegExp(
    `\\benvios?(?: (?:a|hasta|para) [a-z ]{1,25}?)?\\s*(?:te |le |les |nos )?(?:cuesta|cuestan|vale|valen|sale|sale en|queda en|tiene un (?:costo|valor) de|es de|cobra|cobramos|:)\\s*(?:de |en |por )?${VALOR}`,
  ),
  new RegExp(`\\benvios? (?:de|por|en) ${VALOR}`),
  new RegExp(`${VALOR}\\s*(?:de|del|por|para|en)(?: el)? envios?\\b`),
];
/** "contraentrega solo en el Combo": aclarar la regla no es ofrecerla. */
const CONTRAENTREGA_SOLO_EN_EL_COMBO = /\bsolo (aplica |es |funciona |va )?(en|con|para|al|a) (el )?combo\b/;
/** Prometer que llega o que se envia; lo negado ("no llega") no promete nada y se quita antes. */
const PROMETE_LLEGADA = /\b(llegan?|te (lo|la|los|las) (enviamos|mandamos|despachamos)|(enviamos|mandamos|despachamos))\b/;
const NIEGA_LLEGADA = /\bno (te |le |les )?(lo |la |los |las )?(llegan?|enviamos|mandamos|despachamos)\b/g;
const NOMBRE_SIN_COBERTURA: Record<string, string> = {
  "san andres": "San Andrés",
  leticia: "Leticia",
  inirida: "Inírida",
  mitu: "Mitú",
};

/** Los problemas del texto contra las reglas del libro (los recibe la IA al reintentar). */
function problemasConElLibro(texto: string, producto: string | null): string[] {
  const problemas: string[] = [];
  const bajo = sinTildes(texto);
  const textoNormal = normalizar(texto);

  if (VALOR_DEL_ENVIO.some((patron) => patron.test(bajo))) {
    problemas.push("da el valor del envío: no lo des, el libro no lo permite");
  }
  // "Envio gratis" y "sin costo de envio" los rechaza revisarAntesDeEnviar, siempre (aunque lleve el 50 %).

  const esCombo = /\bcombo\b/.test(normalizar(producto ?? ""));
  if (CONTRAENTREGA.test(textoNormal) && !esCombo && !CONTRAENTREGA_SOLO_EN_EL_COMBO.test(textoNormal)) {
    problemas.push(
      producto?.trim()
        ? `ofrece contraentrega y el producto (${producto.trim()}) no es el Combo: la contraentrega solo aplica al Combo`
        : "ofrece contraentrega y no se sabe si el producto es el Combo: la contraentrega solo aplica al Combo",
    );
  }

  for (const frase of texto.split(/[.!?¿¡\n]+/)) {
    const normal = normalizar(frase).replace(NIEGA_LLEGADA, " ");
    if (!PROMETE_LLEGADA.test(normal)) continue;
    const ciudad = Object.keys(NOMBRE_SIN_COBERTURA).find((c) => new RegExp(`(^| )${c}( |$)`).test(normal));
    if (ciudad) {
      problemas.push(`promete que llega a ${NOMBRE_SIN_COBERTURA[ciudad]}: no hay envío asegurado a esa ciudad`);
      break;
    }
  }
  return problemas;
}

/* ----------------------------------------------------------------------------------------------
   La puerta de envio (6-nov-2026, chat 8927): lo que un seguimiento automatico nunca promete.

   El redactor escribio «envío gratis a ciudades principales si lo separas con el 50%» porque «Cómo
   hablamos» del libro lo permite con la condicion. En un seguimiento automatico no vale: no se sabe
   si a esa ciudad llega, ni como va a pagar. Mejor callar que prometer.
   - Siempre se rechaza: "gratis" en cualquier forma y el envio sin costo o incluido.
   - Se rechaza salvo que el texto agendado ya hable de lo mismo: prometer que llega (o a que
     ciudades), el pago (50 %, anticipo, al recibir) y la contraentrega.
---------------------------------------------------------------------------------------------- */

/** Lo que nunca sale, con el problema que se le explica a la IA. Sobre el texto sin tildes. */
const SIEMPRE_PROHIBIDO: { patron: RegExp; problema: string }[] = [
  {
    patron: /\b(gratis|gratuit[oa]s?|gratuitamente)\b/,
    problema: "dice «gratis»: un seguimiento automático no habla de envío gratis (ni con el 50 %)",
  },
  {
    patron: /\b(sin|no tiene|no tienen|no lleva|no llevan)( ningun| algun)? (costo|cobro|recargo)\b/,
    problema: "dice que no tiene costo: un seguimiento automático no habla del costo del envío",
  },
  {
    patron:
      /\b(envios? (va |van |esta |estan |queda |viene |ya )?incluid[oa]s?|incluy\w* (el |los )?envios?|no (te |le |les )?cobra(mos|n)? (el |por el )?envios?)\b/,
    problema: "dice que el envío va incluido: un seguimiento automático no habla del costo del envío",
  },
];

/** Prometer que le llega, que se lo enviamos o a que ciudades llegamos. Sobre el texto sin tildes. */
const PROMESA_DE_LLEGADA = [
  /\b(te|le|les|nos) (llega|llegan|llegaria|llegarian|llegara|llegaran)\b/,
  /\bllega(n|ria|ra)? (a|hasta|en) /,
  /\b(te|se|le|les) (lo|la|los|las) (enviamos|mandamos|despachamos|llevamos|enviaremos|mandaremos|hacemos llegar)\b/,
  /\b(enviamos|despachamos|mandamos|llevamos|llegamos|entregamos) (a|hasta|para|en) /,
  /\bdespach\w*/,
  /\bcobertura\b/,
  /\bciudades principales\b/,
  /\benvios? (a|hasta|para) (toda|todo|todas|todos|cualquier)\b/,
  /\bhacemos envios?\b/,
];

/**
 * Prometer una condicion de pago: anticipo, 50 %, al recibir, Nequi... Sobre el texto sin tildes (con
 * el "%"). Ofrecer ayuda ("¿te ayudo con la forma de pago?") no es una condicion y pasa.
 */
const PROMESA_DE_PAGO = [
  /\b50\s?(%|por ciento)/,
  /\bla mitad\b/,
  /\banticip\w*/,
  /\babon\w*/,
  /\bal (recibir|recibirlo|recibirla|entregar|entregarlo|entregarla)\b/,
  /\b(pagas|pagar|pago|pague|pagues|pagarlo|pagarla) (el resto|la otra mitad|cuando|contra|al|en casa)\b/,
  /\b(nequi|daviplata|transferencia|bancolombia)\b/,
];

/** Texto sin tildes y con un solo espacio (conserva "%" para el 50 %). */
function paraLaPuerta(texto: string): string {
  return sinTildes(texto).replace(/\s+/g, " ").trim();
}

/**
 * Preguntar a donde se envia no promete nada ("¿A qué ciudad te lo enviamos?"), y lo negado ("no
 * llega") tampoco: se quitan antes de buscar la promesa.
 */
const PREGUNTA_A_DONDE_SE_ENVIA =
  /\b(a que ciudad|para que ciudad|a que direccion|a donde|adonde|donde) (te |se |le |les )?(lo |la |los |las )?(enviamos|mandamos|despachamos|llevamos|enviaria|enviariamos|llega|llegaria)\b/g;

function hablaDeLlegada(texto: string): boolean {
  const t = paraLaPuerta(texto).replace(PREGUNTA_A_DONDE_SE_ENVIA, " ").replace(NIEGA_LLEGADA, " ");
  return PROMESA_DE_LLEGADA.some((p) => p.test(t));
}

function hablaDeContraentrega(texto: string): boolean {
  return CONTRAENTREGA.test(normalizar(texto));
}

function hablaDelPago(texto: string): boolean {
  const t = paraLaPuerta(texto);
  return PROMESA_DE_PAGO.some((p) => p.test(t));
}

/**
 * La puerta final de un seguimiento automatico, justo antes de enviarlo (vacio = puede salir). La usa
 * el revisor de la IA y tambien cada camino que manda un texto sin IA (sin clave, interruptor
 * apagado, falla del redactor, sin respuesta a la bienvenida, fotos con texto, flujos y el reloj del
 * V3). `textoAgendado` es lo que estaba programado: si ya hablaba de la llegada, del pago o de la
 * contraentrega, ese tema puede salir; "gratis" no sale nunca.
 */
export function revisarAntesDeEnviar(texto: string, textoAgendado: string | null | undefined): string[] {
  const t = paraLaPuerta(texto ?? "");
  if (!t) return [];
  const agendado = textoAgendado ?? "";
  const problemas = SIEMPRE_PROHIBIDO.filter(({ patron }) => patron.test(t)).map(({ problema }) => problema);

  if (hablaDeLlegada(texto) && !hablaDeLlegada(agendado)) {
    problemas.push("promete que le llega o a qué ciudades enviamos: no lo prometas en un seguimiento");
  }
  // La contraentrega agendada tambien es un tema de pago ("pagas al recibir").
  if (hablaDelPago(texto) && !hablaDelPago(agendado) && !hablaDeContraentrega(agendado)) {
    problemas.push("habla del pago (50 %, anticipo o al recibir): no lo menciones en un seguimiento");
  }
  if (hablaDeContraentrega(texto) && !hablaDeContraentrega(agendado)) {
    problemas.push("habla de contraentrega: no la menciones en un seguimiento");
  }
  return problemas;
}

/** Lo que el redactor no debe ver: envio, gratis, contraentrega, pago y a donde llegamos. */
const TEMA_DE_ENVIO_Y_PAGO = [
  /\b(envio|envios|enviamos|enviar|flete|fletes|domicilio|despach\w*|cobertura|llega\w*)\b/,
  /\b(gratis|gratuit\w*|contraentrega|contra entrega)\b/,
  /\bciudades principales\b/,
  /\b(formas?|medios?) de pago\b/,
  ...PROMESA_DE_PAGO,
];

/**
 * Quita de un texto del libro o del producto las frases que hablan del envio, de gratis, de la
 * contraentrega o del pago, para que el redactor de seguimientos no las copie. El libro no cambia:
 * esto es solo lo que se le pasa a la IA.
 */
export function quitarTemaDeEnvioYPago(texto: string | null | undefined): string {
  return (texto ?? "")
    .split(/\r?\n/)
    .map((linea) =>
      linea
        .split(/(?<=[.!?])\s+/)
        .filter((frase) => !TEMA_DE_ENVIO_Y_PAGO.some((p) => p.test(paraLaPuerta(frase))))
        .join(" ")
        .trimEnd(),
    )
    .filter((linea) => linea.trim() && !/^\s*[-*•]\s*$/.test(linea))
    .join("\n");
}

/** Las preguntas del texto, normalizadas: de cada oracion con "?", lo que va desde su "¿" (si lo tiene). */
function preguntasDelTexto(texto: string): string[] {
  return texto
    .split(/(?<=[?.!\n])/)
    .filter((parte) => parte.includes("?"))
    .map((parte) => normalizar(parte.includes("¿") ? parte.slice(parte.lastIndexOf("¿")) : parte))
    .filter(Boolean);
}

/** Pedir apartar o separar valen igual ("¿te lo aparto?", "¿te la separo?"). */
const PIDE_APARTAR = /\b(apart|separ)\w*/;
const PREGUNTA_EL_COLOR = /\b(que|cual) colou?r(es)?\b/;
const PREGUNTA_LA_FECHA = /\b(para cuando|que fecha)\b/;
const PREGUNTA_EL_SERVICIO = /\bque servicios?\b/;
const PREGUNTA_A_DONDE = /\ba donde te (lo|la|los|las) (enviamos|mandamos)\b/;

/**
 * ¿Hay que cerrar pidiendo apartar? Solo si dio la ciudad y nada lo impide: a una ciudad sin envio
 * asegurado, a quien ya compro, no le interesa o pidio contraentrega no se le exige (si se exigiera,
 * esos chats perderian todas las propuestas).
 */
function tocaElCierre(dicho: LoQueDijoElCliente): dicho is LoQueDijoElCliente & { ciudad: string } {
  return !!dicho.ciudad && !dicho.ciudadSinCobertura && !dicho.yaCompro && !dicho.noLeInteresa && !dicho.pidioContraentrega;
}

/** Los problemas del texto contra lo que el cliente ya dijo (los recibe la IA al reintentar). */
function problemasConLoQueDijo(texto: string, dicho: LoQueDijoElCliente): string[] {
  const problemas: string[] = [];
  const preguntas = preguntasDelTexto(texto);
  const pregunta = (patron: RegExp) => preguntas.some((p) => patron.test(p));

  if (dicho.ciudad && (preguntaLaCiudad(texto) || pregunta(PREGUNTA_A_DONDE))) {
    problemas.push(`vuelve a preguntar la ciudad: el cliente ya dijo que es ${dicho.ciudad}`);
  }
  if (dicho.color && pregunta(PREGUNTA_EL_COLOR)) {
    problemas.push(`vuelve a preguntar el color: el cliente ya dijo ${dicho.color}`);
  }
  if (dicho.fecha && pregunta(PREGUNTA_LA_FECHA)) {
    problemas.push(`vuelve a preguntar para cuándo lo necesita: el cliente ya dijo «${dicho.fecha}»`);
  }
  if (dicho.servicio && pregunta(PREGUNTA_EL_SERVICIO)) {
    problemas.push(`vuelve a preguntar el servicio: el cliente ya dijo ${dicho.servicio}`);
  }

  if (tocaElCierre(dicho)) {
    const ciudad = escaparRegex(normalizar(dicho.ciudad));
    if (!new RegExp(`(^| )${ciudad}( |$)`).test(normalizar(texto))) {
      problemas.push(`el cliente ya dijo la ciudad (${dicho.ciudad}): nómbrala en el mensaje`);
    }
    const ultima = preguntas.at(-1);
    if (!ultima || !PIDE_APARTAR.test(ultima)) {
      problemas.push(
        `el cliente ya dijo la ciudad (${dicho.ciudad}): termina pidiendo apartar, por ejemplo «${cierreDeApartar(dicho.ciudad)}»`,
      );
    }
  }

  if ((dicho.yaCompro || dicho.noLeInteresa) && pregunta(PIDE_APARTAR)) {
    problemas.push(
      dicho.yaCompro ? "el cliente ya confirmó la compra: no le pidas apartar" : "el cliente dijo que no le interesa: no le pidas apartar",
    );
  }
  return problemas;
}

/**
 * El cierre fijo para quien ya dio la ciudad: si la IA no da un texto que pase, sale este. Sin promesa
 * de llegada ni de pago (6-nov-2026): antes decia "A {ciudad} te llega sin problema 🚚 ¿Te lo aparto
 * con el 50 %...?", justo lo que un seguimiento automatico no puede prometer.
 */
export function cierreDeApartar(ciudad: string): string {
  return `Anotado para ${ciudad} 🙌 ¿Te lo aparto para empezar a fabricarlo?`;
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

/* ----------------------------------------------------------------------------------------------
   Lo que el cliente ya dijo: para que el seguimiento no le vuelva a preguntar la ciudad, el color o
   para cuando lo necesita. Se mira TODA la conversacion (no solo las ultimas 30 lineas).
---------------------------------------------------------------------------------------------- */

export type LoQueDijoElCliente = {
  /** La ciudad, como esta en la lista de ciudades ("Bogotá"). */
  ciudad: string | null;
  /** La ciudad es una a la que no hay envio asegurado (San Andrés, Leticia, Inírida, Mitú). */
  ciudadSinCobertura: boolean;
  color: string | null;
  /** Para cuando lo necesita, como lo dijo (sin tildes): "para el viernes". */
  fecha: string | null;
  /** El servicio o negocio del cliente: "uñas", "barbería"... */
  servicio: string | null;
  yaCompro: boolean;
  noLeInteresa: boolean;
  pidioContraentrega: boolean;
};

/** Ciudades a las que no se le puede decir "te llega". */
const CIUDADES_SIN_COBERTURA = ["san andres", "leticia", "inirida", "mitu"];

/**
 * Ciudades que tambien son palabras o nombres comunes ("muy bello", "Soledad", "un turbo"): solo
 * cuentan si van con "soy de", "en", "para", "desde"... o con el departamento.
 */
const CIUDADES_AMBIGUAS = [
  "bello",
  "soledad",
  "florencia",
  "fundacion",
  "candelaria",
  "turbo",
  "la estrella",
  "pasto",
  "garzon",
];
const ANTES_DE_LA_CIUDAD =
  "soy de|somos de|vivo en|vivimos en|estoy en|estamos en|queda en|desde|para|en|a|hasta|ciudad de|municipio de";
const DEPARTAMENTOS = "antioquia|atlantico|caqueta|magdalena|valle|cauca|narino|huila|tolima";

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** ¿La ciudad ambigua aparece como ciudad ("soy de Bello", "para Bello Antioquia")? */
function ciudadConContexto(textoNormal: string, ciudadNormal: string): boolean {
  const c = escaparRegex(ciudadNormal);
  return (
    new RegExp(`(^| )(${ANTES_DE_LA_CIUDAD}) (la )?${c}( |$)`).test(textoNormal) ||
    new RegExp(`(^| )${c} (${DEPARTAMENTOS})( |$)`).test(textoNormal)
  );
}

/** "Cali" cuando el cliente pregunta donde queda el negocio ("¿están en Cali?", "la tienda en Cali"). */
const CALI_DEL_NEGOCIO =
  /\b(estan|ustedes|quedan|son|tienda|local|almacen|bodega|fabrica|sede|showroom|direccion|ubicados|ubicacion|voy|vamos|paso|pasar|ir)\b( \w+){0,2} (en|de|a|para|por) cali\b/;

/** Una sola linea del cliente: la ciudad que nombra, o null. Si la hallada no cuenta, sigue buscando. */
function ciudadDeLaLinea(linea: Linea): string | null {
  let texto = linea.texto;
  for (let intento = 0; intento < 6; intento += 1) {
    const turno: TurnoDelChat = { direction: "INBOUND", type: "TEXT", content: texto, createdAt: linea.en };
    const hallada = buscarPorReglas([turno]).city?.valor;
    if (!hallada) return null;
    const ciudadNormal = normalizar(hallada);
    const textoNormal = normalizar(texto);
    const descartada =
      (CIUDADES_AMBIGUAS.includes(ciudadNormal) && !ciudadConContexto(textoNormal, ciudadNormal)) ||
      (ciudadNormal === "cali" && CALI_DEL_NEGOCIO.test(textoNormal));
    if (!descartada) return hallada;
    // Se borra esa ciudad del texto y se busca otra en la misma linea ("muy bello, soy de Bogotá").
    texto = textoNormal.replace(new RegExp(`(^| )${escaparRegex(ciudadNormal)}(?= |$)`, "g"), " ");
  }
  return null;
}

/** Colores, del mas largo al mas corto: "palo rosa" antes que "rosa". */
const COLORES = [
  "palo rosa",
  "vino tinto",
  "vinotinto",
  "azul rey",
  "azul oscuro",
  "verde menta",
  "verde oliva",
  "gris oscuro",
  "gris claro",
  "beige",
  "negro",
  "negra",
  "blanco",
  "blanca",
  "gris",
  "cafe",
  "marron",
  "chocolate",
  "rosado",
  "rosada",
  "rosa",
  "rojo",
  "roja",
  "azul",
  "verde",
  "amarillo",
  "amarilla",
  "mostaza",
  "morado",
  "morada",
  "lila",
  "fucsia",
  "dorado",
  "dorada",
  "plateado",
  "plateada",
  "crema",
  "hueso",
  "terracota",
  "naranja",
  "turquesa",
  "nude",
];

function colorDelTexto(textoNormal: string): string | null {
  return COLORES.find((c) => new RegExp(`(^| )${c}( |$)`).test(textoNormal)) ?? null;
}

const DIA_O_MES = `(${[...DIAS, ...MESES].join("|")})`;
/** Para cuando lo necesita: "para el viernes", "para diciembre", "lo necesito para...". */
const PATRONES_DE_FECHA = [
  /\b(lo|la|los|las) (necesito|necesitamos) (para|antes de(l)?) ((?:\S+ ?){1,4})/,
  new RegExp(`\\b(para|antes del?|el proximo|este) (el )?(\\d{1,2} de )?${DIA_O_MES}\\b`),
  /\bpara (navidad|fin de ano|fin de mes|la quincena|la otra semana|la proxima semana|esta semana|este fin de semana|el fin de semana|manana|pasado manana|ya)\b/,
];

function fechaDelTexto(textoNormal: string): string | null {
  for (const patron of PATRONES_DE_FECHA) {
    const m = patron.exec(textoNormal);
    if (m) return m[0].trim();
  }
  return null;
}

/** El servicio o negocio del cliente. "uñas" se busca con la ñ: sin ella es "unas" (unas sillas). */
const SERVICIOS: { nombre: string; patron: RegExp; conEnie?: boolean }[] = [
  { nombre: "uñas", patron: /uñas|\bmanicur|\bpedicur|\bnail/, conEnie: true },
  { nombre: "barbería", patron: /\bbarber/ },
  { nombre: "peluquería", patron: /\b(peluquer|estilista|salon de belleza)/ },
  { nombre: "spa", patron: /\bspa\b/ },
  { nombre: "pestañas", patron: /\b(pestanas|cejas|lashes)\b/ },
  { nombre: "masajes", patron: /\b(masaje|masajes|masajista|masoterapia)\b/ },
  { nombre: "estética", patron: /\b(estetica|cosmetolog\w*|facial|faciales)\b/ },
  { nombre: "depilación", patron: /\bdepila/ },
  { nombre: "tatuajes", patron: /\b(tatuaje|tatuajes|tattoo)/ },
  { nombre: "maquillaje", patron: /\bmaquilla/ },
  { nombre: "podología", patron: /\bpodolog/ },
];

function servicioDelTexto(texto: string, textoNormal: string): string | null {
  const minusculas = texto.toLowerCase();
  return SERVICIOS.find((s) => s.patron.test(s.conEnie ? `${minusculas} ${textoNormal}` : textoNormal))?.nombre ?? null;
}

/** Frases de "no me interesa" (cada frase del mensaje por separado: "no me interesa el negro" no cuenta). */
const NO_LE_INTERESA = [
  /^(ya )?no me interesa(n)?( (mas|por ahora|gracias|eso|ya))*$/,
  /^(no|ya no) (estoy|estamos) interesad[oa]s?( (por ahora|gracias))*$/,
  /^no( muchas)? gracias$/,
  /^(por ahora|de momento|por el momento) no( gracias)?$/,
  /^no por (ahora|el momento)( gracias)?$/,
  /\bya no (lo|la|los|las) (necesito|quiero|voy a comprar)\b/,
  /\bya (lo |la )?(compre|consegui) en otr[oa] (lado|parte|tienda|lugar)\b/,
  /\bno me (escribas|escriban|vuelvas a escribir|vuelvan a escribir)\b/,
  /\b(dejemoslo|dejalo|dejemos) (asi|para otra ocasion)\b/,
];

function dijoQueNoLeInteresa(texto: string): boolean {
  // Sin la marca del principio ("[nota de voz] No me interesa"): las frases van ancladas.
  return texto
    .replace(/^\s*\[[^\]]*\]\s*/, "")
    .split(/[.!?¿¡,;\n]+/)
    .map((frase) => normalizar(frase))
    .filter(Boolean)
    .some((frase) => NO_LE_INTERESA.some((patron) => patron.test(frase)));
}

const CONTRAENTREGA = /\b(contraentrega|contra entrega|pago al recibir|pagar al recibir|pago cuando (me )?llegue|pagar cuando (me )?llegue|pago en casa|pagar en casa)\b/;

function tipoDeLaLinea(texto: string): string {
  const inicio = texto.trimStart().toLowerCase();
  if (inicio.startsWith("[foto]")) return "IMAGE";
  if (inicio.startsWith("[documento]")) return "DOCUMENT";
  return "TEXT";
}

/**
 * Lo que el cliente ya dijo en TODA la conversacion (sin recorte de lineas): ciudad, color, para
 * cuando, servicio y si ya compro, no le interesa o pidio contraentrega. Codigo puro: el "ahora" es
 * la hora de la ultima linea, no el reloj, para que el resultado no cambie con el tiempo.
 * Las notas de voz ya llegan transcritas en el texto ("[nota de voz] ...").
 */
export function loQueDijoElCliente(lineas: Linea[]): LoQueDijoElCliente {
  const delCliente = lineas.filter((l) => l.de === "cliente" && l.texto?.trim());
  const resultado: LoQueDijoElCliente = {
    ciudad: null,
    ciudadSinCobertura: false,
    color: null,
    fecha: null,
    servicio: null,
    yaCompro: false,
    noLeInteresa: false,
    pidioContraentrega: false,
  };

  // Del mensaje mas nuevo al mas viejo: si corrigio un dato, vale el ultimo que dijo.
  for (const linea of [...delCliente].reverse()) {
    const textoNormal = normalizar(linea.texto);
    if (!resultado.ciudad) resultado.ciudad = ciudadDeLaLinea(linea);
    if (!resultado.color) resultado.color = colorDelTexto(textoNormal);
    if (!resultado.fecha) resultado.fecha = fechaDelTexto(textoNormal);
    if (!resultado.servicio) resultado.servicio = servicioDelTexto(linea.texto, textoNormal);
    if (!resultado.noLeInteresa) resultado.noLeInteresa = dijoQueNoLeInteresa(linea.texto);
    if (!resultado.pidioContraentrega) resultado.pidioContraentrega = CONTRAENTREGA.test(textoNormal);
  }
  resultado.ciudadSinCobertura = !!resultado.ciudad && CIUDADES_SIN_COBERTURA.includes(normalizar(resultado.ciudad));

  // La confirmacion de compra mira tambien lo nuestro: un "sí" suelto vale si respondio "¿Te lo separo?".
  const ultima = lineas.at(-1);
  if (ultima) {
    const mensajes: MensajeDelChat[] = lineas.map((l) => ({
      direccion: l.de === "cliente" ? "IN" : "OUT",
      tipo: tipoDeLaLinea(l.texto ?? ""),
      texto: l.texto,
      en: l.en,
      origen: null,
    }));
    resultado.yaCompro = clienteConfirmoCompra(mensajes, ultima.en);
  }
  return resultado;
}

/** El bloque del contexto con lo que el cliente ya dijo (una linea por dato hallado). */
function bloqueDeLoQueDijo(dicho: LoQueDijoElCliente): string[] {
  const datos: string[] = [];
  if (dicho.ciudad) {
    datos.push(
      `- Ciudad: ${dicho.ciudad}${dicho.ciudadSinCobertura ? " (no hay envío asegurado a esta ciudad: no le digas que le llega)" : ""}`,
    );
  }
  if (dicho.color) datos.push(`- Color: ${dicho.color}`);
  if (dicho.fecha) datos.push(`- Para cuándo lo necesita: ${dicho.fecha}`);
  if (dicho.servicio) datos.push(`- Su servicio o negocio: ${dicho.servicio}`);
  if (dicho.yaCompro) datos.push("- Ya confirmó la compra o el pago: no le pidas apartar");
  if (dicho.noLeInteresa) datos.push("- Dijo que no le interesa: no le pidas apartar");
  if (dicho.pidioContraentrega) datos.push("- Preguntó por el pago contraentrega");
  return ["LO QUE EL CLIENTE YA DIJO (no lo vuelvas a preguntar):", ...(datos.length ? datos : ["(nada todavía)"])];
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
    "Trae algo nuevo o útil para él (un dato del producto que esté en los DATOS DEL NEGOCIO); no repitas lo que ya le dijimos.",
    "Cierra con UNA sola pregunta fácil de contestar (de sí o no, o de elegir entre dos), al final del mensaje.",
    `Máximo ${LINEAS_MAXIMAS} líneas y unas 35 palabras.`,
    "No inventes precios, cifras ni fechas: solo puedes usar los que estén en la conversación o en los DATOS DEL NEGOCIO.",
    'Nunca escribas "pero" (usa "sin embargo"), "¿sigues interesada?", "cuando puedas me avisas", "¿pudiste ver lo que te envié?", "aquí estoy para ayudarte" ni "si te queda alguna duda". No trates de usted.',
    "No repitas ni parafrasees los SEGUIMIENTOS YA ENVIADOS.",
    "Nunca preguntes lo que el cliente ya respondió (mira LO QUE EL CLIENTE YA DIJO): ni la ciudad, ni para cuándo lo necesita, ni el color, ni su servicio o negocio.",
    `Si ya dio la ciudad, nómbrala y termina pidiendo apartar. Por ejemplo, si dijo Bogotá: "${cierreDeApartar("Bogotá")}"`,
    "Menciona algo concreto que dijo el cliente, no un mensaje genérico.",
    // 6-nov-2026 (chat 8927): las condiciones de envio y pago las da la asesora o el bot al responder.
    'No hables del envío ni de su valor, ni digas "gratis" o "sin costo", ni a qué ciudades llega ni "te llega", ni de contraentrega, ni de formas de pago, anticipo o el 50 %.',
    "No inventes nada: ni productos, ni colores, ni condiciones que no estén en la conversación o en los DATOS DEL NEGOCIO.",
    "Si el cliente ya separó, ya pagó o dijo que no le interesa, no le pidas apartar.",
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
    // De TODA la conversacion: lo de mas de 30 lineas atras no esta abajo, pero sigue valiendo.
    ...bloqueDeLoQueDijo(loQueDijoElCliente(input.lineas)),
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
      origen: "ia" | "cierre" | "fijo" | "producto";
      /** Lo que se descarto antes, con sus problemas (para el registro). */
      descartados: { texto: string; problemas: string[] }[];
    }
  | { enviar: false; motivo: string; descartados: { texto: string; problemas: string[] }[] };

/**
 * Decide que seguimiento sale, en orden: la primera propuesta de la IA que pase la revision (hasta 3
 * intentos); si ninguna pasa y el cliente ya dio la ciudad, el cierre de apartar (no si la ciudad no
 * tiene cobertura, ya compro, no le interesa o pidio contraentrega; y tambien pasa por la revision:
 * si ya se le mando, sigue); despues el texto fijo, solo si tambien pasa; si no, la pregunta del
 * producto del anuncio; si no hay producto, no se manda nada.
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
    producto: input.producto,
    textoAgendado: input.textoAgendado ?? input.textoFijo,
  };

  for (const propuesta of input.propuestas.slice(0, INTENTOS_MAXIMOS)) {
    const problemas = revisarSeguimiento(propuesta, revision);
    if (!problemas.length) return { enviar: true, texto: propuesta.trim(), origen: "ia", descartados };
    descartados.push({ texto: propuesta, problemas });
  }

  const dicho = loQueDijoElCliente(input.conversacion);
  if (tocaElCierre(dicho)) {
    const cierre = cierreDeApartar(dicho.ciudad);
    const problemas = revisarSeguimiento(cierre, revision);
    if (!problemas.length) return { enviar: true, texto: cierre, origen: "cierre", descartados };
    descartados.push({ texto: cierre, problemas });
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
