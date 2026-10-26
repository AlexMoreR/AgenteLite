import { prisma } from "@/lib/prisma";

/** Quién movió la etapa. SISTEMA = acciones del negocio como "vaciar CRM". */
export type OrigenCambioDeEtapa = "ASESORA" | "BOT" | "AUTOMATICO" | "MCP" | "SISTEMA";

export type CambioDeEtapa = {
  workspaceId: string;
  contactId: string;
  conversationId?: string | null;
  etapaAnterior?: string | null;
  etapaNueva: string;
  origen: OrigenCambioDeEtapa;
  /** Si fue una asesora: el id de la usuaria. */
  quien?: string | null;
  /** Nota corta, ej. "descarte automático". */
  nota?: string | null;
};

/**
 * Deja una fila por cada cambio de etapa del CRM (cuándo y quién).
 *
 * Solo escribe si la etapa de verdad cambió. Si falla al escribir, lo anota en el registro de
 * errores y NO lanza: el cambio de etapa ya quedó guardado y no se puede romper por esto.
 * Con varios cambios juntos (vaciar CRM, descartes grandes) escribe todo en una sola instrucción.
 */
export async function registrarCambiosDeEtapa(cambios: CambioDeEtapa[]): Promise<void> {
  const filas = cambios.filter((c) => c.etapaAnterior !== c.etapaNueva);
  if (filas.length === 0) return;
  try {
    await prisma.historialEtapa.createMany({
      data: filas.map((c) => ({
        workspaceId: c.workspaceId,
        contactId: c.contactId,
        conversationId: c.conversationId ?? null,
        etapaAnterior: c.etapaAnterior ?? null,
        etapaNueva: c.etapaNueva,
        origen: c.origen,
        quien: c.quien ?? null,
        nota: c.nota ?? null,
      })),
    });
  } catch (error) {
    console.error("[historial-etapa] no se pudo registrar el cambio de etapa", {
      cambios: filas.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function registrarCambioDeEtapa(cambio: CambioDeEtapa): Promise<void> {
  return registrarCambiosDeEtapa([cambio]);
}
