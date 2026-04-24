import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOfficialApiConfigByWorkspaceId, hasOfficialApiBaseCredentials } from "@/lib/official-api-config";
import type { OfficialApiChatsData } from "@/features/official-api/types/official-api";

function normalizeSearch(value: string | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

type OfficialMessageType = "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "TEMPLATE" | "INTERACTIVE" | "SYSTEM";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNestedRecord(value: unknown, key: string) {
  if (!isRecord(value)) return null;
  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function inferOfficialApiMessageType(rawPayload: unknown, mediaUrl: string | null, content: string | null): OfficialMessageType {
  const root = readNestedRecord(rawPayload, "evolution") ?? (isRecord(rawPayload) ? rawPayload : null);
  const data = readNestedRecord(root, "data");
  const message = readNestedRecord(data, "message") ?? readNestedRecord(root, "message");

  if (message) {
    if (readNestedRecord(message, "audioMessage")) return "AUDIO";
    if (readNestedRecord(message, "imageMessage")) return "IMAGE";
    if (readNestedRecord(message, "videoMessage")) return "VIDEO";
    if (readNestedRecord(message, "documentMessage")) return "DOCUMENT";
    if (readNestedRecord(message, "templateMessage")) return "TEMPLATE";
    if (readNestedRecord(message, "interactiveMessage")) return "INTERACTIVE";
  }

  if (mediaUrl) {
    const normalized = mediaUrl.toLowerCase();
    if (/\.(ogg|oga|mp3|wav|m4a|aac|opus|webm)(\?|$)/.test(normalized)) return "AUDIO";
    if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/.test(normalized)) return "IMAGE";
    if (/\.(mp4|mov|avi|mkv|webm)(\?|$)/.test(normalized)) return "VIDEO";
    return "DOCUMENT";
  }

  if (content?.trim()) {
    return "TEXT";
  }

  return "TEXT";
}

export async function getOfficialApiChatsData(input: {
  workspaceId: string;
  conversationId?: string;
  q?: string;
  includeSelectedConversation?: boolean;
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
  const includeSelectedConversation = input.includeSelectedConversation ?? true;
  const officialSearchFilter = searchQuery
    ? Prisma.sql`
      AND (
        ct."name" ILIKE ${`%${searchQuery}%`}
        OR ct."phoneNumber" ILIKE ${`%${searchQuery}%`}
        OR ct."waId" ILIKE ${`%${searchQuery}%`}
        OR lm."content" ILIKE ${`%${searchQuery}%`}
      )
    `
    : Prisma.empty;

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
    lastMessageMediaUrl: string | null;
    lastMessageRawPayload: unknown;
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
      lm."status"::text AS "lastMessageStatus",
      lm."mediaUrl" AS "lastMessageMediaUrl",
      lm."rawPayload" AS "lastMessageRawPayload"
    FROM "OfficialApiConversation" c
    INNER JOIN "OfficialApiContact" ct
      ON ct."id" = c."contactId"
    LEFT JOIN LATERAL (
      SELECT
        m."id",
        m."content",
        m."direction",
        m."createdAt",
        m."status",
        m."mediaUrl",
        m."rawPayload"
      FROM "OfficialApiMessage" m
      WHERE m."conversationId" = c."id"
      ORDER BY m."createdAt" DESC
      LIMIT 1
    ) lm ON true
    WHERE c."configId" = ${activeConfig.id}
      ${officialSearchFilter}
    ORDER BY c."lastMessageAt" DESC NULLS LAST, c."updatedAt" DESC
    LIMIT 80
  `;

  const conversations = conversationRows.slice(0, 50).map((row) => ({
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
          type: inferOfficialApiMessageType(row.lastMessageRawPayload, row.lastMessageMediaUrl, row.lastMessageContent),
        }
      : null,
  }));

  const selectedConversationId = input.conversationId?.trim() || conversations[0]?.id || "";

  const selectedConversation = includeSelectedConversation && selectedConversationId
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
            m."mediaUrl" AS "messageMediaUrl",
            m."rawPayload" AS "messageRawPayload"
          FROM "OfficialApiConversation" c
          INNER JOIN "OfficialApiContact" ct
            ON ct."id" = c."contactId"
          LEFT JOIN LATERAL (
            SELECT
              msg."id",
              msg."content",
              msg."direction",
              msg."createdAt",
              msg."status",
              msg."mediaUrl",
              msg."rawPayload"
            FROM "OfficialApiMessage" msg
            WHERE msg."conversationId" = c."id"
            ORDER BY msg."createdAt" DESC
            LIMIT 120
          ) m ON true
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
              type: inferOfficialApiMessageType(row.messageRawPayload, row.messageMediaUrl, row.messageContent),
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
