/**
 * Regla de "se puede editar este mensaje" (como en WhatsApp).
 *
 * Es una funcion pura para que la pantalla (decide si muestra "Editar") y el servidor (decide si
 * lo deja pasar) usen EXACTAMENTE la misma regla, y para poder probarla sin base de datos.
 */

/** WhatsApp solo deja editar durante los 15 minutos siguientes al envio. */
export const MINUTOS_PARA_EDITAR = 15;

/** Texto maximo de un mensaje de WhatsApp. */
export const MAXIMO_TEXTO_EDITADO = 4096;

/**
 * Marcas de `rawPayload.source` de los mensajes que NO escribio una asesora: reglas automaticas,
 * seguimientos, el agente, la reactivacion, notas internas y llamadas. Estos nunca se editan.
 */
const ORIGENES_AUTOMATICOS = new Set([
  "follow",
  "automation",
  "automation_reactivation",
  "agent",
  "activity",
  "llamada",
  "google_sheet",
  "agente-v3-seguimiento",
]);

export type MensajeEditable = {
  direction: string;
  type?: string | null;
  externalId?: string | null;
  agentId?: string | null;
  deletedAt?: Date | string | null;
  rawPayload?: unknown;
  /** Cuando salio: `sentAt`, y si falta, `createdAt`. */
  enviadoEn?: Date | string | null;
};

function origenDe(rawPayload: unknown): string | null {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }
  const source = (rawPayload as Record<string, unknown>).source;
  return typeof source === "string" ? source : null;
}

export function puedeEditarseMensaje(mensaje: MensajeEditable, ahora: Date = new Date()): boolean {
  if (mensaje.direction !== "OUTBOUND") return false;
  if ((mensaje.type ?? "TEXT") !== "TEXT") return false;
  if (mensaje.deletedAt) return false;
  // Lo que escribe el bot trae `agentId`; una asesora desde el CRM no.
  if (mensaje.agentId) return false;
  const origen = origenDe(mensaje.rawPayload);
  if (origen && (ORIGENES_AUTOMATICOS.has(origen) || origen.startsWith("agente-v3"))) return false;
  // Id real de WhatsApp: los hashes internos de 64 caracteres no sirven para editar.
  const id = mensaje.externalId?.trim();
  if (!id || /^[a-f0-9]{64}$/.test(id)) return false;
  if (!mensaje.enviadoEn) return false;
  const enviado = new Date(mensaje.enviadoEn).getTime();
  if (!Number.isFinite(enviado)) return false;
  const minutos = (ahora.getTime() - enviado) / 60_000;
  return minutos < MINUTOS_PARA_EDITAR;
}
