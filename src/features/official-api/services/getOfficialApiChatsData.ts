import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOfficialApiConfigByWorkspaceId, hasOfficialApiBaseCredentials } from "@/lib/official-api-config";
import type { OfficialApiChatsData } from "@/features/official-api/types/official-api";

function normalizeSearch(value: string | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

type OfficialMessageType = "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "TEMPLATE" | "INTERACTIVE" | "SYSTEM";

type OfficialChatsCacheEntry = {
  expiresAt: number;
  value: OfficialApiChatsData;
};

const OFFICIAL_CHATS_CACHE_TTL_MS = 5000;
const officialChatsCache = new Map<string, OfficialChatsCacheEntry>();

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

function buildOfficialChatsCacheKey(input: {
  workspaceId: string;
  configId: string;
  conversationId?: string;
  q?: string;
  includeSelectedConversation?: boolean;
}) {
  return JSON.stringify({
    workspaceId: input.workspaceId,
    configId: input.configId,
    conversationId: input.conversationId?.trim() || "",
    q: normalizeSearch(input.q),
    includeSelectedConversation: input.includeSelectedConversation ?? true,
  });
}

export async function getOfficialApiChatsData(input: {
  workspaceId: string;
  conversationId?: string;
  q?: string;
  includeSelectedConversation?: boolean;
}): Promise<OfficialApiChatsData> {
  const INITIAL_MESSAGE_LIMIT = 20;
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
  const cacheKey = buildOfficialChatsCacheKey({
    workspaceId: input.workspaceId,
    configId: activeConfig.id,
    conversationId: input.conversationId,
    q: input.q,
    includeSelectedConversation: input.includeSelectedConversation,
  });
  const cachedEntry = officialChatsCache.get(cacheKey);
  if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
    return cachedEntry.value;
  }

  const includeSelectedConversation = input.includeSelectedConversation ?? true;
  const requestedConversationId = input.conversationId?.trim() || "";
  const conversationListLimit = !requestedConversationId && !searchQuery ? 50 : 80;
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

  type OfficialConversationDetailRow = {
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
  };

  async function fetchConversationDetail(conversationId: string) {
    const conversationDetailRows = await prisma.$queryRaw<Array<OfficialConversationDetailRow>>`
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
        LIMIT ${INITIAL_MESSAGE_LIMIT}
      ) m ON true
      WHERE c."id" = ${conversationId}
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
  }

  const selectedConversationPromise =
    includeSelectedConversation && requestedConversationId
      ? fetchConversationDetail(requestedConversationId)
      : null;

  const conversationRows = searchQuery
    ? await prisma.$queryRaw<Array<{
        id: string;
        contactId: string;
        contactName: string | null;
        contactPhoneNumber: string | null;
        contactWaId: string;
        incomingCount: number;
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
          COALESCE(incoming."incomingCount", 0)::int AS "incomingCount",
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
          SELECT MAX(mo."createdAt") AS "lastOutboundAt"
          FROM "OfficialApiMessage" mo
          WHERE mo."conversationId" = c."id"
            AND mo."direction" = 'OUTBOUND'
        ) lo ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS "incomingCount"
          FROM "OfficialApiMessage" mi
          WHERE mi."conversationId" = c."id"
            AND mi."direction" = 'INBOUND'
            AND mi."createdAt" > COALESCE(lo."lastOutboundAt", TIMESTAMP '1970-01-01')
        ) incoming ON true
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
        LIMIT ${conversationListLimit}
      `
    : await prisma.$queryRaw<Array<{
        id: string;
        contactId: string;
        contactName: string | null;
        contactPhoneNumber: string | null;
        contactWaId: string;
        incomingCount: number;
        lastMessageId: string | null;
        lastMessageContent: string | null;
        lastMessageDirection: "INBOUND" | "OUTBOUND" | null;
        lastMessageCreatedAt: Date | null;
        lastMessageStatus: "RECEIVED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | null;
        lastMessageMediaUrl: string | null;
        lastMessageRawPayload: unknown;
      }>>`
        WITH filtered_conversations AS (
          SELECT
            c."id",
            c."contactId",
            c."lastMessageAt",
            c."updatedAt"
          FROM "OfficialApiConversation" c
          WHERE c."configId" = ${activeConfig.id}
          ORDER BY c."lastMessageAt" DESC NULLS LAST, c."updatedAt" DESC
          LIMIT ${conversationListLimit}
        ),
        last_messages AS (
          SELECT DISTINCT ON (m."conversationId")
            m."conversationId",
            m."id",
            m."content",
            m."direction"::text AS "direction",
            m."createdAt",
            m."status"::text AS "status",
            m."mediaUrl",
            m."rawPayload"
          FROM "OfficialApiMessage" m
          INNER JOIN filtered_conversations fc ON fc."id" = m."conversationId"
          ORDER BY m."conversationId", m."createdAt" DESC, m."id" DESC
        ),
        outbound_times AS (
          SELECT
            m."conversationId",
            MAX(m."createdAt") AS "lastOutboundAt"
          FROM "OfficialApiMessage" m
          INNER JOIN filtered_conversations fc ON fc."id" = m."conversationId"
          WHERE m."direction" = 'OUTBOUND'
          GROUP BY m."conversationId"
        ),
        incoming_counts AS (
          SELECT
            m."conversationId",
            COUNT(*)::int AS "incomingCount"
          FROM "OfficialApiMessage" m
          INNER JOIN filtered_conversations fc ON fc."id" = m."conversationId"
          LEFT JOIN outbound_times ot ON ot."conversationId" = m."conversationId"
          WHERE m."direction" = 'INBOUND'
            AND m."createdAt" > COALESCE(ot."lastOutboundAt", TIMESTAMP '1970-01-01')
          GROUP BY m."conversationId"
        )
        SELECT
          fc."id",
          ct."id" AS "contactId",
          ct."name" AS "contactName",
          ct."phoneNumber" AS "contactPhoneNumber",
          ct."waId" AS "contactWaId",
          COALESCE(ic."incomingCount", 0)::int AS "incomingCount",
          lm."id" AS "lastMessageId",
          lm."content" AS "lastMessageContent",
          lm."direction" AS "lastMessageDirection",
          lm."createdAt" AS "lastMessageCreatedAt",
          lm."status" AS "lastMessageStatus",
          lm."mediaUrl" AS "lastMessageMediaUrl",
          lm."rawPayload" AS "lastMessageRawPayload"
        FROM filtered_conversations fc
        INNER JOIN "OfficialApiContact" ct
          ON ct."id" = fc."contactId"
        LEFT JOIN incoming_counts ic
          ON ic."conversationId" = fc."id"
        LEFT JOIN last_messages lm
          ON lm."conversationId" = fc."id"
        ORDER BY fc."lastMessageAt" DESC NULLS LAST, fc."updatedAt" DESC
      `;

  const conversations = conversationRows.slice(0, 50).map((row) => ({
    id: row.id,
    contact: {
      id: row.contactId,
      name: row.contactName,
      phoneNumber: row.contactPhoneNumber,
      waId: row.contactWaId,
    },
    incomingCount: row.incomingCount,
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
    ? await (selectedConversationPromise ?? fetchConversationDetail(selectedConversationId))
    : null;

  const result: OfficialApiChatsData = {
    configId: activeConfig.id,
    isConnected: true,
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      contact: conversation.contact,
      incomingCount: conversation.incomingCount,
      lastMessage: conversation.lastMessage ?? null,
    })),
    selectedConversation,
    selectedConversationId,
    searchQuery,
  };

  officialChatsCache.set(cacheKey, {
    expiresAt: Date.now() + OFFICIAL_CHATS_CACHE_TTL_MS,
    value: result,
  });

  return result;
}
