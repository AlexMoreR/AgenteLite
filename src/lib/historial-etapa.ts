import { prisma } from "@/lib/prisma";

/**
 * Historial de etapas del CRM (Embudo 1): una fila por cada cambio de etapa, con quién y cuándo.
 *
 * Antes no se guardaba cuándo un chat cambió de etapa: lo único que había era `Contact.updatedAt`,
 * que se mueve por cualquier cosa. Sin esa fecha no se puede medir cuánto tarda un cliente en pasar
 * de Nuevo a Caliente o a Ganado. Empieza vacío el día que sube; no se inventan fechas viejas.
 *
 * Es el ÚNICO lugar que escribe la tabla. El registro nunca bloquea el cambio de etapa: se llama
 * DESPUÉS de que el cambio se guardó y, si falla, solo se anota en el log.
 */

/** Quién movió la etapa. SISTEMA = acciones del negocio como "vaciar CRM". */
export type OrigenCambioEtapa = "ASESORA" | "BOT" | "AUTOMATICO" | "MCP" | "SISTEMA";

export type CambioDeEtapa = {
  workspaceId: string;
  contactId: string;
  /** El chat desde donde se movió, si se sabe. */
  conversationId?: string | null;
  etapaAnterior: string | null;
  etapaNueva: string;
  origen: OrigenCambioEtapa;
  /** La usuaria si fue ASESORA; si no, el proceso o la regla. */
  quien?: string | null;
  /** Nota corta: "descarte automático", "resultado de llamada"... */
  nota?: string | null;
};

const dato = (cambio: CambioDeEtapa) => ({
  workspaceId: cambio.workspaceId,
  contactId: cambio.contactId,
  conversationId: cambio.conversationId ?? null,
  etapaAnterior: cambio.etapaAnterior,
  etapaNueva: cambio.etapaNueva,
  origen: cambio.origen,
  quien: cambio.quien ?? null,
  nota: cambio.nota ?? null,
});

/** Escribe la fila solo si la etapa de verdad cambió. Nunca lanza error. */
export async function registrarCambioDeEtapa(cambio: CambioDeEtapa): Promise<boolean> {
  return registrarCambiosDeEtapa([cambio]).then((n) => n > 0);
}

/** Igual, para muchos a la vez: UNA sola instrucción de base (vaciar CRM, descartes grandes). */
export async function registrarCambiosDeEtapa(cambios: CambioDeEtapa[]): Promise<number> {
  const reales = cambios.filter((cambio) => cambio.etapaAnterior !== cambio.etapaNueva);
  if (reales.length === 0) {
    return 0;
  }
  try {
    const resultado = await prisma.historialEtapa.createMany({ data: reales.map(dato) });
    return resultado.count;
  } catch (error) {
    console.error("[historial-etapa] no se pudo registrar el cambio de etapa", error);
    return 0;
  }
}
