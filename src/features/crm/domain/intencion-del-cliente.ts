/**
 * QUÉ QUIERE EL CLIENTE, LEYENDO SU MENSAJE (código puro, sin base ni IA). Decisión del dueño, 23-oct-2026.
 *
 * Las asesoras no siempre ponen la etapa, y sin etapa el embudo, "Mi día" y los informes mienten. Con
 * cada mensaje del cliente el sistema decide una de cuatro cosas:
 *  - CALIENTE (Negociación): pregunta cómo pagar, pide datos para consignar, pide el total, elige color,
 *    dice su ciudad para el envío o manda sus datos.
 *  - TIBIO (Propuesta): lo deja para después ("más adelante", "lo pienso", "te confirmo", "voy en
 *    noviembre"). Lleva una fecha de recontacto: la que dijo el cliente o 3 días.
 *  - DESCARTADO (Perdido): SOLO con una frase clara (no le interesa, ya compró en otro lado, se
 *    equivocó de número, que no le escriban más).
 *  - nada.
 *
 * ANTE LA DUDA, TIBIO Y NUNCA DESCARTADO. Caso real: una clienta dijo "voy a Bogotá en noviembre" y la
 * descartaron. Una frase de descarte con cualquier otra cosa al lado (una pregunta, una fecha, "por ahora",
 * una señal de compra) ya no es clara: va a Tibio.
 *
 * Reutiliza los detectores que el CRM ya tiene: señales del embudo, fecha futura, compromisos, "dice que
 * espera" y la fecha de retomar de la pausa acordada (la misma con la que el seguimiento le escribe).
 */

import { mandoSusDatos } from "../../../lib/turno-de-la-conversacion";
import { normalizarParaCierre } from "../../../lib/cierre-de-conversacion";
import { detectarSenales } from "../../embudo/dominio/senales";
import { detectarFechaFutura } from "../../seguimiento-inteligente/dominio/fecha-futura";
import { compromisoEnTexto, esAcuseDelCliente } from "../../seguimiento-inteligente/dominio/compromiso";
import { siguienteHoraLaboral } from "../../seguimiento-inteligente/dominio/formulario";
import { colorElegido } from "../../seguimiento-inteligente/dominio/temperatura";
import { DIAS_POR_DEFECTO, HORARIO_DE_PAUSA, diceQueEspera } from "../../supervisor/dominio/pausa-acordada";

export type Intencion = "CALIENTE" | "TIBIO" | "DESCARTADO";

export type MotivoDeDescarte = "no_le_interesa" | "compro_en_otro_lado" | "numero_equivocado" | "no_quiere_que_le_escriban";

/**
 * El motivo de pérdida que se guarda en Contact.lostReason. "Compró en otro lado" ya está en la lista;
 * los demás van como "Otro: ..." para no cambiar la lista que eligen las asesoras.
 */
export const MOTIVOS_DE_DESCARTE: Record<MotivoDeDescarte, { etiqueta: string; lostReason: string }> = {
  no_le_interesa: { etiqueta: "No le interesa", lostReason: "otro: No le interesa" },
  compro_en_otro_lado: { etiqueta: "Compró en otro lado", lostReason: "compro_competencia" },
  numero_equivocado: { etiqueta: "Número equivocado", lostReason: "otro: Número equivocado" },
  no_quiere_que_le_escriban: { etiqueta: "No quiere que le escriban", lostReason: "otro: No quiere que le escriban" },
};

export type LecturaDelMensaje = {
  intencion: Intencion;
  /** Para la nota del chat: "el cliente preguntó cómo pagar". */
  porque: string;
  /** Solo en DESCARTADO. */
  descarte?: MotivoDeDescarte;
};

const MAXIMO = 600;

/** El texto original, recortado y en una línea (la frase exacta que se guarda y se muestra). */
export function fraseDelCliente(texto: string | null | undefined, maximo = 160): string {
  const t = (texto ?? "").replace(/\s+/g, " ").trim();
  return t.length <= maximo ? t : `${t.slice(0, maximo - 1).trimEnd()}…`;
}

/* ---------------------------------------------------------------------------------------------- */
/* DESCARTADO: solo frases claras, por oración, y sin nada más alrededor. */

/** Palabras de relleno que pueden ir antes o después de la frase de descarte sin cambiarla. */
const RELLENO = "(?:no|ya|ok|okey|bueno|listo|pero|la verdad|disculpa|disculpe|disculpen|perdon|gracias|muchas gracias|mil gracias|no gracias|que pena|hola|buenas|buenos dias|buenas tardes|buenas noches|senora|senor|senorita|amiga|igual|de todas formas|de todos modos|por favor|porfa|ya no|y)";
const ANTES = `^(?:${RELLENO} )*`;
const DESPUES = `(?: ${RELLENO})*$`;

const DESCARTES: Array<{ motivo: MotivoDeDescarte; re: RegExp }> = [
  {
    motivo: "no_le_interesa",
    re: new RegExp(`${ANTES}(?:ya )?no (?:me|nos) interesa(?:n)?(?: (?:mas|nada|para nada|el producto|la camilla|eso))?${DESPUES}`),
  },
  {
    motivo: "no_le_interesa",
    re: new RegExp(`${ANTES}(?:ya )?no (?:estoy|estamos) interesad[oa]s?${DESPUES}`),
  },
  {
    motivo: "compro_en_otro_lado",
    re: new RegExp(
      `${ANTES}ya (?:lo |la |los |las )?(?:compre|compramos|consegui|conseguimos|adquiri)(?: (?:en otro lado|en otra parte|en otro lugar|en otro sitio|en otra tienda|a otra persona|a otra empresa|a otro proveedor|con otra persona|con otra empresa|con otro proveedor|por otro lado|alla))?${DESPUES}`,
    ),
  },
  {
    motivo: "numero_equivocado",
    re: /\b(me equivoque de (numero|chat|contacto)|numero equivocado|equivocad[oa] de numero|se equivocaron de numero|te equivocaste de numero|escribi (por error|por equivocacion|equivocad[oa]))\b/,
  },
];
// "No me escriban más" tiene su propia regla, más estricta, abajo.

/** "No me escriban más": con "más", "nunca" o pidiendo que lo borren. "No me escriban hoy" no cuenta. */
const NO_ESCRIBIR =
  /\b(no me (vuelvan|vuelvas|vuelva) a escribir|no me (escriban|escribas|escriba|manden|mandes|envien) mas|no me (sigan|sigas|siga) escribiendo|dejen de (escribirme|molestarme)|deja de (escribirme|molestarme)|no (sigan|siga|sigas) (escribiendo|molestando)|no me (molesten|molestes|moleste) mas|borr(en|a|ame|enme|eme) (mi numero|de (su|la|tu) lista|de sus contactos)|no quiero (que me (escriban|sigan escribiendo)|recibir mas (mensajes|informacion))|no me interesa que me escriban)\b/;

/** Algo que hace dudar: una fecha o un "por ahora". Con esto ya no es un descarte claro. */
const DUDA = /\b(por ahora|por el momento|en este momento|todavia|aun|ahorita|hoy|manana|despues|luego|mas adelante|cuando|hasta|semana|mes|ano|lunes|martes|miercoles|jueves|viernes|sabado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|quincena|prima|llam\w*|por aqui|por aca|por este|por whatsapp)\b/;

/** Habla de comprarnos A NOSOTROS o de un pago: "ya compré" ahí NO es que compró en otro lado. */
const CON_NOSOTROS = /\b(ustedes|con usted|a usted|con ud|aqui|aca|les compre|te compre|le compre|comprobante|pague|consigne|transferi|abone|pedido|envio|llega|llego)\b/;

const SOLO_RELLENO = new RegExp(`^${RELLENO}(?: ${RELLENO})*$`);

function oraciones(texto: string): string[] {
  return texto
    .split(/[.!;,\n]+/)
    .map((o) => normalizarParaCierre(o))
    .filter(Boolean);
}

/** El motivo del descarte si el mensaje es una frase CLARA de descarte, o null. */
export function descarteClaro(texto: string | null | undefined): MotivoDeDescarte | null {
  const original = (texto ?? "").slice(0, MAXIMO);
  if (!original.trim() || /[?¿]/.test(original)) return null;
  const limpio = normalizarParaCierre(original);
  if (!limpio || DUDA.test(limpio) || CON_NOSOTROS.test(limpio)) return null;
  // Con una señal de compra al lado ("no me interesa el negro, quiero el blanco") no es descarte.
  if (hayCompra(original)) return null;
  if (NO_ESCRIBIR.test(limpio)) return "no_quiere_que_le_escriban";
  const partes = oraciones(original);
  let motivo: MotivoDeDescarte | null = null;
  for (const parte of partes) {
    const encontrado = DESCARTES.find((d) => d.re.test(parte));
    if (encontrado) {
      motivo ??= encontrado.motivo;
      continue;
    }
    // Cualquier otra oración que no sea relleno o cortesía ya no deja el descarte claro.
    if (!SOLO_RELLENO.test(parte) &&!esAcuseDelCliente({ tipo: "TEXT", texto: parte })) return null;
  }
  return motivo;
}

/* ---------------------------------------------------------------------------------------------- */
/* CALIENTE. */

const CIUDAD =
  /\b((soy|somos|vivo|vivimos) (de|en)|mi ciudad es|la ciudad es|(enviar|enviarlo|enviarla|envio|envia|envian|mandar|mandarlo|mandarla|despachar|despacharlo|despacharla|despacho|llega|llegan|llegaria|entregan) (a|para|hasta)|para (la ciudad de|el municipio de)) (?!(cuando|donde|tiempo|domicilio|casa|la casa|mi casa|la oficina|que|cual|ustedes|usted)\b)[a-z]{4,}/;
const TOTAL = /\btotal\b/;
const PIDE = /\b(cuanto|cual|seria|serian|queda|quedaria|sale|saldria|dame|deme|pasame|paseme|regalame|regaleme|dime|digame|mandame|enviame|me (dices|dice|das|da|pasas|pasa|regalas|regala|mandas|manda))\b/;
const CUANTO_TODO = /\bcuanto (seria|es|queda|quedaria|me sale|sale|me queda) (todo|en total|con (el )?envio)\b/;
const DATOS_PARA_CONSIGNAR =
  /\b(datos (para|de) (consignar|pagar|transferir|la consignacion|la transferencia|pago)|a (que|cual) (cuenta|numero) (le |te |les )?(consigno|transfiero|pago|deposito|envio)|(numero|datos) de (la )?cuenta|datos bancarios|llave( bre-?b)?)\b/;

function hayCompra(texto: string): boolean {
  return Boolean(porQueCaliente(texto));
}

/** Por qué el mensaje es Caliente ("el cliente preguntó cómo pagar"), o null. */
export function porQueCaliente(texto: string | null | undefined): string | null {
  const original = (texto ?? "").slice(0, MAXIMO);
  if (!original.trim()) return null;
  const limpio = normalizarParaCierre(original);
  const tipos = new Set(detectarSenales(original).map((s) => s.tipo));
  if (tipos.has("comprobante")) return "el cliente mandó el comprobante";
  if (DATOS_PARA_CONSIGNAR.test(limpio)) return "el cliente pidió los datos para consignar";
  if (tipos.has("anticipo_pago")) return "el cliente preguntó cómo consignar";
  if (tipos.has("forma_pago")) return "el cliente preguntó cómo pagar";
  if (tipos.has("separar")) return "el cliente quiere separar";
  if (mandoSusDatos(original)) return "el cliente mandó sus datos";
  if ((TOTAL.test(limpio) && PIDE.test(limpio)) || CUANTO_TODO.test(limpio)) return "el cliente pidió el total";
  if (colorElegido(original)) return "el cliente eligió color";
  if (tipos.has("acepta_precio")) return "el cliente dijo que lo quiere";
  if (tipos.has("direccion_fecha")) return "el cliente mandó su dirección";
  if (CIUDAD.test(limpio)) return "el cliente dijo su ciudad para el envío";
  return null;
}

/* ---------------------------------------------------------------------------------------------- */
/* TIBIO. */

const LO_DEJA_PARA_DESPUES =
  /\b(mas adelante|mas adelantico|lo (voy a )?pienso|lo pensare|lo voy a pensar|voy a pensarlo|dejame pensarlo|dejeme pensarlo|lo pensamos|lo consulto|lo voy a consultar|me organizo|me organice|cuando me organice|me estoy organizando|(te|le|les) confirmo|(te|le|les) aviso|(te|le|les) escribo (luego|despues|mas tarde|en estos dias)|por ahora no|por el momento no|ahora no puedo|todavia no|aun no|solo (estoy )?(mirando|averiguando|preguntando|cotizando|curioseando)|lo tengo en cuenta|lo tendre en cuenta|despues (te|le) (escribo|confirmo|aviso)|no gracias|muy caro|muy cara|esta caro|esta cara|no me alcanza|fuera de mi presupuesto)\b/;

/** "en noviembre" → "noviembre"; "en 2 semanas" → "dentro de 2 semanas". */
function paraCuando(como: string): string {
  if (/^en \S+$/.test(como)) return como.slice(3);
  return como.startsWith("en ") ? `dentro de ${como.slice(3)}` : como;
}

/** Por qué el mensaje es Tibio ("el cliente lo deja para en noviembre"), o null. */
export function porQueTibio(texto: string | null | undefined, cuando: Date): string | null {
  const original = (texto ?? "").slice(0, MAXIMO);
  if (!original.trim()) return null;
  const futura = detectarFechaFutura(original, cuando);
  if (futura) return `el cliente lo deja para ${paraCuando(futura.como)}`;
  const limpio = normalizarParaCierre(original);
  if (LO_DEJA_PARA_DESPUES.test(limpio) || diceQueEspera(original)) return "el cliente lo deja para después";
  const tipos = new Set(detectarSenales(original).map((s) => s.tipo));
  // Señales negativas sueltas que no son un descarte claro: ante la duda, Tibio. "Ya compré con ustedes"
  // no es una señal negativa.
  if (CON_NOSOTROS.test(limpio)) return null;
  if (tipos.has("solo_mirando") || tipos.has("muy_caro") || tipos.has("no_interesa")) return "el cliente no está decidido";
  return null;
}

/* ---------------------------------------------------------------------------------------------- */

/**
 * La lectura por frases del mensaje, o null si ninguna frase coincide (ahí decide la IA).
 *
 * Orden: Descartado claro → lo deja para después (Tibio gana a la compra: "lo compro en noviembre" es
 * noviembre) → Caliente → señales negativas sueltas (Tibio).
 */
export function leerIntencionPorFrase(texto: string | null | undefined, cuando: Date): LecturaDelMensaje | null {
  const original = (texto ?? "").slice(0, MAXIMO);
  if (!original.trim()) return null;
  const descarte = descarteClaro(original);
  if (descarte) {
    return { intencion: "DESCARTADO", descarte, porque: `el cliente dijo: «${fraseDelCliente(original)}»` };
  }
  const futura = detectarFechaFutura(original, cuando);
  const limpio = normalizarParaCierre(original);
  if (futura || LO_DEJA_PARA_DESPUES.test(limpio) || diceQueEspera(original)) {
    return { intencion: "TIBIO", porque: porQueTibio(original, cuando) ?? "el cliente lo deja para después" };
  }
  const caliente = porQueCaliente(original);
  if (caliente) return { intencion: "CALIENTE", porque: caliente };
  const tibio = porQueTibio(original, cuando);
  if (tibio) return { intencion: "TIBIO", porque: tibio };
  return null;
}

/**
 * ¿Vale la pena preguntarle a la IA? No para mensajes vacíos, de una o dos palabras, ni para acuses
 * ("ok", "gracias", un sticker): ahí no hay intención que leer y sería gasto.
 */
export function vaALaIA(texto: string | null | undefined): boolean {
  const original = (texto ?? "").trim();
  if (!original) return false;
  if (esAcuseDelCliente({ tipo: "TEXT", texto: original })) return false;
  const palabras = normalizarParaCierre(original).split(" ").filter(Boolean);
  return palabras.length >= 3;
}

/** La respuesta de la IA, en una intención. La IA NUNCA descarta: solo Caliente, Tibio o nada. */
export function interpretarRespuestaDeLaIA(crudo: string | null | undefined): "CALIENTE" | "TIBIO" | null {
  const t = normalizarParaCierre(crudo ?? "");
  if (/^caliente\b/.test(t)) return "CALIENTE";
  // Cualquier intento de "descartado" o "frío" de la IA se lee como duda: Tibio.
  if (/^(tibio|descartado|descartar|perdido|frio)\b/.test(t)) return "TIBIO";
  return null;
}

/**
 * Cuándo volver a escribirle a un Tibio: la fecha que dijo ("en noviembre", "el lunes", "la otra
 * semana") o 3 días, en horario laboral. Es la misma cuenta de la pausa acordada del seguimiento.
 */
export function fechaDeRecontacto(texto: string | null | undefined, cuando: Date): { fecha: Date; como: string } {
  const original = (texto ?? "").slice(0, MAXIMO);
  const futura = detectarFechaFutura(original, cuando);
  if (futura) return { fecha: siguienteHoraLaboral(futura.fecha, HORARIO_DE_PAUSA), como: futura.como };
  const compromiso = compromisoEnTexto(original);
  if (compromiso?.momento && !compromiso.momento.ambiguo) {
    const fecha = compromiso.momento.cuando(cuando, HORARIO_DE_PAUSA);
    if (fecha.getTime() > cuando.getTime()) return { fecha: siguienteHoraLaboral(fecha, HORARIO_DE_PAUSA), como: compromiso.momento.como };
  }
  const fecha = new Date(cuando.getTime() + DIAS_POR_DEFECTO * 86_400_000);
  return { fecha: siguienteHoraLaboral(fecha, HORARIO_DE_PAUSA), como: `${DIAS_POR_DEFECTO} días` };
}
