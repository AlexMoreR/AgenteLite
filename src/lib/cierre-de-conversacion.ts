/**
 * ¿EL MENSAJE CIERRA LA CONVERSACIÓN? (código puro, compartido).
 *
 * Lo usan el Supervisor (dominio/detectores-atencion.ts, regla 4 de los cierres) y los automáticos
 * después de la asesora (seguimiento-inteligente/dominio/tras-asesora.ts: no se le pregunta
 * "¿pudiste ver lo que te envié?" a quien ya se despidió).
 *
 * AGRADECIMIENTO / CIERRE DE CUALQUIER LARGO (falla real del domingo 11-10-2026: a Ingrid le llegó
 * "Segundo aviso · fuera de horario" por «Ah, bueno, visto, muy bien, muchas gracias.»). Es cierre,
 * SIN importar el largo, si:
 *   a) trae un AGRADECIMIENTO o DESPEDIDA (gracias, feliz noche, bendiciones, chao, igualmente…);
 *   b) NO trae PREGUNTA ("?" / "¿" ni palabras interrogativas);
 *   c) NO trae SEÑAL DE COMPRA (detector del embudo + quiero, separ-, pag-, consign-, datos, un color…).
 * "Ya pagué" nunca es cierre.
 *
 * CORTESÍA DE LA ASESORA (13-10-2026, chat •••• 6626): "Gracias a ti", "Con gusto", "A la orden",
 * "Feliz día" sin pregunta: la asesora cerró la charla, no dejó nada por ver.
 */

import { detectarSenales, esSenalDeCompra } from "../features/embudo/dominio/senales";

/** Minúsculas, sin tildes ni signos (los espacios se conservan). */
export function normalizarParaCierre(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Agradecimiento / despedida que, sin pregunta ni señal de compra, cierra aunque el mensaje sea largo. */
const AGRADECE_O_CIERRA = /\b(gracias|graciass|grax|bendiciones|bendiga|chao|chau|adios|igualmente|feliz (noche|dia|tarde|fin de semana)|hay que saber)\b/;

/** Pregunta: signos o palabras interrogativas (sin tildes). "hay que" no cuenta como "¿hay…?". */
const PREGUNTA =
  /\b(cuanto|cuanta|cuantos|cuantas|cuando|donde|como|cual|cuales|que (precio|valor|costo|color|colores|medida|medidas|tiempo|dias)|tienen|tiene|tendra|tendran|hay(?! que)|manejan|venden|me (regala|regalas|regalan|pasa|pasas|pasan|manda|mandas|mandan|envia|envias|envian)|informacion|info)\b/;

/** Señal de compra por palabras (además del detector del embudo). "Lo tendré en cuenta" no es una cuenta bancaria. */
const SENAL_DE_COMPRA =
  /\b(quiero|quisiera|me interesa|separ\w*|apart\w*|pag\w*|consign\w*|transfer\w*|abon\w*|datos|(?<!en )cuenta|nequi|daviplata|envi\w* a|mand\w* a|negr[oa]s?|blanc[oa]s?|rosad[oa]s?|rosa|beige|gris|dorad[oa]s?|nude|azul|roj[oa]|vinotinto|cafe|marfil|crema|platead[oa]|verde|morado|lila|fucsia)\b/;

/** ¿Es un agradecimiento / cierre de cualquier largo, sin pregunta ni señal de compra? */
export function esAgradecimientoSinPendiente(texto: string | null | undefined): boolean {
  const original = texto ?? "";
  if (/[?¿]/.test(original)) return false;
  const limpio = normalizarParaCierre(original);
  if (!AGRADECE_O_CIERRA.test(limpio)) return false;
  if (PREGUNTA.test(limpio) || SENAL_DE_COMPRA.test(limpio)) return false;
  return !detectarSenales(original).some(esSenalDeCompra);
}

/** Cortesía de cierre de la asesora: "gracias a ti", "con gusto", "a la orden", "feliz día"… */
const CORTESIA =
  /\b(gracias|con (mucho )?gusto|a la orden|a tu orden|a su orden|a la espera|feliz (dia|tarde|noche|fin de semana)|que (tengas|tenga|este|estes) (un )?(lindo|buen|bonito|excelente|feliz|bendecido)|bendiciones|quedo (atenta|atento|pendiente)|estamos (atentos|en contacto|pendientes)|igualmente|un abrazo|saludos)\b/;

/**
 * ¿La asesora cerró con una cortesía, sin pregunta ni pedido? Corto (hasta 15 palabras), con una
 * frase de cortesía y sin "?" / palabras interrogativas: lo largo o con preguntas es contenido.
 */
export function esCortesiaDeCierre(texto: string | null | undefined): boolean {
  const original = (texto ?? "").trim();
  if (!original || /[?¿]/.test(original)) return false;
  const limpio = normalizarParaCierre(original);
  if (!limpio || limpio.split(" ").length > 15) return false;
  if (!CORTESIA.test(limpio)) return false;
  return !PREGUNTA.test(limpio);
}
