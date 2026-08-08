import { after } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOfficialApiConfigByWorkspaceId, hasOfficialApiBaseCredentials } from "@/lib/official-api-config";
import { downloadOfficialApiMedia, extractMediaRefFromRawPayload } from "@/lib/official-api-media";
import type { OfficialApiChatsData } from "@/features/official-api/types/official-api";

function normalizeSearch(value: string | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

type OfficialMessageType =
  | "TEXT"
  | "IMAGE"
  | "AUDIO"
  | "VIDEO"
  | "DOCUMENT"
  | "TEMPLATE"
  | "INTERACTIVE"
  | "SYSTEM"
  // Ubicación y tarjeta de contacto: el cliente las manda y antes se veían como burbuja vacía.
  | "LOCATION"
  | "CONTACTS";

// Mismo juego de valores que usa la bandeja para el canal viejo.
export type OfficialChatsStatusFilter = "all" | "open" | "resolved";
/**
 * Las pestañas Mias / Sin asignar / Todas, tambien para el canal oficial.
 *
 * Sus chats viven en otra tabla y se leen con otra consulta, y esa consulta no sabia nada de a
 * quien estaban asignados: sus 37 conversaciones caian en la bandeja con CUALQUIER filtro puesto.
 * Se veia "Mias 1" y abajo treinta y ocho chats, la mayoria de otras asesoras.
 */
export type OfficialChatsAssignedFilter = "all" | "mine" | "unassigned";

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

/**
 * Tipo del mensaje. Manda el tipo GUARDADO (el webhook ya sabe si vino una foto, un audio o un
 * PDF); adivinar solo queda como respaldo para mensajes viejos que se guardaron sin tipo.
 */
function resolveOfficialApiMessageType(input: {
  storedType: string | null;
  rawPayload: unknown;
  mediaUrl: string | null;
  content: string | null;
}): OfficialMessageType {
  const stored = input.storedType?.trim().toUpperCase() ?? "";
  if (stored && stored !== "TEXT") {
    return stored as OfficialMessageType;
  }

  return inferOfficialApiMessageType(input.rawPayload, input.mediaUrl, input.content);
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
  statusFilter?: OfficialChatsStatusFilter;
  assignedFilter?: OfficialChatsAssignedFilter;
  currentUserId?: string;
}) {
  return JSON.stringify({
    workspaceId: input.workspaceId,
    configId: input.configId,
    conversationId: input.conversationId?.trim() || "",
    q: normalizeSearch(input.q),
    includeSelectedConversation: input.includeSelectedConversation ?? true,
    statusFilter: input.statusFilter ?? "open",
    // Quien mira tambien entra en la clave: sin esto, "Mias" de una asesora servia el resultado
    // cacheado de otra, o el de "Todas" que se pidio un segundo antes.
    assignedFilter: input.assignedFilter ?? "all",
    currentUserId: input.currentUserId ?? "",
  });
}

/**
 * RED DE CONTENCIÓN: si leer los chats de la API oficial falla, la bandeja NO se cae.
 *
 * Esta función se llama desde el Server Component de /cliente/chats sin protección, así que
 * cualquier error suyo (una consulta mal escrita, un timeout de la base) reventaba la pantalla
 * ENTERA con "Application error", incluidos los chats de Evolution que no tienen nada que ver —
 * y como la página se refresca sola cada 8s, se volvía a romper una y otra vez.
 *
 * Ahora un fallo degrada a "no hay chats oficiales" y el resto de la bandeja sigue funcionando.
 */
export async function getOfficialApiChatsData(input: {
  workspaceId: string;
  conversationId?: string;
  q?: string;
  includeSelectedConversation?: boolean;
  statusFilter?: OfficialChatsStatusFilter;
  assignedFilter?: OfficialChatsAssignedFilter;
  /** Quien esta mirando la bandeja. Hace falta para resolver "Mias". */
  currentUserId?: string;
}): Promise<OfficialApiChatsData> {
  try {
    return await loadOfficialApiChatsData(input);
  } catch (error) {
    console.error("[OFFICIAL_API] chats_data_failed", { workspaceId: input.workspaceId, error });
    return {
      configId: null,
      isConnected: false,
      conversations: [],
      selectedConversation: null,
      selectedConversationId: "",
      searchQuery: normalizeSearch(input.q),
    };
  }
}

async function loadOfficialApiChatsData(input: {
  workspaceId: string;
  conversationId?: string;
  q?: string;
  includeSelectedConversation?: boolean;
  statusFilter?: OfficialChatsStatusFilter;
  assignedFilter?: OfficialChatsAssignedFilter;
  /** Quien esta mirando la bandeja. Hace falta para resolver "Mias". */
  currentUserId?: string;
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
    statusFilter: input.statusFilter,
    assignedFilter: input.assignedFilter,
    currentUserId: input.currentUserId,
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

  // Mismo criterio que el canal viejo: por defecto la bandeja muestra SOLO las abiertas.
  // Sin esto, darle "Resolver" a un chat oficial no lo sacaba de la lista: se resolvia de
  // verdad (la cabecera pasaba a "Reabrir") pero seguia ahi, asi que la bandeja nunca bajaba.
  const officialStatusFilter =
    input.statusFilter === "resolved"
      ? Prisma.sql`AND c."status"::text IN ('CLOSED', 'ARCHIVED')`
      : input.statusFilter === "all"
        ? Prisma.empty
        : Prisma.sql`AND c."status"::text IN ('OPEN', 'PENDING')`;

  /**
   * Mismo filtro de asignacion que la bandeja del canal viejo.
   *
   * "Mias" sin saber quien mira NO puede resolverse: en ese caso no se devuelve nada, en vez de
   * devolver todo. Es la diferencia entre una lista vacia (se nota y se reporta) y una lista con
   * los chats de otras asesoras adentro (parecen fantasmas y alguien pide borrarlos).
   */
  const currentUserId = input.currentUserId?.trim() || "";
  const officialAssignedFilter =
    input.assignedFilter === "unassigned"
      ? Prisma.sql`AND c."assignedToUserId" IS NULL`
      : input.assignedFilter === "mine"
        ? currentUserId
          ? Prisma.sql`AND c."assignedToUserId" = ${currentUserId}`
          : Prisma.sql`AND false`
        : Prisma.empty;

  type OfficialConversationDetailRow = {
    conversationId: string;
    conversationStatus: "OPEN" | "PENDING" | "CLOSED" | "ARCHIVED";
    conversationAutomationPaused: boolean | null;
    contactId: string;
    contactName: string | null;
    contactPhoneNumber: string | null;
    contactWaId: string;
    // Ficha del MISMO cliente en el CRM. Sin esto la cabecera del chat no tenia a quien
    // cambiarle la etapa y mostraba "Nuevo" fijo, sin poder tocarlo.
    crmContactId: string | null;
    crmStage: string | null;
    assignedToUserId: string | null;
    assignedToName: string | null;
    assignedToEmail: string | null;
    messageId: string | null;
    messageContent: string | null;
    messageDirection: "INBOUND" | "OUTBOUND" | null;
    messageCreatedAt: Date | null;
    messageStatus: "RECEIVED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | null;
    // Tipo REAL guardado por el webhook. Antes no se leía y el tipo se adivinaba desde el
    // rawPayload buscando claves de Evolution, que en la API oficial no existen: toda la media
    // entrante terminaba mostrándose como texto.
    messageType: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "TEMPLATE" | "INTERACTIVE" | "SYSTEM" | null;
    messageMediaUrl: string | null;
    messageRawPayload: unknown;
    // Motivo por el que WhatsApp rechazo el envio, para no dejar un triangulito mudo.
    messageErrorDetail: string | null;
  };

  async function fetchConversationDetail(conversationId: string) {
    const conversationDetailRows = await prisma.$queryRaw<Array<OfficialConversationDetailRow>>`
      SELECT
        c."id" AS "conversationId",
        c."status"::text AS "conversationStatus",
        c."automationPaused" AS "conversationAutomationPaused",
        ct."id" AS "contactId",
        ct."name" AS "contactName",
        ct."phoneNumber" AS "contactPhoneNumber",
        ct."waId" AS "contactWaId",
        ct."crmContactId" AS "crmContactId",
        crm."crmStage"::text AS "crmStage",
        c."assignedToUserId" AS "assignedToUserId",
        au."name" AS "assignedToName",
        au."email" AS "assignedToEmail",
        m."id" AS "messageId",
        m."content" AS "messageContent",
        m."direction"::text AS "messageDirection",
        m."createdAt" AS "messageCreatedAt",
        m."status"::text AS "messageStatus",
        m."type"::text AS "messageType",
        m."mediaUrl" AS "messageMediaUrl",
        m."rawPayload" AS "messageRawPayload",
        m."errorDetail" AS "messageErrorDetail"
      FROM "OfficialApiConversation" c
      INNER JOIN "OfficialApiContact" ct
        ON ct."id" = c."contactId"
      -- La ficha del CRM puede no existir todavia (chats anteriores al puente), por eso LEFT.
      LEFT JOIN "Contact" crm
        ON crm."id" = ct."crmContactId"
      -- Quien atiende el chat, para el selector de asignacion de la cabecera.
      LEFT JOIN "User" au
        ON au."id" = c."assignedToUserId"
      LEFT JOIN LATERAL (
        SELECT
          msg."id",
          msg."content",
          msg."direction",
          msg."createdAt",
          msg."status",
          -- El tipo REAL del mensaje: sin esto en el LATERAL, el m."type" de arriba no existe
          -- y la consulta entera falla (pantalla de error al abrir el canal).
          msg."type",
          msg."mediaUrl",
          msg."rawPayload",
          msg."errorDetail"
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

    // Marcar como leidos los entrantes al ABRIR el chat, igual que hace /live en el canal
    // viejo. Sin esto el globo verde se quedaba pegado: la asesora entraba, leia, y el chat
    // seguia figurando con mensajes sin ver hasta que respondia.
    // Diferido con after() para no demorar la apertura; si falla, se reintenta al reabrir.
    after(async () => {
      try {
        await prisma.$executeRaw`
          UPDATE "OfficialApiMessage"
          SET "readAt" = CURRENT_TIMESTAMP
          WHERE "conversationId" = ${conversationId}
            AND "configId" = ${activeConfig.id}
            AND "direction" = 'INBOUND'
            AND "readAt" IS NULL
        `;
      } catch (error) {
        console.error("[OFFICIAL_API] mark_read_failed", { conversationId, error });
      }
    });

    // AUTO-RECUPERACIÓN de archivos viejos. Los mensajes que entraron antes de que existiera la
    // descarga quedaron sin archivo (una burbuja "Foto" cargando para siempre), pero el
    // identificador de Meta quedó guardado y Meta conserva el archivo ~30 días. Al abrir el chat
    // se bajan los que falten, en segundo plano (after) para no demorar la pantalla, con un tope
    // por render para no dispararle a Graph de a cientos.
    const pendingMedia = conversationDetailRows
      .filter(
        (row) =>
          row.messageId &&
          !row.messageMediaUrl &&
          ["IMAGE", "AUDIO", "VIDEO", "DOCUMENT"].includes(row.messageType ?? ""),
      )
      .slice(0, 10);

    if (pendingMedia.length > 0 && activeConfig.accessToken) {
      const accessToken = activeConfig.accessToken;
      const configId = activeConfig.id;

      after(async () => {
        for (const row of pendingMedia) {
          try {
            const externalIdRows = await prisma.$queryRaw<Array<{ externalMessageId: string | null }>>`
              SELECT "externalMessageId" FROM "OfficialApiMessage" WHERE "id" = ${row.messageId} LIMIT 1
            `;
            const externalMessageId = externalIdRows[0]?.externalMessageId?.trim();
            if (!externalMessageId) {
              continue;
            }

            const ref = extractMediaRefFromRawPayload(row.messageRawPayload, externalMessageId);
            if (!ref) {
              continue;
            }

            const media = await downloadOfficialApiMedia({
              mediaId: ref.mediaId,
              accessToken,
              mediaType: ref.mediaType,
            });
            if (!media) {
              continue;
            }

            await prisma.$executeRaw`
              UPDATE "OfficialApiMessage"
              SET "mediaUrl" = ${media.mediaUrl}, "updatedAt" = CURRENT_TIMESTAMP
              WHERE "id" = ${row.messageId} AND "configId" = ${configId}
            `;
          } catch (error) {
            console.error("[OFFICIAL_API] media_backfill_failed", { messageId: row.messageId, error });
          }
        }
      });
    }

    const firstRow = conversationDetailRows[0];
    return {
      id: firstRow.conversationId,
      contact: {
        id: firstRow.contactId,
        name: firstRow.contactName,
        phoneNumber: firstRow.contactPhoneNumber,
        waId: firstRow.contactWaId,
        crmContactId: firstRow.crmContactId,
        crmStage: firstRow.crmStage,
      },
      assignedTo: firstRow.assignedToUserId
        ? { id: firstRow.assignedToUserId, name: firstRow.assignedToName, email: firstRow.assignedToEmail ?? "" }
        : null,
      status: firstRow.conversationStatus,
      automationPaused: Boolean(firstRow.conversationAutomationPaused),
      messages: conversationDetailRows
        .filter((row) => row.messageId && row.messageDirection && row.messageCreatedAt && row.messageStatus)
        .map((row) => ({
          id: row.messageId!,
          content: row.messageContent,
          direction: row.messageDirection!,
          createdAt: new Date(row.messageCreatedAt!),
          status: row.messageStatus!,
          type: resolveOfficialApiMessageType({
            storedType: row.messageType,
            rawPayload: row.messageRawPayload,
            mediaUrl: row.messageMediaUrl,
            content: row.messageContent,
          }),
          mediaUrl: row.messageMediaUrl,
          rawPayload: row.messageRawPayload,
          errorDetail: row.messageErrorDetail,
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
        crmContactId: string | null;
        crmStage: string | null;
        assignedToUserId: string | null;
        assignedToName: string | null;
        assignedToEmail: string | null;
        incomingCount: number;
        lastMessageId: string | null;
        lastMessageContent: string | null;
        lastMessageDirection: "INBOUND" | "OUTBOUND" | null;
        lastMessageCreatedAt: Date | null;
        lastMessageStatus: "RECEIVED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | null;
        lastMessageType: string | null;
        lastMessageMediaUrl: string | null;
        lastMessageRawPayload: unknown;
      }>>`
        SELECT
          c."id",
          ct."id" AS "contactId",
          ct."name" AS "contactName",
          ct."phoneNumber" AS "contactPhoneNumber",
          ct."waId" AS "contactWaId",
          ct."crmContactId" AS "crmContactId",
          crm."crmStage"::text AS "crmStage",
          c."assignedToUserId" AS "assignedToUserId",
          au."name" AS "assignedToName",
          au."email" AS "assignedToEmail",
          COALESCE(incoming."incomingCount", 0)::int AS "incomingCount",
          lm."id" AS "lastMessageId",
          lm."content" AS "lastMessageContent",
          lm."direction"::text AS "lastMessageDirection",
          lm."createdAt" AS "lastMessageCreatedAt",
          lm."status"::text AS "lastMessageStatus",
          lm."type"::text AS "lastMessageType",
          lm."mediaUrl" AS "lastMessageMediaUrl",
          lm."rawPayload" AS "lastMessageRawPayload"
        FROM "OfficialApiConversation" c
        INNER JOIN "OfficialApiContact" ct
          ON ct."id" = c."contactId"
        -- Etapa del embudo para pintar la chapita (Nuevo / Frio / Tibio...) en la lista.
        LEFT JOIN "Contact" crm
          ON crm."id" = ct."crmContactId"
        -- Quien atiende el chat, para el badge de la fila.
        LEFT JOIN "User" au
          ON au."id" = c."assignedToUserId"
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
            -- Sin esto el globo verde solo se iba al RESPONDER: entrar al chat no lo bajaba,
            -- porque el conteo miraba unicamente si habia un mensaje tuyo mas nuevo.
            AND mi."readAt" IS NULL
            AND mi."createdAt" > COALESCE(lo."lastOutboundAt", TIMESTAMP '1970-01-01')
        ) incoming ON true
        LEFT JOIN LATERAL (
          SELECT
            m."id",
            m."content",
            m."direction",
            m."createdAt",
            m."status",
            -- Se proyecta el tipo para poder previsualizar bien la última foto/audio/PDF en la
            -- lista (antes se adivinaba y salía como texto vacío).
            m."type",
            m."mediaUrl",
            m."rawPayload"
          FROM "OfficialApiMessage" m
          WHERE m."conversationId" = c."id"
            -- Las notas de actividad ("El agente movió la etapa...") no son el ultimo mensaje
            -- del chat: si se colaran aca, taparian lo que de verdad escribio el cliente.
            AND (m."rawPayload"->>'source') IS DISTINCT FROM 'activity'
          ORDER BY m."createdAt" DESC
          LIMIT 1
        ) lm ON true
        WHERE c."configId" = ${activeConfig.id}
          ${officialStatusFilter}
          ${officialAssignedFilter}
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
        crmContactId: string | null;
        crmStage: string | null;
        assignedToUserId: string | null;
        assignedToName: string | null;
        assignedToEmail: string | null;
        incomingCount: number;
        lastMessageId: string | null;
        lastMessageContent: string | null;
        lastMessageDirection: "INBOUND" | "OUTBOUND" | null;
        lastMessageCreatedAt: Date | null;
        lastMessageStatus: "RECEIVED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | null;
        lastMessageType: string | null;
        lastMessageMediaUrl: string | null;
        lastMessageRawPayload: unknown;
      }>>`
        WITH filtered_conversations AS (
          SELECT
            c."id",
            c."contactId",
            c."lastMessageAt",
            c."updatedAt",
            c."assignedToUserId"
          FROM "OfficialApiConversation" c
          WHERE c."configId" = ${activeConfig.id}
            ${officialStatusFilter}
            ${officialAssignedFilter}
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
            m."type"::text AS "type",
            m."mediaUrl",
            m."rawPayload"
          FROM "OfficialApiMessage" m
          INNER JOIN filtered_conversations fc ON fc."id" = m."conversationId"
          -- Idem: la nota de actividad no debe pisar la vista previa de la fila.
          WHERE (m."rawPayload"->>'source') IS DISTINCT FROM 'activity'
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
            -- Mismo criterio que la consulta sin busqueda: leido = no cuenta.
            AND m."readAt" IS NULL
            AND m."createdAt" > COALESCE(ot."lastOutboundAt", TIMESTAMP '1970-01-01')
          GROUP BY m."conversationId"
        )
        SELECT
          fc."id",
          ct."id" AS "contactId",
          ct."name" AS "contactName",
          ct."phoneNumber" AS "contactPhoneNumber",
          ct."waId" AS "contactWaId",
          ct."crmContactId" AS "crmContactId",
          crm."crmStage"::text AS "crmStage",
          fc."assignedToUserId" AS "assignedToUserId",
          au."name" AS "assignedToName",
          au."email" AS "assignedToEmail",
          COALESCE(ic."incomingCount", 0)::int AS "incomingCount",
          lm."id" AS "lastMessageId",
          lm."content" AS "lastMessageContent",
          lm."direction" AS "lastMessageDirection",
          lm."createdAt" AS "lastMessageCreatedAt",
          lm."status" AS "lastMessageStatus",
          lm."type" AS "lastMessageType",
          lm."mediaUrl" AS "lastMessageMediaUrl",
          lm."rawPayload" AS "lastMessageRawPayload"
        FROM filtered_conversations fc
        INNER JOIN "OfficialApiContact" ct
          ON ct."id" = fc."contactId"
        -- Etapa del embudo para pintar la chapita (Nuevo / Frio / Tibio...) en la lista.
        LEFT JOIN "Contact" crm
          ON crm."id" = ct."crmContactId"
        -- Quien atiende el chat, para el badge de la fila.
        LEFT JOIN "User" au
          ON au."id" = fc."assignedToUserId"
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
      crmContactId: row.crmContactId,
      crmStage: row.crmStage,
    },
    assignedTo: row.assignedToUserId
      ? { id: row.assignedToUserId, name: row.assignedToName, email: row.assignedToEmail ?? "" }
      : null,
    incomingCount: row.incomingCount,
    lastMessage: row.lastMessageId && row.lastMessageDirection && row.lastMessageCreatedAt && row.lastMessageStatus
      ? {
          id: row.lastMessageId,
          content: row.lastMessageContent,
          direction: row.lastMessageDirection,
          createdAt: new Date(row.lastMessageCreatedAt),
          status: row.lastMessageStatus,
          type: resolveOfficialApiMessageType({
            storedType: row.lastMessageType,
            rawPayload: row.lastMessageRawPayload,
            mediaUrl: row.lastMessageMediaUrl,
            content: row.lastMessageContent,
          }),
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
      assignedTo: conversation.assignedTo ?? null,
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
