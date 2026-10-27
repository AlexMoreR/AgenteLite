/**
 * DETECTOR DE CHATS AUTOMÁTICOS (código puro).
 *
 * El 26-10-2026 el Supervisor escaló a Ingrid el chat 573013536788 como "cliente mandó comprobante
 * de 87.400 y nadie responde". Era un ROBOT de Bancolombia, no un cliente. Un chat se considera robot
 * solo si cumple las DOS cosas:
 *  - nunca lo ha respondido una persona (ni desde el CRM ni desde el celular);
 *  - parece automático: el nombre del contacto es de un banco o servicio, o sus mensajes tienen forma
 *    de notificación ("Bancolombia le informa…", "código de verificación", "no responda este mensaje").
 *
 * Es conservador a propósito: ante la duda NO es robot (ocultar a un cliente real es peor que un aviso de más).
 */

export type DatosDeChatAutomatico = {
  nombre?: string | null;
  /** Lo que escribió el contacto. */
  textos?: Array<string | null | undefined>;
  /** Alguna persona le ha respondido a este chat alguna vez. */
  respondioUnaPersona: boolean;
};

export type VeredictoAutomatico = { automatico: boolean; motivo: string | null };

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Nombres de bancos y servicios que mandan mensajes solos. Se busca como palabra completa. */
const NOMBRES_DE_ROBOT = [
  "bancolombia",
  "nequi",
  "daviplata",
  "davivienda",
  "bbva",
  "banco de bogota",
  "banco popular",
  "banco agrario",
  "banco caja social",
  "av villas",
  "scotiabank colpatria",
  "bancoomeva",
  "wompi",
  "payu",
  "mercado pago",
  "movii",
  "rappipay",
  "tpaga",
  "servientrega",
  "coordinadora",
  "interrapidisimo",
];

/** Frases propias de una notificación automática (sobre texto normalizado, sin tildes). */
const FRASES_DE_NOTIFICACION: RegExp[] = [
  /\b(bancolombia|nequi|daviplata|davivienda|bbva)\b.{0,40}\b(le informa|te informa|informa que)\b/,
  /\bno responda (a )?(este|esta|el) (mensaje|chat|numero|correo)\b/,
  /\bno responder (a )?(este|esta) (mensaje|chat|numero)\b/,
  /\bmensaje automatico\b/,
  /\b(este|esta) (es un )?(mensaje|numero|chat) (es )?(solo )?(automatico|informativo)\b/,
  /\bcodigo (de )?(verificacion|seguridad|confirmacion|acceso)\b/,
  /\bsu codigo (es|de)\b/,
  /\btu codigo (es|de)\b/,
  /\bnunca (lo )?compart[ae] (este|su|tu) (codigo|clave)\b/,
  /\bclave (dinamica|temporal|de un solo uso)\b/,
  // Montos: solo si el mensaje ARRANCA así (un cliente dice "hice la transferencia por $…", el banco abre con ella).
  /^(compra|transferencia|pago|retiro|consignacion|abono|recarga)( exitos[oa])? (por|de) \$ ?[\d.,]+/,
  /^recibiste (una )?(transferencia|plata|dinero|pago)\b.{0,40}\$ ?[\d.,]+/,
  /^(le|te) (enviaron|transfirieron|consignaron)\b.{0,30}\$ ?[\d.,]+/,
  /^saldo (disponible|actual)\b.{0,20}\$ ?[\d.,]+/,
];

function nombreDeRobot(nombre: string): string | null {
  const limpio = normalizar(nombre).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!limpio) return null;
  for (const clave of NOMBRES_DE_ROBOT) {
    if (new RegExp(`(^| )${clave}( |$)`).test(limpio)) return `nombre:${clave}`;
  }
  return null;
}

function textoDeNotificacion(texto: string): boolean {
  const limpio = normalizar(texto);
  return FRASES_DE_NOTIFICACION.some((regla) => regla.test(limpio));
}

export function detectarChatAutomatico(d: DatosDeChatAutomatico): VeredictoAutomatico {
  // Si una persona ya le respondió alguna vez, jamás se trata como robot.
  if (d.respondioUnaPersona) return { automatico: false, motivo: null };
  const textos = (d.textos ?? []).filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  const porNombre = d.nombre ? nombreDeRobot(d.nombre) : null;
  if (porNombre) {
    // El nombre de un banco solo no basta si el cliente además conversa como persona: se exige que
    // al menos un mensaje parezca notificación, o que no haya ningún texto que revisar.
    if (textos.length === 0 || textos.some(textoDeNotificacion)) return { automatico: true, motivo: porNombre };
    return { automatico: false, motivo: null };
  }
  if (textos.length === 0) return { automatico: false, motivo: null };
  // Por forma: TODOS los textos que se ven deben parecer notificación (un solo mensaje humano lo salva).
  if (textos.every(textoDeNotificacion)) return { automatico: true, motivo: "notificacion" };
  return { automatico: false, motivo: null };
}
