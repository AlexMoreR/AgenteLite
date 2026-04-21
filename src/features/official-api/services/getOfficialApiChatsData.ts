import { prisma } from "@/lib/prisma";
import { getOfficialApiConfigByWorkspaceId, hasOfficialApiBaseCredentials } from "@/lib/official-api-config";
import type { OfficialApiChatsData } from "@/features/official-api/types/official-api";

function normalizeSearch(value: string | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

export async function getOfficialApiChatsData(input: {
  workspaceId: string;
  conversationId?: string;
  q?: string;
}): Promise<OfficialApiChatsData> {
  const config = await getOfficialApiConfigByWorkspaceId(input.workspaceId);
  const searchQuery = normalizeSearch(input.q);

  if (!config || !hasOfficialApiBaseCredentials(config)) {
    return {
      configId: config?.id ?? null,
      isConnected: false,
      conversations: [],
      selectedConversation: null,
      selectedConversationId: "",
      searchQuery,
    };
  }
  const activeConfig = config;

  const conversationRows = await prisma.$queryRaw<Array<{
    id: string;
    contactId: string;
    contactName: string | null;
    contactPhoneNumber: string | null;
    contactWaId: string;
    lastMessageId: string | null;
    lastMessageContent: string | null;
    lastMessageDirection: "INBOUND" | "OUTBOUND" | null;
    lastMessageCreatedAt: Date | null;
    lastMessageStatus: "RECEIVED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | null;
  }>>`
    SELECT
      c."id",
      ct."id" AS "contactId",
      ct."name" AS "contactName",
      ct."phoneNumber" AS "contactPhoneNumber",
      ct."waId" AS "contactWaId",
      lm."id" AS "lastMessageId",
      lm."content" AS "lastMessageContent",
      lm."direction"::text AS "lastMessageDirection",
      lm."createdAt" AS "lastMessageCreatedAt",
      lm."status"::text AS "lastMessageStatus"
    FROM "OfficialApiConversation" c
    INNER JOIN "OfficialApiContact" ct
      ON ct."id" = c."contactId"
    LEFT JOIN LATERAL (
      SELECT
        m."id",
        m."content",
        m."direction",
        m."createdAt",
        m."status"
      FROM "OfficialApiMessage" m
      WHERE m."conversationId" = c."id"
      ORDER BY m."createdAt" DESC
      LIMIT 1
    ) lm ON true
    WHERE c."configId" = ${activeConfig.id}
    ORDER BY c."lastMessageAt" DESC NULLS LAST, c."updatedAt" DESC
  `;

  const filteredRows = searchQuery
    ? conversationRows.filter((row) => {
        const query = searchQuery.toLowerCase();
        return [
          row.contactName ?? "",
          row.contactPhoneNumber ?? "",
          row.contactWaId ?? "",
          row.lastMessageContent ?? "",
        ].some((value) => value.toLowerCase().includes(query));
      })
    : conversationRows;

  const conversations = filteredRows.slice(0, 50).map((row) => ({
    id: row.id,
    contact: {
      id: row.contactId,
      name: row.contactName,
      phoneNumber: row.contactPhoneNumber,
      waId: row.contactWaId,
    },
    lastMessage: row.lastMessageId && row.lastMessageDirection && row.lastMessageCreatedAt && row.lastMessageStatus
      ? {
          id: row.lastMessageId,
          content: row.lastMessageContent,
          direction: row.lastMessageDirection,
          createdAt: new Date(row.lastMessageCreatedAt),
          status: row.lastMessageStatus,
        }
      : null,
  }));

  const selectedConversationId = input.conversationId?.trim() || conversations[0]?.id || "";

  const selectedConversation = selectedConversationId
    ? await (async () => {
        const conversationDetailRows = await prisma.$queryRaw<Array<{
          conversationId: string;
          contactId: string;
          contactName: string | null;
          contactPhoneNumber: string | null;
          contactWaId: string;
          messageId: string | null;
          messageContent: string | null;
          messageDirection: "INBOUND" | "OUTBOUND" | null;
          messageCreatedAt: Date | null;
          messageStatus: "RECEIVED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | null;
          messageType: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "TEMPLATE" | "INTERACTIVE" | "SYSTEM" | null;
          messageMediaUrl: string | null;
          messageRawPayload: unknown;
        }>>`
          SELECT
            c."id" AS "conversationId",
            ct."id" AS "contactId",
            ct."name" AS "contactName",
            ct."phoneNumber" AS "contactPhoneNumber",
            ct."waId" AS "contactWaId",
            m."id" AS "messageId",
            m."content" AS "messageContent",
            m."direction"::text AS "messageDirection",
            m."createdAt" AS "messageCreatedAt",
            m."status"::text AS "messageStatus",
            m."type"::text AS "messageType",
            m."mediaUrl" AS "messageMediaUrl",
            m."rawPayload" AS "messageRawPayload"
          FROM "OfficialApiConversation" c
          INNER JOIN "OfficialApiContact" ct
            ON ct."id" = c."contactId"
          LEFT JOIN "OfficialApiMessage" m
            ON m."conversationId" = c."id"
          WHERE c."id" = ${selectedConversationId}
            AND c."configId" = ${activeConfig.id}
          ORDER BY m."createdAt" ASC NULLS FIRST
        `;

        if (conversationDetailRows.length === 0) {
          return null;
        }

        const firstRow = conversationDetailRows[0];
        return {
          id: firstRow.conversationId,
          contact: {
            id: firstRow.contactId,
            name: firstRow.contactName,
            phoneNumber: firstRow.contactPhoneNumber,
            waId: firstRow.contactWaId,
          },
          messages: conversationDetailRows
            .filter((row) => row.messageId && row.messageDirection && row.messageCreatedAt && row.messageStatus)
            .map((row) => ({
              id: row.messageId!,
              content: row.messageContent,
              direction: row.messageDirection!,
              createdAt: new Date(row.messageCreatedAt!),
              status: row.messageStatus!,
              type: row.messageType || "TEXT",
              mediaUrl: row.messageMediaUrl,
              rawPayload: row.messageRawPayload,
            })),
        };
      })()
    : null;

  return {
    configId: activeConfig.id,
    isConnected: true,
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      contact: conversation.contact,
      lastMessage: conversation.lastMessage ?? null,
    })),
    selectedConversation,
    selectedConversationId,
    searchQuery,
  };
}
