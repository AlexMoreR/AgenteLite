import { prisma } from "@/lib/prisma";

/**
 * HISTORIAL DE ETAPAS del CRM (Embudo 1).
 *
 * Antes el contacto solo guardaba la etapa en la que esta HOY, asi que no se podia medir cuanto
 * tarda un cliente en pasar de Nuevo a Caliente o a Ganado. Cada lugar que cambia `Contact.crmStage`
 * llama a `registrarCambioDeEtapa` DESPUES de guardar el cambio. Hay una prueba de cobertura que
 * falla si un archivo escribe la etapa sin llamarla (npm run test:historial-etapa).
 *
 * Reglas:
 *  - Solo escribe si la etapa de verdad cambio.
 *  - Si falla al escribir lo anota en el log y NO lanza: nunca bloquea el cambio de etapa.
 *  - Empieza vacio el dia que sube: no se inventan fechas viejas.
 */
export type OrigenCambioDeEtapa = "ASESORA" | "BOT" | "AUTOMATICO" | "MCP" | "SISTEMA";

export type CambioDeEtapa = {
  workspaceId: string;
  contactId: string;
  conversationId?: string | null;
  etapaAnterior?: string | null;
  etapaNueva: string;
  origen: OrigenCambioDeEtapa;
  /** La usuaria si fue ASESORA; en los automaticos, la regla o el proceso. */
  quien?: string | null;
  /** Nota corta: "descarte automatico", "resultado de llamada"... */
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
    nota: cambio.nota?.slice(0, 200) ?? null,
  };
}

/** Anota un cambio de etapa. Devuelve true si escribio la fila. Nunca lanza. */
export async function registrarCambioDeEtapa(cambio: CambioDeEtapa): Promise<boolean> {
  if (cambio.etapaAnterior && cambio.etapaAnterior === cambio.etapaNueva) {
    return false;
  }
  try {
    await prisma.historialEtapa.create({ data: aFila(cambio) });
    return true;
  } catch (error) {
    console.error("[historial-etapa] no se pudo registrar el cambio", {
      contactId: cambio.contactId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Varios cambios en UNA sola instruccion (vaciar CRM, descartes grandes). Nunca lanza. */
export async function registrarCambiosDeEtapa(cambios: CambioDeEtapa[]): Promise<number> {
  const reales = cambios.filter((c) => !(c.etapaAnterior && c.etapaAnterior === c.etapaNueva));
  if (reales.length === 0) {
    return 0;
  }
  try {
    const { count } = await prisma.historialEtapa.createMany({ data: reales.map(aFila) });
    return count;
  } catch (error) {
    console.error("[historial-etapa] no se pudieron registrar los cambios", {
      cuantos: reales.length,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}
