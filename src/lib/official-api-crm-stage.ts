import { prisma } from "@/lib/prisma";
import {
  buildCommercialConversationContext,
  classifyCommercialStage,
  type CommercialConversationContext,
  type CommercialConversationLine,
} from "@/lib/commercial-stage";
import { syncCrmStageFromCommercialStage } from "@/lib/crm-stage-sync";

/**
 * Clasificador automatico de etapa para el canal de API OFICIAL.
 *
 * El canal viejo ya venia leyendo cada mensaje del cliente para deducir en que etapa del
 * embudo esta (si pidio precio, si ya vio fotos, si pregunto por el envio...) y llevar eso a
 * Contact.crmStage. El canal oficial tiene su propio webhook y nunca lo llamaba: los chats de
 * ese numero se quedaban en la etapa que alguien les pusiera A MANO, y en la practica en
 * "Nuevo" para siempre, ensuciando el Kanban y el informe.
 *
 * Corre en CADA mensaje entrante y NO depende de que el canal tenga un agente vinculado: la
 * asesora puede estar respondiendo a mano y las etapas igual se acomodan solas.
 *
 * Nunca tumba el webhook: si algo falla, el mensaje ya quedo guardado y respondido.
 */
const HISTORY_LIMIT = 12;

function readStoredContext(value: unknown): CommercialConversationContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as CommercialConversationContext;
}

export async function syncOfficialApiCrmStage(input: {
  workspaceId: string;
  conversationId: string;
  latestUserMessage: string | null;
}): Promise<void> {
  try {
    const conversationRows = await prisma.$queryRaw<
      Array<{
        commercialContext: unknown;
        activeProductContext: unknown;
        crmContactId: string | null;
      }>
    >`
      SELECT
        c."commercialContext" AS "commercialContext",
        c."activeProductContext" AS "activeProductContext",
        ct."crmContactId" AS "crmContactId"
      FROM "OfficialApiConversation" c
      INNER JOIN "OfficialApiContact" ct ON ct."id" = c."contactId"
      WHERE c."id" = ${input.conversationId}
      LIMIT 1
    `;

    const row = conversationRows[0];
    if (!row) {
      return;
    }

    // Sin ficha en el CRM no hay a quien moverle la etapa. Pasa en chats viejos, anteriores
    // al puente; el proximo mensaje de ese cliente ya la crea y ahi si se clasifica.
    if (!row.crmContactId) {
      return;
    }

    const historyRows = await prisma.$queryRaw<
      Array<{ direction: "INBOUND" | "OUTBOUND"; content: string | null; type: string | null; mediaUrl: string | null }>
    >`
      SELECT m."direction"::text AS "direction", m."content", m."type"::text AS "type", m."mediaUrl"
      FROM "OfficialApiMessage" m
      WHERE m."conversationId" = ${input.conversationId}
      ORDER BY m."createdAt" DESC
      LIMIT ${HISTORY_LIMIT}
    `;

    // De mas viejo a mas nuevo: el clasificador lee el hilo en orden.
    const history: CommercialConversationLine[] = historyRows
      .slice()
      .reverse()
      .map((message) => ({
        direction: message.direction,
        content: message.content,
        type: (message.type ?? "TEXT") as CommercialConversationLine["type"],
        mediaUrl: message.mediaUrl,
      }));

    const previousContext = readStoredContext(row.commercialContext);
    const activeProductContext =
      row.activeProductContext && typeof row.activeProductContext === "object" && !Array.isArray(row.activeProductContext)
        ? (row.activeProductContext as Record<string, unknown>)
        : undefined;

    const stage = classifyCommercialStage({
      latestUserMessage: input.latestUserMessage ?? "",
      history,
      activeProductContext,
      previousStage: previousContext?.currentStage ?? null,
      commercialContext: previousContext,
    });

    const nextContext = buildCommercialConversationContext({
      stage,
      latestUserMessage: input.latestUserMessage ?? "",
      history,
      activeProductContext,
      previousContext,
    });

    await prisma.officialApiConversation.update({
      where: { id: input.conversationId },
      data: { commercialContext: nextContext as unknown as object },
    });

    // El helper solo AVANZA y nunca toca un lead que una persona ya cerro (Ganado/Descartado).
    await syncCrmStageFromCommercialStage({
      workspaceId: input.workspaceId,
      contactId: row.crmContactId,
      conversationId: input.conversationId,
      // El canal oficial no cuelga de un WhatsAppChannel en estas tablas; el helper lo acepta.
      channelId: null,
      commercialContext: nextContext,
    });
  } catch (error) {
    console.error("[OFFICIAL_API] crm_stage_sync_failed", {
      conversationId: input.conversationId,
      error,
    });
  }
}
