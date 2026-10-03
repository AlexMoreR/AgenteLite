import { prisma } from "@/lib/prisma";
import { recordConversationActivity } from "@/lib/conversation-activity";
import {
  DIAS_DESDE_SU_ULTIMO_MENSAJE,
  INTENTOS_SIN_RESPUESTA,
  contactosQueBajan,
} from "@/features/crm/services/bajada-por-inactividad";

/**
 * Desde el 03-10-2026 la regla vive en bajada-por-inactividad.ts, compartida con el reloj de Tibio
 * a Frio. Antes contaba solo LLAMADAS "No contesto" (los mensajes de la asesora no eran intentos)
 * y no protegia a quien tenia cotizacion ni a quien tenia proximo contacto agendado.
 *
 * Lo que sigue es como era (queda como historia):
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
    candidates = await contactosQueBajan("NEGOCIACION");
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

      // La marca que permite devolverlo a Caliente si contesta (ver recalentarLeadSiRespondio).
      const contacto = await prisma.contact.findUnique({ where: { id: candidate.id }, select: { metadata: true } });
      const metadata =
        contacto?.metadata && typeof contacto.metadata === "object" && !Array.isArray(contacto.metadata)
          ? (contacto.metadata as Record<string, unknown>)
          : {};
      await prisma.contact.update({
        where: { id: candidate.id },
        data: { metadata: { ...metadata, enfriadoEl: new Date().toISOString(), enfriadoDesde: "NEGOCIACION" } as object },
      });

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
          text: `Se enfrió a Tibio: ${INTENTOS_SIN_RESPUESTA} intentos nuestros sin respuesta y ${DIAS_DESDE_SU_ULTIMO_MENSAJE} días sin escribir.`,
        });
      }
    } catch (error) {
      console.error("[demoteUnresponsiveStaleLeads] update error", candidate.id, error);
    }
  }

  return { demoted };
}
