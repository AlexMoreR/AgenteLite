import { prisma } from "@/lib/prisma";

/**
 * Historial de cambios de etapa del CRM (tabla HistorialEtapa).
 *
 * Antes no se guardaba CUANDO un chat cambiaba de etapa (el MCP lo marcaba "aproximado"). Sin eso
 * no se puede medir cuanto tarda un cliente en pasar de Nuevo a Caliente o a Ganado. Desde que
 * sube esta funcion, cada lugar que escribe Contact.crmStage deja aca una fila. No se inventan
 * fechas viejas: lo anterior sigue siendo aproximado.
 *
 * Regla: registrar NUNCA bloquea el cambio de etapa. Se llama despues de que el cambio se guardo
 * y cualquier error solo queda en el registro de errores.
 */
export type OrigenCambioEtapa = "ASESORA" | "BOT" | "AUTOMATICO" | "MCP" | "SISTEMA";

export type CambioDeEtapa = {
  workspaceId: string;
  contactId: string;
  conversationId?: string | null;
  etapaAnterior: string | null | undefined;
  etapaNueva: string;
  origen: OrigenCambioEtapa;
  /** Quien la movio: el id de la usuaria si fue ASESORA; vacio para bot/automatico. */
  quien?: string | null;
  /** Nota corta, por ejemplo "descarte automático". */
  nota?: string | null;
};

/** Escribe una fila solo si la etapa de verdad cambio. Nunca lanza. */
export async function registrarCambioDeEtapa(cambio: CambioDeEtapa): Promise<boolean> {
  return registrarCambiosDeEtapa([cambio]).then((n) => n > 0);
}

/** Varias filas en UNA sola instruccion (vaciar CRM, descartes grandes). Devuelve cuantas escribio. */
export async function registrarCambiosDeEtapa(cambios: CambioDeEtapa[]): Promise<number> {
  const reales = cambios.filter((c) => c.etapaAnterior !== c.etapaNueva);
  if (reales.length === 0) return 0;
  try {
    const { count } = await prisma.historialEtapa.createMany({
      data: reales.map((c) => ({
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
    return count;
  } catch (error) {
    console.error("[historial-etapa] no se pudo registrar el cambio de etapa", {
      cambios: reales.length,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}
