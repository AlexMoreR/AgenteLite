/**
 * INTENCIÓN DEL CLIENTE en lo que escribe (código puro, sin base de datos ni IA).
 *
 * Decisión del dueño (23-oct-2026): el sistema pone la etapa del chat solo leyendo lo que dice el
 * cliente, aunque las asesoras no lo hagan. Complementa a la etapa automática de asignar/cotizar
 * (src/lib/etapa-automatica-crm.ts): aquí lo que mueve la etapa es el TEXTO del cliente.
 *
 *  - CALIENTE (NEGOCIACION): pregunta cómo pagar, dice su ciudad para el envío, pide el total,
 *    elige color, pide los datos para consignar o manda sus datos.
 *  - TIBIO (PROPUESTA): "más adelante", "lo pienso", "me organizo", "te confirmo", "voy en noviembre".
 *    Lleva una fecha de recontacto: la que dice el cliente, o 3 días.
 *  - DESCARTADO (PERDIDO): SOLO con una frase clara (no le interesa, ya compró en otro lado, número
 *    equivocado, que no le escriban más). Nunca sale de la IA. Ante cualquier duda, Tibio.
 *
 * Caso real que dio la regla "ante la duda, Tibio": una clienta dijo "voy a Bogotá en noviembre" y
 * la descartaron por error.
 */

import { detectarFechaFutura } from "@/features/seguimiento-inteligente/dominio/fecha-futura";
import { normalizarConservando } from "@/features/embudo/dominio/senales";
import type { CrmStage } from "@/features/crm/types";

export type EtapaPorLectura = "NEGOCIACION" | "PROPUESTA" | "PERDIDO";
export type MetodoDeLectura = "frase" | "ia";

export type Recontacto = {
  fecha: Date;
  /** true si el cliente dijo la fecha; false si es la de por defecto (3 días). */
  explicito: boolean;
};

export type IntencionDelCliente = {
  etapa: EtapaPorLectura;
  metodo: MetodoDeLectura;
  /** En palabras, para la nota del chat: "el cliente preguntó cómo pagar". */
  razon: string;
  /** Solo Tibio: cuándo volver a escribirle. */
  recontacto?: Recontacto;
  /** Solo Descartado: el motivo (Contact.lostReason) y la frase exacta del cliente. */
  motivoDePerdida?: string;
  frase?: string;
};

export const DIAS_DE_RECONTACTO_POR_DEFECTO = 3;
/** Una persona movió la etapa a mano hace menos de esto: el sistema no la toca. */
export const HORAS_DE_RESPETO_A_LA_PERSONA = 24;

const DIA_MS = 86_400_000;
const DESFASE_BOGOTA_MS = -5 * 3_600_000;

/** Orden en que el sistema avanza una etapa. Ganado y Perdido no están: los cierra una persona. */
const ORDEN: CrmStage[] = ["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION"];

export const ETIQUETA_DE_ETAPA: Record<EtapaPorLectura, string> = {
  NEGOCIACION: "Caliente",
  PROPUESTA: "Tibio",
  PERDIDO: "Descartado",
};

/** Motivos de pérdida que escribe el sistema (los de la lista de CRM_LOST_REASONS o los nuevos de solo lectura). */
export const MOTIVOS_DE_DESCARTE = {
  compro: "compro_competencia",
  noInteresa: "no_le_interesa",
  numeroEquivocado: "numero_equivocado",
  noEscribir: "no_quiere_mensajes",
} as const;

function normal(texto: string): string {
  return normalizarConservando(texto).replace(/\s+/g, " ").trim();
}

function fechaBogota(anio: number, mes0: number, dia: number): Date {
  return new Date(Date.UTC(anio, mes0, dia, 9, 0, 0) - DESFASE_BOGOTA_MS);
}

/** Las 9:00 (Bogotá) de dentro de `dias` días contados desde `desde`. */
function enDias(desde: Date, dias: number): Date {
  const local = new Date(desde.getTime() + DESFASE_BOGOTA_MS + dias * DIA_MS);
  return fechaBogota(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
}

const DIAS_DE_LA_SEMANA = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

/** La próxima vez (mañana o después) que cae ese día de la semana. */
function proximoDiaDeLaSemana(dia: number, desde: Date): Date {
  const hoy = new Date(desde.getTime() + DESFASE_BOGOTA_MS).getUTCDay();
  let falta = (dia - hoy + 7) % 7;
  if (falta === 0) falta = 7;
  return enDias(desde, falta);
}

/**
 * Cuándo escribirle de nuevo a un cliente que dijo "más adelante": la fecha que dijo, o 3 días.
 * Las fechas se cuentan desde el momento del mensaje y en hora de Bogotá.
 */
export function fechaDeRecontacto(texto: string, cuando: Date): Recontacto {
  const dicha = detectarFechaFutura(texto, cuando);
  if (dicha) return { fecha: dicha.fecha, explicito: true };
  const t = normal(texto);
  if (/\bpasado manana\b/.test(t)) return { fecha: enDias(cuando, 2), explicito: true };
  if (/\bmanana\b/.test(t)) return { fecha: enDias(cuando, 1), explicito: true };
  if (/\b(mas tarde|esta tarde|en la tarde|en la noche|esta noche|hoy)\b/.test(t)) {
    return { fecha: enDias(cuando, 1), explicito: true };
  }
  if (/\bfin de semana\b|\bfinde\b/.test(t)) return { fecha: proximoDiaDeLaSemana(6, cuando), explicito: true };
  const dia = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.exec(t);
  if (dia) return { fecha: proximoDiaDeLaSemana(DIAS_DE_LA_SEMANA.indexOf(dia[1]), cuando), explicito: true };
  return { fecha: enDias(cuando, DIAS_DE_RECONTACTO_POR_DEFECTO), explicito: false };
}

// ── Descartado: solo con frase clara ────────────────────────────────────────────────────────────

/** Si el mensaje trae alguna de estas, hay duda y NO se descarta (va a Tibio). */
const DUDA = /\?|\b(pero|aunque|mas adelante|despues|luego|pienso|pensar|tal vez|talvez|quizas|quiza|puede que|ahorita|por ahora|en otro momento|todavia|aun no)\b/;

const DESCARTES: Array<{ motivo: string; patrones: RegExp[] }> = [
  {
    motivo: MOTIVOS_DE_DESCARTE.numeroEquivocado,
    patrones: [/\bequivo[cq]\w*( de| el)? numero\b/, /\bnumero equivocado\b/, /\bno es (mi|este) numero\b/],
  },
  {
    motivo: MOTIVOS_DE_DESCARTE.noEscribir,
    patrones: [
      /\bno me (escrib\w*|contact\w*|llam\w*|molest\w*|envi\w*|mand\w*) mas\b/,
      /\bno me vuelv\w+ a (escrib|contact|llam|molest|envi|mand)\w*/,
      /\bdej\w+ de (escribirme|escribir|molestar\w*|contactar\w*|enviar\w*|mandar\w*|llamar\w*)\b/,
      /\bno quiero que me (escrib|contact|llam|molest|envi|mand)\w*/,
      /\b(borr|elimin|saqu)\w+ (me |mi )?(numero|contacto|de (la |su )?lista)\b/,
      /\bdejame en paz\b/,
    ],
  },
  {
    motivo: MOTIVOS_DE_DESCARTE.noInteresa,
    patrones: [/\b(ya )?no me interesa(n)?\b/, /\bno estoy interesad[oa]\b/, /\bno estamos interesad[oa]s\b/],
  },
];

const YA_COMPRO = /\bya (lo |la |los |las )?(compre|adquiri|consegui|encontre)\b/;
const COMPRO_EN_OTRO = /\b(compre|consegui|adquiri)\b.{0,40}\b(en|con|donde|a) (otro|otra|alguien)\b|\bya (lo |la |los |las )?(compre|consegui|adquiri)\b.{0,30}\b(otro|otra|alla|competencia)\b/;

/** Una frase de descarte clara, con su motivo, o null. Ante la menor duda, null. */
export function descarteClaro(texto: string): { motivo: string; razon: string; frase: string } | null {
  const original = (texto ?? "").replace(/\s+/g, " ").trim();
  if (!original) return null;
  const t = normal(original);
  if (DUDA.test(t)) return null;
  const frase = original.slice(0, 200);
  const razon = `el cliente dijo: «${frase}»`;
  for (const { motivo, patrones } of DESCARTES) {
    if (patrones.some((p) => p.test(t))) return { motivo, razon, frase };
  }
  if (COMPRO_EN_OTRO.test(t)) return { motivo: MOTIVOS_DE_DESCARTE.compro, razon, frase };
  // "ya compré" a secas solo cuenta si es un mensaje corto o viene con "no gracias".
  if (YA_COMPRO.test(t) && (/\bno,? gracias\b/.test(t) || t.split(" ").length <= 8)) {
    return { motivo: MOTIVOS_DE_DESCARTE.compro, razon, frase };
  }
  return null;
}

// ── Caliente y Tibio ────────────────────────────────────────────────────────────────────────────

type Frase = { re: RegExp; razon: string };

/** Ya pagó o ya mandó el comprobante: gana sobre un "te aviso". */
const CALIENTE_FUERTE: Frase[] = [
  { re: /\b(ya )?(hice|realice|hicimos) (la |el )?(transferencia|consignacion|pago|abono)\b|\bya (consigne|pague|transferi|abone)\b|\bcomprobante\b/, razon: "el cliente avisó que ya pagó" },
  { re: /\bmi (nombre|cedula|direccion)\b.*\b(cedula|cc|direccion|barrio|calle|carrera|cra|cll)\b|\b(cedula|cc|c\.c\.|documento|nit)\b\D{0,12}\d{6,}/, razon: "el cliente mandó sus datos" },
  { re: /\bdireccion\b.*\b(calle|carrera|cra|cll|cl|kr|diagonal|transversal|barrio|#|no\.)\b|\b(calle|carrera|cra|cll|kr)\b ?\d+.*\bbarrio\b/, razon: "el cliente mandó sus datos" },
];

const TIBIO: Frase[] = [
  { re: /\b(lo|la|los|las) (voy a |vamos a |estoy |estamos )?(pensar|pienso|pensando|analizar|analizo|evaluar|evaluo|consultar|consulto)\w*|\bdejame (pensar|consultar|analizar)\w*|\bpensarlo\b|\bvoy a pensar\w*/, razon: "el cliente dijo que lo piensa" },
  { re: /\bme organizo\b|\bme organice\b|\bcuando me organice\b|\bme voy a organizar\b/, razon: "el cliente dijo que se organiza" },
  { re: /\b(te|les|le) (confirmo|aviso|escribo|hablo|contacto|cuento)\b|\bya (te|les|le) (confirmo|aviso)\b|\bluego (te|les) (confirmo|aviso|escribo)\b/, razon: "el cliente dijo que confirma después" },
  { re: /\bmas adelante\b|\ben otro momento\b|\bmas tarde\b|\bpor ahora no\b|\bahorita no\b|\btodavia no\b|\baun no (puedo|tengo|me decido|lo se)\b/, razon: "el cliente dijo que más adelante" },
  { re: /\bno tengo (plata|dinero|presupuesto|efectivo)\b.*\b(ahora|ahorita|todavia|por ahora|en este momento)\b|\bcuando (tenga|me paguen|me salga|me llegue)\b/, razon: "el cliente dijo que lo compra cuando tenga el dinero" },
  { re: /\b(el|la) (proximo|otro) (mes|semana)\b|\bla semana que viene\b|\bdespues de la prima\b/, razon: "el cliente dijo que más adelante" },
];

/** Palabras que siguen a "estoy en…" y NO son una ciudad ("estoy en duda", "estoy en la casa"). */
const NO_ES_CIUDAD = new Set(["duda", "espera", "casa", "mi", "la", "el", "un", "una", "los", "las", "reunion", "clase", "camino", "trabajo", "el", "este", "esta", "ese", "esa", "que", "ya", "stock", "inventario", "oferta", "promocion", "ese", "mal", "buen", "revision", "proceso", "tiempo", "orden", "verdad"]);
const DICE_SU_CIUDAD = /\b(?:soy|somos|estoy|estamos|vivo|vivimos|resido|me encuentro) (?:de|en) ([a-z]{3,})\b|\benvio (?:a|para|hasta) ([a-z]{3,})\b|\b(?:mandar|enviar|envian|mandan)(?:lo|la|me)? (?:a|hasta) ([a-z]{3,})\b|\bciudad (?:es|:) ([a-z]{3,})/;

/** ¿Dice la ciudad a la que va el envío? Sin la ciudad pelada: "voy a Bogotá" no cuenta. */
function diceSuCiudad(t: string): boolean {
  const m = DICE_SU_CIUDAD.exec(t);
  const ciudad = m?.slice(1).find(Boolean);
  return Boolean(ciudad && !NO_ES_CIUDAD.has(ciudad));
}

const CALIENTE: Frase[] = [
  { re: /\bcomo (te |le |les )?(pago|puedo pagar|se paga|hago el pago|pagar)\b|\bmedios? de pago\b|\bformas? de pago\b|\bnequi\b|\bdaviplata\b|\bbancolombia\b|\bcontra ?entrega\b|\bpse\b|\bpagar (con|por|en)\b/, razon: "el cliente preguntó cómo pagar" },
  { re: /\bconsign\w*|\bnumero de cuenta\b|\bcuenta (de ahorros|corriente|bancaria)\b|\ba que cuenta\b|\bdatos (bancarios|para (el )?(pago|pagar|transferir))\b|\bpasame la cuenta\b|\bpasa(me)? los datos\b/, razon: "el cliente pidió los datos para consignar" },
  { re: /\bcuanto (seria|es|queda|sale|me sale|vale|cuesta)( el)? total\b|\b(el|un) total\b|\bvalor total\b|\bcuanto (seria|es|queda|sale)( todo)?( con| en| por) (el )?envio\b|\bcon envio (cuanto|incluido)\b|\bcuanto (seria|es|queda) en total\b/, razon: "el cliente pidió el total" },
  { re: /\b(lo|la|los|las) quiero en\b|\bquiero (el|la|los|las|uno|una)? ?(de |en )?(color )?(negro|negra|blanco|blanca|gris|rosado|rosada|rosa|beige|dorado|dorada|azul|rojo|roja|cafe|madera|nogal|vino|verde|morado|plateado|crema)\b|\b(me gusta|me gustaria|prefiero|elijo|escojo) (el|la|los|las)?( de| en)? ?(color )?(negro|negra|blanco|blanca|gris|rosado|rosada|rosa|beige|dorado|dorada|azul|rojo|roja|cafe|madera|nogal|vino|verde|morado|plateado|crema)\b/, razon: "el cliente eligió el color" },
  { re: /\bme lo llevo\b|\bme la llevo\b|\blo compro\b|\bla compro\b|\bquiero comprar\w*|\bquiero (hacer )?(el|mi) pedido\b|\bcomo hago (el|mi) pedido\b|\bapartame\b|\bseparame\b|\bquiero (uno|una|dos|tres)\b/, razon: "el cliente quiere comprar" },
];

function primera(frases: Frase[], t: string): string | null {
  for (const f of frases) if (f.re.test(t)) return f.razon;
  return null;
}

/**
 * La intención que dicen las frases claras, o null si ninguna coincide (entonces se le pregunta a
 * la IA). Orden: descarte claro → pago hecho / datos → Tibio → Caliente. Un "lo pienso" gana sobre un
 * "soy de Cali": ante la duda, Tibio; y como nunca baja de etapa, un Caliente que dice "lo pienso"
 * solo se queda donde está.
 */
export function clasificarPorFrases(texto: string, cuando: Date): IntencionDelCliente | null {
  const original = (texto ?? "").replace(/\s+/g, " ").trim();
  if (!original) return null;
  const t = normal(original);

  const descarte = descarteClaro(original);
  if (descarte) {
    return { etapa: "PERDIDO", metodo: "frase", razon: descarte.razon, motivoDePerdida: descarte.motivo, frase: descarte.frase };
  }

  const fuerte = primera(CALIENTE_FUERTE, t);
  if (fuerte) return { etapa: "NEGOCIACION", metodo: "frase", razon: fuerte };

  const fecha = detectarFechaFutura(original, cuando);
  const tibio = primera(TIBIO, t) ?? (fecha ? `el cliente habló de comprar ${fecha.como}` : null);
  if (tibio) {
    return { etapa: "PROPUESTA", metodo: "frase", razon: tibio, recontacto: fechaDeRecontacto(original, cuando) };
  }

  const caliente = primera(CALIENTE, t) ?? (diceSuCiudad(t) ? "el cliente dijo su ciudad para el envío" : null);
  if (caliente) return { etapa: "NEGOCIACION", metodo: "frase", razon: caliente };
  return null;
}

// ── La IA (solo cuando ninguna frase coincide) ─────────────────────────────────────────────────

/** ¿Vale la pena gastar una llamada a la IA con este mensaje? "ok", "gracias" o un sticker, no. */
export function valeLaPenaPreguntar(texto: string | null | undefined): boolean {
  const t = normal(texto ?? "");
  if (t.length < 12) return false;
  return t.split(" ").length >= 3;
}

export const PREGUNTA_PARA_LA_IA = `Eres un clasificador de mensajes de clientes de WhatsApp de una tienda de mobiliario para salones de belleza. Lee el ÚLTIMO mensaje del cliente y responde SOLO una palabra:
- caliente: ya quiere comprar (pregunta cómo pagar, pide el total, dice su ciudad para el envío, elige color, manda sus datos).
- tibio: sigue con el tema pero sin decidirse, pospone o duda (lo piensa, más adelante, está caro, no sabe, viaja, espera dinero).
- nada: saludo, agradecimiento, pregunta informativa o cualquier otra cosa.
Nunca respondas descartado. Si dudas entre tibio y nada, responde nada.`;

/** La respuesta de la IA convertida en etapa. La IA NUNCA descarta: "descartado" se vuelve Tibio. */
export function interpretarRespuestaDeLaIa(respuesta: string | null | undefined): EtapaPorLectura | null {
  const t = normal(respuesta ?? "");
  if (!t || /^nada\b/.test(t)) return null;
  if (/\bcaliente\b/.test(t)) return "NEGOCIACION";
  if (/\btibio\b/.test(t)) return "PROPUESTA";
  if (/\b(descart\w*|perdid\w*|no le interesa)\b/.test(t)) return "PROPUESTA";
  return null;
}

export function intencionDeLaIa(respuesta: string | null | undefined, texto: string, cuando: Date): IntencionDelCliente | null {
  const etapa = interpretarRespuestaDeLaIa(respuesta);
  if (etapa === "NEGOCIACION") return { etapa, metodo: "ia", razon: "el cliente muestra que quiere comprar" };
  if (etapa === "PROPUESTA") {
    return { etapa, metodo: "ia", razon: "el cliente sigue interesado pero no se decide", recontacto: fechaDeRecontacto(texto, cuando) };
  }
  return null;
}

// ── La decisión y las protecciones ─────────────────────────────────────────────────────────────

/**
 * A qué etapa pasa el lead, o null si se queda. Nunca baja (salvo a Descartado con frase clara y su
 * interruptor prendido) y nunca toca Ganado ni Perdido. La etapa Ganado la pone solo la asesora.
 */
export function decidirEtapaPorLectura(input: {
  etapaActual: CrmStage;
  intencion: IntencionDelCliente;
  fueraDelCrm?: boolean;
  descarteActivo?: boolean;
}): CrmStage | null {
  if (input.fueraDelCrm) return null;
  const actual = input.etapaActual;
  if (actual === "GANADO" || actual === "PERDIDO") return null;
  const { intencion } = input;
  if (intencion.etapa === "PERDIDO") {
    return input.descarteActivo !== false && intencion.metodo === "frase" ? "PERDIDO" : null;
  }
  const indiceActual = ORDEN.indexOf(actual);
  const indiceDestino = ORDEN.indexOf(intencion.etapa);
  if (indiceActual < 0 || indiceDestino <= indiceActual) return null;
  return intencion.etapa;
}

// ── La fecha de recontacto en la ficha (metadata del contacto) ──────────────────────────────────

export const CLAVE_RECONTACTO = "recontactoEn";
const CLAVE_DESCARTE = "descarteAutomatico";

function comoRegistro(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
}

/** Cuándo hay que volver a escribirle, o null. Lo usan el seguimiento y el enfriamiento. */
export function leerRecontacto(metadata: unknown): Date | null {
  const valor = comoRegistro(metadata)[CLAVE_RECONTACTO];
  if (typeof valor !== "string" || !valor.trim()) return null;
  const fecha = new Date(valor);
  return Number.isFinite(fecha.getTime()) ? fecha : null;
}

/**
 * La ficha con la fecha de recontacto puesta. Una fecha que el cliente NO dijo (la de 3 días) no
 * adelanta una que ya estaba puesta a futuro. Devuelve null si no hay nada que cambiar.
 */
export function metadataConRecontacto(
  metadata: unknown,
  recontacto: Recontacto,
  ahora: Date,
): Record<string, unknown> | null {
  const actual = leerRecontacto(metadata);
  if (!recontacto.explicito && actual && actual.getTime() > ahora.getTime()) return null;
  return { ...comoRegistro(metadata), [CLAVE_RECONTACTO]: recontacto.fecha.toISOString() };
}

/** La ficha con la frase exacta del descarte, para poder revisarlo después. */
export function metadataConDescarte(
  metadata: unknown,
  descarte: { frase: string; motivo: string; en: Date },
): Record<string, unknown> {
  return {
    ...comoRegistro(metadata),
    [CLAVE_DESCARTE]: { frase: descarte.frase, motivo: descarte.motivo, en: descarte.en.toISOString() },
  };
}
