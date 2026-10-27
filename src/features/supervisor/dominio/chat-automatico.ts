/**
 * DETECTOR DE CHATS AUTOMÁTICOS (código puro, 26-10-2026).
 *
 * El Supervisor escaló a Ingrid el chat 573013536788 como "cliente mandó comprobante de 87.400 y
 * nadie responde": era un ROBOT de Bancolombia. Un chat es automático solo si cumple las DOS cosas:
 *  1. nunca lo respondió una persona (ni desde el CRM ni desde el celular);
 *  2. parece automático: el nombre del contacto es de un banco o servicio, o TODOS sus mensajes
 *     tienen forma de notificación ("Bancolombia le informa…", "código de verificación", "no
 *     responda este mensaje", "transferencia por $…").
 *
 * Es conservador a propósito: ante la duda NO lo marca. Ocultar a un cliente real es peor que un
 * aviso de más. Un cliente que dice "ya pagué, adjunto comprobante" no es notificación.
 */

export type DatosDeChatAutomatico = {
  nombre?: string | null;
  /** Lo que escribió el contacto (los mensajes sin texto no cuentan). */
  textos?: Array<string | null | undefined>;
  /** Última respuesta de una persona. Si existe, NO es robot. */
  ultimaRespuestaHumanaEn?: Date | null;
};

export type MotivoAutomatico = "nombre_de_banco" | "mensajes_de_notificacion";

/** Minúsculas y sin tildes, para comparar. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Nombres de bancos y servicios que solo escriben robots. "banco" a secas NO cuenta. */
const NOMBRES_DE_ROBOT =
  /\b(bancolombia|nequi|daviplata|davivienda|bbva|banco\s+(de\s+bogota|popular|agrario|caja\s+social|av\s*villas|falabella|pichincha|itau)|scotiabank|colpatria|bancamia|banco\s*w|movii|transfiya|rappipay|nu\s+colombia|redeban|pse|wompi|payu|mercado\s*pago)\b/;

/** Formas típicas de una notificación automática. */
const FORMAS_DE_NOTIFICACION: RegExp[] = [
  /\bbancolombia\s+(le\s+)?informa\b/,
  /\b(nequi|daviplata|davivienda)\s+(le\s+)?(informa|avisa)\b/,
  /\bcodigo\s+de\s+(verificacion|seguridad|confirmacion|activacion)\b/,
  /\b(verification|security)\s+code\b/,
  /\b(clave|token)\s+(dinamic[ao]|temporal)\b/,
  /\bno\s+(responda|conteste)\s+(a\s+)?(este|esta|el|la)\s+(mensaje|chat|correo|notificacion)\b/,
  /\bmensaje\s+automatic[oa]\b/,
  /\bno[-\s]?reply\b/,
  /\b(recibiste|ha\s+recibido|se\s+realizo|realizaste)\s+(una\s+)?(transferencia|consignacion|compra|retiro|pago)\b.*\$/,
  /\b(transferencia|consignacion|compra|retiro|pago\s+recibido)\s+(por|de)\s+\$\s*[\d.,]+/,
];

export function parecenNotificaciones(textos: Array<string | null | undefined>): boolean {
  const limpios = textos.map((t) => normalizar(t ?? "")).filter(Boolean);
  if (limpios.length === 0) return false;
  return limpios.every((t) => FORMAS_DE_NOTIFICACION.some((forma) => forma.test(t)));
}

/** El motivo por el que el chat es un robot, o null si no hay certeza (o si una persona ya lo respondió). */
export function motivoAutomatico(d: DatosDeChatAutomatico): MotivoAutomatico | null {
  if (d.ultimaRespuestaHumanaEn) return null;
  if (d.nombre && NOMBRES_DE_ROBOT.test(normalizar(d.nombre))) return "nombre_de_banco";
  if (parecenNotificaciones(d.textos ?? [])) return "mensajes_de_notificacion";
  return null;
}

export function esChatAutomatico(d: DatosDeChatAutomatico): boolean {
  return motivoAutomatico(d) !== null;
}
