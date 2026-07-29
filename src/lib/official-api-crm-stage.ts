import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  buildCommercialConversationContext,
  classifyCommercialStage,
  type CommercialConversationContext,
  type CommercialConversationLine,
} from "@/lib/commercial-stage";
import { syncCrmStageFromCommercialStage } from "@/lib/crm-stage-sync";
import { CRM_STAGE_META } from "@/features/crm/domain/crm-config";

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

/**
 * Deja la nota "El agente movió la etapa a X" DENTRO del chat, igual que en el canal viejo.
 *
 * El registro de actividad de siempre escribe en la tabla de mensajes del otro canal, atada a
 * una conversacion que aca no existe: se intentaba, fallaba y se descartaba en silencio, asi
 * que la etapa cambiaba sola y la asesora entraba al chat sin saber por que. Se guarda como
 * mensaje SYSTEM marcado como actividad, que es lo que el chat ya dibuja como chip centrado.
 */
async function recordOfficialApiStageActivity(input: {
  configId: string;
  conversationId: string;
  stageLabel: string;
}) {
  const now = new Date();
  await prisma.$executeRaw`
    INSERT INTO "OfficialApiMessage" (
      "id", "configId", "conversationId", "direction", "type", "status",
      "content", "rawPayload", "createdAt", "updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${input.configId},
      ${input.conversationId},
      'OUTBOUND'::"OfficialApiMessageDirection",
      'SYSTEM'::"OfficialApiMessageType",
      'SENT'::"OfficialApiMessageStatus",
      ${`El agente movió la etapa a "${input.stageLabel}"`},
      ${JSON.stringify({ source: "activity", kind: "stage_changed" })},
      ${now},
      ${now}
    )
  `;
}

export async function syncOfficialApiCrmStage(input: {
  workspaceId: string;
  configId: string;
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
    // Devuelve la etapa nueva, o null si no movio nada.
    const movedTo = await syncCrmStageFromCommercialStage({
      workspaceId: input.workspaceId,
      contactId: row.crmContactId,
      conversationId: input.conversationId,
      // El canal oficial no cuelga de un WhatsAppChannel en estas tablas; el helper lo acepta.
      channelId: null,
      // La nota la dejamos NOSOTROS, abajo, en la tabla del canal oficial. Si se dejara al
      // helper, intentaria escribirla en la tabla del canal viejo con un id que ahi no existe
      // y Postgres rechazaba el INSERT en cada mensaje entrante (visto en los logs el
      // 29-jul-2026: "Message_conversationId_fkey").
      recordActivity: false,
      commercialContext: nextContext,
    });

    if (movedTo) {
      await recordOfficialApiStageActivity({
        configId: input.configId,
        conversationId: input.conversationId,
        stageLabel: CRM_STAGE_META[movedTo]?.label ?? movedTo,
      });
    }
  } catch (error) {
    console.error("[OFFICIAL_API] crm_stage_sync_failed", {
      conversationId: input.conversationId,
      error,
    });
  }
}
