/**
 * DETECTOR DE CHATS AUTOMÁTICOS (código puro).
 *
 * El 26-10-2026 el Supervisor escaló a Ingrid el chat 573013536788 como "cliente mandó comprobante de
 * 87.400 y nadie responde": era un ROBOT de Bancolombia. Los robots (bancos, billeteras, códigos de
 * verificación) no son clientes y no se atienden.
 *
 * Es CONSERVADOR a propósito: ocultar a un cliente real es peor que un aviso de más. Un chat es robot
 * solo si se cumplen las dos cosas:
 *  1. nunca lo respondió una persona (ni desde el CRM ni desde el celular);
 *  2. parece automático: el nombre del contacto es de un banco / servicio, o TODOS los textos que
 *     mandó tienen forma de notificación ("Bancolombia le informa…", "código de verificación"…).
 * Si hay duda (sin textos, un texto que no parece notificación) NO es robot.
 */

export type DatosDeChatAutomatico = {
  nombre?: string | null;
  /** Lo que escribió el contacto (sin notas del sistema). */
  textos?: Array<string | null | undefined>;
  /** Última respuesta de una persona: si existe, no es robot. */
  ultimaRespuestaHumanaEn?: Date | null;
};

export type MotivoAutomatico = "nombre_de_servicio" | "mensajes_de_notificacion";

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Nombre del contacto que es de un banco, billetera o servicio (palabra completa). */
const NOMBRES_DE_SERVICIO =
  /\b(bancolombia|nequi|daviplata|davivienda|bbva|banco de bogota|banco popular|banco agrario|av villas|colpatria|scotiabank|itau|nu colombia|lulo bank|movii|dale|pse|bold|wompi|payu|mercado pago|mercadopago|addi|sistecredito|redeban|credibanco|transunion|datacredito|dian|registraduria)\b/;

/** Frases propias de una notificación automática. */
const FRASES_DE_NOTIFICACION: RegExp[] = [
  /\b(bancolombia|nequi|daviplata|davivienda|bbva) (le )?(informa|notifica|te informa)\b/,
  /\bcodigo (de )?(verificacion|seguridad|confirmacion|acceso|unico)\b/,
  /\b(tu|su) codigo (es|:)/,
  /\bclave (dinamica|temporal|de un solo uso)\b/,
  /\bno (comparta|compartas|responda|respondas) (este|esta|el|la|con nadie|su|tu)\b/,
  /\bno (responda|respondas) a (este|esta)\b/,
  /\b(este|esta) (es un )?(mensaje|numero|chat) (es )?automatic[oa]\b/,
  /\bmensaje automatico\b/,
  /^(compra|pago|transferencia|retiro|recarga|abono|consignacion) (por|de) \$ ?[\d.,]+ (en|a|desde|con|el|exitos)/,
  /\btransferencia (exitosa|recibida|realizada)\b/,
  /^recibiste \$ ?[\d.,]+\b/,
  /\bsaldo (disponible|actual)\b/,
  /\bclave de (un solo uso|seguridad)\b/,
  /\botp\b/,
];

/** Motivo por el que el chat es un robot, o null (también cuando hay duda). */
export function motivoDeChatAutomatico(d: DatosDeChatAutomatico): MotivoAutomatico | null {
  if (d.ultimaRespuestaHumanaEn) return null;
  const nombre = d.nombre ? normalizar(d.nombre) : "";
  if (nombre && NOMBRES_DE_SERVICIO.test(nombre)) return "nombre_de_servicio";
  const textos = (d.textos ?? []).map((t) => (t ? normalizar(t) : "")).filter(Boolean);
  if (textos.length === 0) return null;
  const todosSonNotificacion = textos.every((t) => FRASES_DE_NOTIFICACION.some((re) => re.test(t)));
  return todosSonNotificacion ? "mensajes_de_notificacion" : null;
}

export function esChatAutomatico(d: DatosDeChatAutomatico): boolean {
  return motivoDeChatAutomatico(d) !== null;
}
