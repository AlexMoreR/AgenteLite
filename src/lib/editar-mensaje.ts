/**
 * Regla UNICA de "este mensaje se puede editar".
 *
 * La usan la burbuja (para mostrar u ocultar "Editar") y la accion del servidor (para no confiar
 * en lo que diga el navegador). Funcion pura, sin imports: sirve en cliente, servidor y pruebas.
 *
 * Se puede editar un mensaje que:
 * - es SALIENTE y de TEXTO (audios, fotos, ubicaciones y demas no se editan en WhatsApp);
 * - lo escribio una asesora desde el CRM. La marca es `rawPayload.source === "manual"` con
 *   `enviadoPorUserId`; el `agentId` NO sirve porque los manuales tambien lo traen. Asi quedan
 *   fuera el bot, las reactivaciones, los seguimientos y las reglas automaticas;
 * - no esta eliminado;
 * - tiene un id real de WhatsApp (no el hash interno de 64 caracteres);
 * - tiene menos de 15 minutos, que es lo que permite WhatsApp.
 */
export const MINUTOS_PARA_EDITAR = 15;

export type MensajeEditable = {
  direction?: string | null;
  type?: string | null;
  externalId?: string | null;
  createdAt?: Date | string | null;
  sentAt?: Date | string | null;
  deletedAt?: Date | string | null;
  rawPayload?: unknown;
};

function marcaDeAsesora(rawPayload: unknown): boolean {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return false;
  }
  const raw = rawPayload as Record<string, unknown>;
  return raw.source === "manual" && typeof raw.enviadoPorUserId === "string" && raw.enviadoPorUserId.length > 0;
}

export function puedeEditarseMensaje(mensaje: MensajeEditable, ahora: Date = new Date()): boolean {
  if (mensaje.direction !== "OUTBOUND" || (mensaje.type ?? "TEXT") !== "TEXT" || mensaje.deletedAt) {
    return false;
  }
  const externalId = mensaje.externalId?.trim() ?? "";
  if (!externalId || /^[a-f0-9]{64}$/.test(externalId) || externalId.startsWith("optimistic:")) {
    return false;
  }
  if (!marcaDeAsesora(mensaje.rawPayload)) {
    return false;
  }
  const enviado = mensaje.sentAt ?? mensaje.createdAt;
  if (!enviado) {
    return false;
  }
  const edad = ahora.getTime() - new Date(enviado).getTime();
  return Number.isFinite(edad) && edad < MINUTOS_PARA_EDITAR * 60_000;
}
