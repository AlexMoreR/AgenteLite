import type { Prisma } from "@prisma/client";

/**
 * EL CANDADO "NO REASIGNAR" (parte 1: columnas y reglas). La asesora lo prende en un chat para
 * conservarlo: mientras está vigente, ni la demora de la asesora ni el rescate de chats huérfanos
 * se lo quitan. Vale HORAS_DEL_CANDADO desde que se prendió, o hasta que el contacto pasa a Ganado
 * o Perdido. Puro: sin Prisma en tiempo de ejecución (también lo usa la pantalla).
 */

export const HORAS_DEL_CANDADO = 24;

const MS_DEL_CANDADO = HORAS_DEL_CANDADO * 3_600_000;

/** Las etapas que apagan el candado (enum CrmStage). */
const ETAPAS_QUE_LO_APAGAN = ["GANADO", "PERDIDO"] as const;

export type DatosDelCandado = {
  noReasignarAt: Date | string | null | undefined;
  crmStage?: string | null;
};

/** ¿Tiene el chat el candado prendido ahora? Acepta Date o texto ISO. */
export function candadoVigente(chat: DatosDelCandado, ahora: Date = new Date()): boolean {
  if (!chat.noReasignarAt) return false;
  const prendido = chat.noReasignarAt instanceof Date ? chat.noReasignarAt.getTime() : Date.parse(chat.noReasignarAt);
  if (!Number.isFinite(prendido)) return false;
  if (ahora.getTime() - prendido >= MS_DEL_CANDADO) return false;
  return !(ETAPAS_QUE_LO_APAGAN as readonly string[]).includes(chat.crmStage ?? "");
}

/** Deja fuera los chats con candado vigente (los que no se pueden reasignar). */
export function filtrarSinCandado<T extends DatosDelCandado>(chats: T[], ahora: Date = new Date()): T[] {
  return chats.filter((chat) => !candadoVigente(chat, ahora));
}

/** El mismo filtro para una consulta de Conversation: sin candado, vencido o contacto cerrado. */
export function whereSinCandadoVigente(ahora: Date = new Date()): Prisma.ConversationWhereInput {
  return {
    OR: [
      { noReasignarAt: null },
      { noReasignarAt: { lt: new Date(ahora.getTime() - MS_DEL_CANDADO) } },
      { contact: { crmStage: { in: [...ETAPAS_QUE_LO_APAGAN] } } },
    ],
  };
}
