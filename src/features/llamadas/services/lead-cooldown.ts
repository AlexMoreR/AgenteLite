import { prisma } from "@/lib/prisma";
import { recordConversationActivity } from "@/lib/conversation-activity";

const NO_ANSWER_RESULT = "no_contesto";
// Resultados que implican que SÍ hubo contacto/respuesta por llamada (rompen "cero respuesta").
const ANSWERED_RESULTS = ["interesada", "lo_piensa", "no_interesada", "sin_definir"];

/**
 * Regla del Playbook: un lead baja a Tibio (PROPUESTA) SOLO cuando se cumplen las TRES
 * condiciones JUNTAS:
 *   1. >= 3 intentos de llamada con resultado "No contestó - reintentar".
 *   2. El primero de esos intentos fue hace >= 5 días.
 *   3. Cero respuesta: ninguna llamada contestada (ningún CallAttempt "Contactado - …") NI
 *      ningún WhatsApp entrante del cliente desde el primer intento.
 *
 * Interpretación de "baja a Tibio" = DEGRADAR. Por eso solo aplica a leads que HOY están en
 * NEGOCIACION (Caliente), que es la única etapa por encima de Tibio. NO toca NUEVO/CALIFICADO
 * (ya están en Tibio o por debajo) ni GANADO/PERDIDO (cerrados). *Si Alex quiere ampliarlo a
 * cualquier lead activo sin responder, es cambiar el filtro de crmStage.*
 *
 * IMPORTANTE: hace SOLO el cambio de etapa + una nota de actividad en el chat. **NO dispara
 * seguimientos** — a propósito: no queremos una ráfaga de WhatsApp al correr por primera vez
 * (podría degradar muchos leads a la vez), y menos mientras corre el experimento A/B de leads.
 */
export async function demoteUnresponsiveStaleLeads(): Promise<{ demoted: number }> {
  let candidates: Array<{ id: string; workspaceId: string }> = [];
  try {
    candidates = await prisma.$queryRaw<Array<{ id: string; workspaceId: string }>>`
      WITH nc AS (
        SELECT "contactId", COUNT(*)::int AS cnt, MIN("calledAt") AS first_nc
        FROM "CallAttempt"
        WHERE "result" = ${NO_ANSWER_RESULT}
        GROUP BY "contactId"
      )
      SELECT c."id" AS "id", c."workspaceId" AS "workspaceId"
      FROM "Contact" c
      JOIN nc ON nc."contactId" = c."id"
      WHERE c."crmStage" = 'NEGOCIACION'
        AND c."excludedFromCrm" = false
        AND nc.cnt >= 3
        AND nc.first_nc <= NOW() - INTERVAL '5 days'
        AND NOT EXISTS (
          SELECT 1 FROM "CallAttempt" ca2
          WHERE ca2."contactId" = c."id"
            AND ca2."result" = ANY(${ANSWERED_RESULTS}::text[])
        )
        AND NOT EXISTS (
          SELECT 1 FROM "Message" m
          WHERE m."contactId" = c."id"
            AND m."direction" = 'INBOUND'
            AND m."isStatusBroadcast" = false
            AND m."createdAt" >= nc.first_nc
        )
    `;
  } catch (error) {
    console.error("[demoteUnresponsiveStaleLeads] query error", error);
    return { demoted: 0 };
  }

  let demoted = 0;
  for (const candidate of candidates) {
    try {
      // Guardado con WHERE crmStage='NEGOCIACION' por si otro proceso ya la movió (idempotente).
      const updated = await prisma.$executeRaw`
        UPDATE "Contact"
        SET "crmStage" = 'PROPUESTA', "updatedAt" = NOW()
        WHERE "id" = ${candidate.id} AND "crmStage" = 'NEGOCIACION'
      `;
      if (updated === 0) {
        continue;
      }
      demoted += 1;

      // Nota de actividad en la conversación más reciente (best-effort). NO dispara seguimientos.
      const conversation = await prisma.conversation.findFirst({
        where: { contactId: candidate.id, workspaceId: candidate.workspaceId },
        orderBy: { lastMessageAt: "desc" },
        select: { id: true, channelId: true },
      });
      if (conversation) {
        await recordConversationActivity({
          workspaceId: candidate.workspaceId,
          conversationId: conversation.id,
          channelId: conversation.channelId,
          contactId: candidate.id,
          kind: "stage_changed",
          text: "Se enfrió a Tibio automáticamente: 3 intentos sin respuesta en 5+ días.",
        });
      }
    } catch (error) {
      console.error("[demoteUnresponsiveStaleLeads] update error", candidate.id, error);
    }
  }

  return { demoted };
}
