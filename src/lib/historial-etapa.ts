import { prisma } from "@/lib/prisma";

/**
 * Historial de etapas del CRM: una fila en "HistorialEtapa" por cada cambio de Contact.crmStage.
 *
 * Antes el CRM solo guardaba la etapa de hoy, sin saber cuándo se movió ni quién. Con esto se puede
 * medir cuánto tarda un cliente de Nuevo a Caliente o a Ganado. Empieza vacío el día que sube: no se
 * inventan fechas de antes.
 *
 * Registrar NUNCA bloquea el cambio de etapa: se llama después de guardarlo y si falla solo se anota
 * en el log.
 */

export type OrigenCambioEtapa = "ASESORA" | "BOT" | "AUTOMATICO" | "MCP" | "SISTEMA";

export type CambioDeEtapa = {
  workspaceId: string;
  contactId: string;
  conversationId?: string | null;
  etapaAnterior?: string | null;
  etapaNueva: string;
  origen: OrigenCambioEtapa;
  /** Para ASESORA: la usuaria que la movió. */
  quien?: string | null;
  nota?: string | null;
};

function aFila(cambio: CambioDeEtapa) {
  return {
    workspaceId: cambio.workspaceId,
    contactId: cambio.contactId,
    conversationId: cambio.conversationId ?? null,
    etapaAnterior: cambio.etapaAnterior ?? null,
    etapaNueva: cambio.etapaNueva,
    origen: cambio.origen,
    quien: cambio.quien ?? null,
    nota: cambio.nota ?? null,
  };
}

/** Escribe varios cambios en una sola instrucción. Ignora los que no cambiaron la etapa. */
export async function registrarCambiosDeEtapa(cambios: CambioDeEtapa[]): Promise<void> {
  const reales = cambios.filter((c) => c.etapaAnterior !== c.etapaNueva);
  if (reales.length === 0) return;
  try {
    await prisma.historialEtapa.createMany({ data: reales.map(aFila) });
  } catch (error) {
    console.error("[historial-etapa] no se pudo registrar el cambio de etapa", error);
  }
}

/** Escribe una fila solo si la etapa de verdad cambió. */
export async function registrarCambioDeEtapa(cambio: CambioDeEtapa): Promise<void> {
  await registrarCambiosDeEtapa([cambio]);
}
