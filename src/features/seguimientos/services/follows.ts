import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  sendEvolutionAudioMessage,
  sendEvolutionDocumentMessage,
  sendEvolutionImageMessage,
  sendEvolutionTextMessageWithReconnect,
  sendEvolutionVideoMessage,
} from "@/lib/evolution";
import { prisma } from "@/lib/prisma";
import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";

export type FollowSourceType = "FLOW" | "PRODUCT" | "TAG" | "CRM_STAGE" | "MANUAL";
export type FollowTimeType = "MINUTES" | "HOURS" | "DAYS";
export type FollowMessageType = "TEXT" | "AUDIO" | "IMAGE" | "VIDEO" | "DOC";
export type FollowStatus = "PENDING" | "EXECUTED" | "CANCELLED";
export type FollowProvider = "EVOLUTION";
export type FollowActionStatus = "PENDING" | "EXECUTED" | "FAILED" | "CANCELLED";

export type FollowActionInput = {
  order?: number;
  messageType: FollowMessageType;
  content?: string | null;
  mediaUrl?: string | null;
};

export type FollowActionRecord = {
  order: number;
  messageType: FollowMessageType;
  content: string | null;
  mediaUrl: string | null;
  status: FollowActionStatus;
  executedAt: string | null;
  executionError: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
};

export type FollowRuleInput = {
  workspaceId: string;
  channelId?: string | null;
  name: string;
  sourceType: FollowSourceType;
  sourceId?: string | null;
  timeType: FollowTimeType;
  timeValue: number;
  messageType: FollowMessageType;
  content?: string | null;
  mediaUrl?: string | null;
  actions?: FollowActionInput[];
  cancelOnActivity?: boolean;
  isActive?: boolean;
};

export type FollowInput = {
  workspaceId: string;
  contactId: string;
  name?: string | null;
  followRuleId?: string | null;
  channelId?: string | null;
  timeType: FollowTimeType;
  timeValue: number;
  messageType: FollowMessageType;
  content?: string | null;
  mediaUrl?: string | null;
  actions?: FollowActionInput[];
  executeAt?: Date | string | null;
  cancelOnActivity?: boolean;
};

type RawFollowRuleRow = {
  id: string;
  workspaceId: string;
  channelId: string | null;
  name: string;
  sourceType: FollowSourceType;
  sourceId: string | null;
  timeType: FollowTimeType;
  timeValue: number;
  messageType: FollowMessageType;
  content: string | null;
  mediaUrl: string | null;
  actions: Prisma.JsonValue | null;
  cancelOnActivity: boolean;
  provider: FollowProvider;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  channel__id: string | null;
  channel__name: string | null;
  channel__provider: string | null;
  channel__status: string | null;
  channel__evolutionInstanceName: string | null;
  followCount: number | string | bigint;
};

type ClaimedFollowRow = {
  id: string;
  workspaceId: string;
  contactId: string;
  name: string | null;
  followRuleId: string | null;
  channelId: string | null;
  timeType: FollowTimeType;
  timeValue: number;
  executeAt: Date;
  messageType: FollowMessageType;
  content: string | null;
  mediaUrl: string | null;
  actions: Prisma.JsonValue | null;
  status: FollowStatus;
  provider: FollowProvider;
  cancelOnActivity: boolean;
  executionError: string | null;
  executedAt: Date | null;
  cancelledAt: Date | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type RawFollowRow = ClaimedFollowRow & {
  followRule__id: string | null;
  followRule__name: string | null;
  followRule__sourceType: FollowSourceType | null;
  followRule__sourceId: string | null;
  channel__id: string | null;
  channel__name: string | null;
  channel__provider: string | null;
  channel__status: string | null;
  channel__evolutionInstanceName: string | null;
};

function normalizeText(value: string | null | undefined) {
  return value?.trim() || "";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeFollowActionStatus(value: unknown): FollowActionStatus {
  if (value === "EXECUTED" || value === "FAILED" || value === "CANCELLED") {
    return value;
  }

  return "PENDING";
}

function normalizeFollowActionRecord(
  value: Record<string, unknown>,
  fallbackOrder: number,
): FollowActionRecord {
  return {
    order: Number.isFinite(Number(value.order)) ? Math.max(1, Math.round(Number(value.order))) : fallbackOrder,
    messageType:
      value.messageType === "AUDIO" ||
      value.messageType === "IMAGE" ||
      value.messageType === "VIDEO" ||
      value.messageType === "DOC"
        ? value.messageType
        : "TEXT",
    content: normalizeText(typeof value.content === "string" ? value.content : null) || null,
    mediaUrl: normalizeText(typeof value.mediaUrl === "string" ? value.mediaUrl : null) || null,
    status: normalizeFollowActionStatus(value.status),
    executedAt: typeof value.executedAt === "string" ? value.executedAt : null,
    executionError: normalizeText(typeof value.executionError === "string" ? value.executionError : null) || null,
    lockedAt: typeof value.lockedAt === "string" ? value.lockedAt : null,
    lockedBy: normalizeText(typeof value.lockedBy === "string" ? value.lockedBy : null) || null,
  };
}

function buildLegacyFollowAction(input: {
  messageType: FollowMessageType;
  content?: string | null;
  mediaUrl?: string | null;
  order?: number;
}): FollowActionRecord {
  return {
    order: Math.max(1, Math.round(input.order ?? 1)),
    messageType: input.messageType,
    content: normalizeText(input.content) || null,
    mediaUrl: normalizeText(input.mediaUrl) || null,
    status: "PENDING",
    executedAt: null,
    executionError: null,
    lockedAt: null,
    lockedBy: null,
  };
}

function buildPersistedFollowActions(input: {
  actions?: FollowActionInput[] | null;
  messageType: FollowMessageType;
  content?: string | null;
  mediaUrl?: string | null;
}): FollowActionRecord[] {
  const normalizedActions =
    input.actions?.length
      ? input.actions
          .map((action, index) =>
            buildLegacyFollowAction({
              messageType: action.messageType,
              content: action.content ?? null,
              mediaUrl: action.mediaUrl ?? null,
              order: action.order ?? index + 1,
            }),
          )
      : [buildLegacyFollowAction(input)];

  return normalizedActions.map((action, index) => ({
    ...action,
    order: Math.max(1, action.order || index + 1),
  }));
}

function parseStoredFollowActions(value: Prisma.JsonValue | null | undefined): FollowActionRecord[] {
  if (!value) {
    return [];
  }

  const items = Array.isArray(value)
    ? value
    : isPlainRecord(value) && Array.isArray(value.actions)
      ? value.actions
      : [];

  const records = items.reduce<Record<string, unknown>[]>((acc, item) => {
    if (isPlainRecord(item)) {
      acc.push(item);
    }

    return acc;
  }, []);

  return records
    .map((item, index) => normalizeFollowActionRecord(item, index + 1))
    .sort((left, right) => left.order - right.order);
}

function buildExecutionErrorSummary(errors: Array<{ order: number; message: string }>) {
  if (!errors.length) {
    return null;
  }

  return errors
    .map((item) => `Acción ${item.order}: ${item.message}`)
    .join(" | ");
}

function buildCancelledFollowActions(input: {
  actions: Prisma.JsonValue | null | undefined;
  messageType: FollowMessageType;
  content: string | null;
  mediaUrl: string | null;
  reason: string;
}) {
  const existingActions = parseStoredFollowActions(input.actions);
  if (existingActions.length) {
    return existingActions.map((action) => ({
      ...action,
      status: action.status === "EXECUTED" ? action.status : "CANCELLED",
      executionError:
        action.status === "EXECUTED" ? action.executionError : input.reason,
      lockedAt: null,
      lockedBy: null,
    }));
  }

  return [
    {
      ...buildLegacyFollowAction({
        messageType: input.messageType,
        content: input.content,
        mediaUrl: input.mediaUrl,
      }),
      status: "CANCELLED" as const,
      executionError: input.reason,
    },
  ];
}

let followNameColumnExistsPromise: Promise<boolean> | null = null;

async function hasFollowNameColumn() {
  if (!followNameColumnExistsPromise) {
    followNameColumnExistsPromise = prisma.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Follow'
          AND column_name = 'name'
      ) AS "exists"
    `).then((rows) => Boolean(rows[0]?.exists));
  }

  return followNameColumnExistsPromise;
}

const followActionsColumnExistsPromises = new Map<string, Promise<boolean>>();

async function hasFollowActionsColumn(tableName: "FollowRule" | "Follow") {
  if (!followActionsColumnExistsPromises.has(tableName)) {
    followActionsColumnExistsPromises.set(
      tableName,
      prisma.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ${tableName}
            AND column_name = 'actions'
        ) AS "exists"
      `).then((rows) => Boolean(rows[0]?.exists)),
    );
  }

  return followActionsColumnExistsPromises.get(tableName)!;
}

function normalizePositiveInt(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.round(value));
}

function resolveExecuteAt(timeType: FollowTimeType, timeValue: number, baseDate = new Date()) {
  const safeValue = normalizePositiveInt(timeValue);
  const next = new Date(baseDate);

  if (timeType === "HOURS") {
    next.setHours(next.getHours() + safeValue);
    return next;
  }

  if (timeType === "DAYS") {
    next.setDate(next.getDate() + safeValue);
    return next;
  }

  next.setMinutes(next.getMinutes() + safeValue);
  return next;
}

function normalizePhoneNumber(value: string) {
  return value.replace(/[^\d]/g, "");
}

function toCount(value: number | string | bigint) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return Number.parseInt(value, 10) || 0;
}

function mapChannelRow(channel: {
  id: string | null;
  name: string | null;
  provider: string | null;
  status: string | null;
  evolutionInstanceName: string | null;
} | null | undefined) {
  if (!channel?.id) {
    return null;
  }

  return {
    id: channel.id,
    name: channel.name || "",
    provider: channel.provider || "EVOLUTION",
    status: channel.status || "DISCONNECTED",
    evolutionInstanceName: channel.evolutionInstanceName,
  };
}

function mapFollowRuleRow(row: RawFollowRuleRow) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    channelId: row.channelId,
    name: row.name,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    timeType: row.timeType,
    timeValue: row.timeValue,
    messageType: row.messageType,
    content: row.content,
    mediaUrl: row.mediaUrl,
    actions: parseStoredFollowActions(row.actions),
    cancelOnActivity: row.cancelOnActivity,
    provider: row.provider,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    channel: mapChannelRow({
      id: row.channel__id,
      name: row.channel__name,
      provider: row.channel__provider,
      status: row.channel__status,
      evolutionInstanceName: row.channel__evolutionInstanceName,
    }),
    _count: {
      follows: toCount(row.followCount),
    },
  };
}

function mapFollowRow(row: RawFollowRow) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    contactId: row.contactId,
    name: row.name,
    followRuleId: row.followRuleId,
    channelId: row.channelId,
    timeType: row.timeType,
    timeValue: row.timeValue,
    executeAt: row.executeAt,
    messageType: row.messageType,
    content: row.content,
    mediaUrl: row.mediaUrl,
    actions: parseStoredFollowActions(row.actions),
    status: row.status,
    provider: row.provider,
    cancelOnActivity: row.cancelOnActivity,
    executionError: row.executionError,
    executedAt: row.executedAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    followRule: row.followRule__id
      ? {
          id: row.followRule__id,
          name: row.followRule__name || "",
          sourceType: row.followRule__sourceType || "MANUAL",
          sourceId: row.followRule__sourceId,
        }
      : null,
    channel: mapChannelRow({
      id: row.channel__id,
      name: row.channel__name,
      provider: row.channel__provider,
      status: row.channel__status,
      evolutionInstanceName: row.channel__evolutionInstanceName,
    }),
  };
}

async function resolveDefaultEvolutionChannel(workspaceId: string, preferredChannelId?: string | null) {
  const normalizedPreferredChannelId = normalizeText(preferredChannelId);

  if (normalizedPreferredChannelId) {
    const preferred = await prisma.whatsAppChannel.findFirst({
      where: {
        id: normalizedPreferredChannelId,
        workspaceId,
        provider: "EVOLUTION",
      },
      select: {
        id: true,
        name: true,
        provider: true,
        agentId: true,
        evolutionInstanceName: true,
        phoneNumber: true,
        isActive: true,
        status: true,
      },
    });

    if (preferred?.evolutionInstanceName?.trim()) {
      return preferred;
    }
  }

  const activeChannel = await prisma.whatsAppChannel.findFirst({
    where: {
      workspaceId,
      provider: "EVOLUTION",
      isActive: true,
      evolutionInstanceName: {
        not: null,
      },
    },
    orderBy: [
      { status: "desc" },
      { updatedAt: "desc" },
      { createdAt: "desc" },
    ],
    select: {
      id: true,
      name: true,
      provider: true,
      agentId: true,
      evolutionInstanceName: true,
      phoneNumber: true,
      isActive: true,
      status: true,
    },
  });

  return activeChannel ?? null;
}

function mapCreateFollowRuleData(input: FollowRuleInput) {
  const now = new Date();
  const actions = buildPersistedFollowActions(input);
  return {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    channelId: normalizeText(input.channelId) || null,
    name: normalizeText(input.name),
    sourceType: input.sourceType,
    sourceId: normalizeText(input.sourceId) || null,
    timeType: input.timeType,
    timeValue: normalizePositiveInt(input.timeValue),
    messageType: input.messageType,
    content: normalizeText(input.content) || null,
    mediaUrl: normalizeText(input.mediaUrl) || null,
    actions,
    cancelOnActivity: input.cancelOnActivity ?? true,
    provider: "EVOLUTION" as const,
    isActive: input.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  };
}

function mapCreateFollowData(input: FollowInput & { executeAt: Date; channelId: string | null }) {
  const now = new Date();
  const actions = buildPersistedFollowActions(input);
  return {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    name: normalizeText((input as FollowInput & { name?: string | null }).name) || null,
    followRuleId: normalizeText(input.followRuleId) || null,
    channelId: normalizeText(input.channelId) || null,
    timeType: input.timeType,
    timeValue: normalizePositiveInt(input.timeValue),
    executeAt: input.executeAt,
    messageType: input.messageType,
    content: normalizeText(input.content) || null,
    mediaUrl: normalizeText(input.mediaUrl) || null,
    actions,
    status: "PENDING" as const,
    provider: "EVOLUTION" as const,
    cancelOnActivity: input.cancelOnActivity ?? true,
    executionError: null,
    executedAt: null,
    cancelledAt: null,
    lockedAt: null,
    lockedBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

function buildExecutionErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return "No se pudo ejecutar el seguimiento";
}

function buildMediaFileName(mediaUrl: string, fallback: string) {
  try {
    const pathname = new URL(mediaUrl).pathname;
    return pathname.split("/").pop()?.trim() || fallback;
  } catch {
    return fallback;
  }
}

type FollowSendResult = {
  channel: { id: string; agentId: string | null; evolutionInstanceName: string };
  externalId: string | null;
  raw: unknown;
};

async function sendFollowMessage(input: {
  workspaceId: string;
  contactId: string;
  channelId?: string | null;
  messageType: FollowMessageType;
  content: string | null;
  mediaUrl: string | null;
}): Promise<FollowSendResult> {
  const contact = await prisma.contact.findFirst({
    where: {
      id: input.contactId,
      workspaceId: input.workspaceId,
    },
    select: {
      phoneNumber: true,
    },
  });

  if (!contact?.phoneNumber?.trim()) {
    throw new Error("El contacto no tiene numero de telefono valido");
  }

  const channel = await resolveDefaultEvolutionChannel(input.workspaceId, input.channelId);
  if (!channel?.evolutionInstanceName?.trim()) {
    throw new Error("No hay un canal Evolution disponible para enviar el seguimiento");
  }

  const phoneNumber = normalizePhoneNumber(contact.phoneNumber);
  if (phoneNumber.length < 8) {
    throw new Error("El numero del contacto no es valido para Evolution");
  }

  const caption = input.content?.trim() || null;
  const resolvedChannel = {
    id: channel.id,
    agentId: channel.agentId ?? null,
    evolutionInstanceName: channel.evolutionInstanceName,
  };

  const sent = await (async () => {
    if (input.messageType === "TEXT") {
      const text = caption?.trim();
      if (!text) {
        throw new Error("El seguimiento de texto no tiene contenido");
      }

      return sendEvolutionTextMessageWithReconnect({
        instanceName: resolvedChannel.evolutionInstanceName,
        phoneNumber,
        text,
        delayMs: 0,
      });
    }

    if (!input.mediaUrl?.trim()) {
      throw new Error("El seguimiento multimedia no tiene mediaUrl");
    }

    if (input.messageType === "AUDIO") {
      return sendEvolutionAudioMessage({
        instanceName: resolvedChannel.evolutionInstanceName,
        phoneNumber,
        audioUrl: input.mediaUrl,
        caption,
        delayMs: 0,
      });
    }

    if (input.messageType === "IMAGE") {
      return sendEvolutionImageMessage({
        instanceName: resolvedChannel.evolutionInstanceName,
        phoneNumber,
        imageUrl: input.mediaUrl,
        caption,
        delayMs: 0,
      });
    }

    if (input.messageType === "VIDEO") {
      return sendEvolutionVideoMessage({
        instanceName: resolvedChannel.evolutionInstanceName,
        phoneNumber,
        videoUrl: input.mediaUrl,
        caption,
        delayMs: 0,
      });
    }

    return sendEvolutionDocumentMessage({
      instanceName: resolvedChannel.evolutionInstanceName,
      phoneNumber,
      documentUrl: input.mediaUrl,
      caption,
      fileName: buildMediaFileName(input.mediaUrl, "documento.pdf"),
      delayMs: 0,
    });
  })();

  return {
    channel: resolvedChannel,
    externalId: sent?.externalId ?? null,
    raw: sent?.raw ?? null,
  };
}

const FOLLOW_MESSAGE_TYPE_TO_DB: Record<FollowMessageType, "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT"> = {
  TEXT: "TEXT",
  IMAGE: "IMAGE",
  AUDIO: "AUDIO",
  VIDEO: "VIDEO",
  DOC: "DOCUMENT",
};

// Resuelve (o crea) la conversacion del contacto en el canal usado para enviar el
// seguimiento, replicando la logica del webhook (find-or-create con reintento ante
// carreras de unicidad). Sin esto el mensaje del seguimiento no tendria conversationId
// y nunca aparecería en la vista de chats.
async function resolveFollowConversation(input: {
  workspaceId: string;
  channelId: string;
  contactId: string;
  agentId: string | null;
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const existing = await prisma.conversation.findFirst({
        where: {
          workspaceId: input.workspaceId,
          channelId: input.channelId,
          contactId: input.contactId,
        },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      });

      if (existing) {
        return existing;
      }

      return await prisma.conversation.create({
        data: {
          workspaceId: input.workspaceId,
          channelId: input.channelId,
          agentId: input.agentId,
          contactId: input.contactId,
          status: "OPEN",
          lastMessageAt: new Date(),
        },
        select: { id: true },
      });
    } catch (error) {
      const isDuplicateConversation =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

      if (isDuplicateConversation && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
        continue;
      }

      throw error;
    }
  }

  return null;
}

// Persiste el mensaje saliente del seguimiento en la conversacion del chat. Usa upsert
// idempotente por (channelId, externalId) para reconciliarse sin duplicar si Evolution
// llega a emitir el webhook `fromMe` del mismo mensaje.
async function persistFollowMessage(input: {
  workspaceId: string;
  contactId: string;
  messageType: FollowMessageType;
  content: string | null;
  mediaUrl: string | null;
  result: FollowSendResult;
}) {
  const conversation = await resolveFollowConversation({
    workspaceId: input.workspaceId,
    channelId: input.result.channel.id,
    contactId: input.contactId,
    agentId: input.result.channel.agentId,
  });

  if (!conversation) {
    throw new Error("No se pudo resolver la conversacion del seguimiento");
  }

  const now = new Date();
  const externalId = input.result.externalId?.trim() || "";
  const data = {
    workspaceId: input.workspaceId,
    conversationId: conversation.id,
    channelId: input.result.channel.id,
    contactId: input.contactId,
    agentId: input.result.channel.agentId,
    direction: "OUTBOUND" as const,
    type: FOLLOW_MESSAGE_TYPE_TO_DB[input.messageType],
    status: "SENT" as const,
    content: input.content?.trim() || null,
    mediaUrl: input.mediaUrl?.trim() || null,
    sentAt: now,
    rawPayload: {
      source: "follow",
      evolution: input.result.raw,
    } as Prisma.InputJsonValue,
  };

  if (externalId) {
    await prisma.message.upsert({
      where: {
        channelId_externalId: {
          channelId: input.result.channel.id,
          externalId,
        },
      },
      create: { ...data, externalId },
      update: { ...data, externalId },
    });
  } else {
    await prisma.message.create({ data });
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: now, status: "OPEN" },
  });
}

export async function createFollowRule(input: FollowRuleInput) {
  const data = mapCreateFollowRuleData(input);
  const hasActionsColumn = await hasFollowActionsColumn("FollowRule");
  const [row] = await prisma.$queryRaw<RawFollowRuleRow[]>(Prisma.sql`
    INSERT INTO public."FollowRule" (
      "id",
      "workspaceId",
      "channelId",
      "name",
      "sourceType",
      "sourceId",
      "timeType",
      "timeValue",
      "messageType",
      "content",
      "mediaUrl",
      ${hasActionsColumn ? Prisma.sql`"actions",` : Prisma.empty}
      "cancelOnActivity",
      "provider",
      "isActive",
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${data.id},
      ${data.workspaceId},
      ${data.channelId},
      ${data.name},
      ${data.sourceType},
      ${data.sourceId},
      ${data.timeType},
      ${data.timeValue},
      ${data.messageType},
      ${data.content},
      ${data.mediaUrl},
      ${hasActionsColumn ? Prisma.sql`${JSON.stringify(data.actions)}::jsonb,` : Prisma.empty}
      ${data.cancelOnActivity},
      ${data.provider},
      ${data.isActive},
      ${data.createdAt},
      ${data.updatedAt}
    )
    RETURNING
      "id",
      "workspaceId",
      "channelId",
      "name",
      "sourceType",
      "sourceId",
      "timeType",
      "timeValue",
      "messageType",
      "content",
      "mediaUrl",
      ${hasActionsColumn ? Prisma.sql`"actions",` : Prisma.sql`NULL::jsonb AS "actions",`}
      "cancelOnActivity",
      "provider",
      "isActive",
      "createdAt",
      "updatedAt",
      NULL::text AS "channel__id",
      NULL::text AS "channel__name",
      NULL::text AS "channel__provider",
      NULL::text AS "channel__status",
      NULL::text AS "channel__evolutionInstanceName",
      0::integer AS "followCount"
  `);

  return row ? mapFollowRuleRow(row) : null;
}

export async function deleteFollowRule(input: {
  workspaceId: string;
  followRuleId: string;
}) {
  const [deleted] = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    DELETE FROM public."FollowRule"
    WHERE "id" = ${input.followRuleId}
      AND "workspaceId" = ${input.workspaceId}
    RETURNING "id"
  `);

  return deleted?.id ?? null;
}

export async function listFollowRulesByWorkspace(workspaceId: string) {
  const hasActionsColumn = await hasFollowActionsColumn("FollowRule");
  const rows = await prisma.$queryRaw<RawFollowRuleRow[]>(Prisma.sql`
    SELECT
      fr."id",
      fr."workspaceId",
      fr."channelId",
      fr."name",
      fr."sourceType",
      fr."sourceId",
      fr."timeType",
      fr."timeValue",
      fr."messageType",
      fr."content",
      fr."mediaUrl",
      ${hasActionsColumn ? Prisma.sql`fr."actions",` : Prisma.sql`NULL::jsonb AS "actions",`}
      fr."cancelOnActivity",
      fr."provider",
      fr."isActive",
      fr."createdAt",
      fr."updatedAt",
      c."id" AS "channel__id",
      c."name" AS "channel__name",
      c."provider" AS "channel__provider",
      c."status" AS "channel__status",
      c."evolutionInstanceName" AS "channel__evolutionInstanceName",
      COALESCE(fc."followCount", 0)::int AS "followCount"
    FROM public."FollowRule" fr
    LEFT JOIN public."WhatsAppChannel" c ON c."id" = fr."channelId"
    LEFT JOIN (
      SELECT "followRuleId", COUNT(*)::int AS "followCount"
      FROM "Follow"
      GROUP BY "followRuleId"
    ) fc ON fc."followRuleId" = fr."id"
    WHERE fr."workspaceId" = ${workspaceId}
    ORDER BY fr."isActive" DESC, fr."createdAt" DESC
  `);

  return rows.map(mapFollowRuleRow);
}

export async function createFollow(input: FollowInput) {
  const executeAt =
    input.executeAt instanceof Date
      ? input.executeAt
      : input.executeAt
        ? new Date(input.executeAt)
        : resolveExecuteAt(input.timeType, input.timeValue);

  const channel = await resolveDefaultEvolutionChannel(input.workspaceId, input.channelId ?? null);
  const hasNameColumn = await hasFollowNameColumn();
  const hasActionsColumn = await hasFollowActionsColumn("Follow");
  const data = mapCreateFollowData({
    ...input,
    executeAt,
    channelId: channel?.id ?? null,
  });

  const [row] = await prisma.$queryRaw<RawFollowRow[]>(Prisma.sql`
    INSERT INTO public."Follow" (
      "id",
      "workspaceId",
      "contactId",
      ${hasNameColumn ? Prisma.sql`"name",` : Prisma.empty}
      "followRuleId",
      "channelId",
      "timeType",
      "timeValue",
      "executeAt",
      "messageType",
      "content",
      "mediaUrl",
      ${hasActionsColumn ? Prisma.sql`"actions",` : Prisma.empty}
      "status",
      "provider",
      "cancelOnActivity",
      "executionError",
      "executedAt",
      "cancelledAt",
      "lockedAt",
      "lockedBy",
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${data.id},
      ${data.workspaceId},
      ${data.contactId},
      ${hasNameColumn ? Prisma.sql`${data.name},` : Prisma.empty}
      ${data.followRuleId},
      ${data.channelId},
      ${data.timeType},
      ${data.timeValue},
      ${data.executeAt},
      ${data.messageType},
      ${data.content},
      ${data.mediaUrl},
      ${hasActionsColumn ? Prisma.sql`${JSON.stringify(data.actions)}::jsonb,` : Prisma.empty}
      ${data.status},
      ${data.provider},
      ${data.cancelOnActivity},
      ${data.executionError},
      ${data.executedAt},
      ${data.cancelledAt},
      ${data.lockedAt},
      ${data.lockedBy},
      ${data.createdAt},
      ${data.updatedAt}
    )
    RETURNING
      "id",
      "workspaceId",
      "contactId",
      ${hasNameColumn ? Prisma.sql`"name",` : Prisma.sql`NULL::text AS "name",`}
      "followRuleId",
      "channelId",
      "timeType",
      "timeValue",
      "executeAt",
      "messageType",
      "content",
      "mediaUrl",
      ${hasActionsColumn ? Prisma.sql`"actions",` : Prisma.sql`NULL::jsonb AS "actions",`}
      "status",
      "provider",
      "cancelOnActivity",
      "executionError",
      "executedAt",
      "cancelledAt",
      "lockedAt",
      "lockedBy",
      "createdAt",
      "updatedAt",
      NULL::text AS "followRule__id",
      NULL::text AS "followRule__name",
      NULL::text AS "followRule__sourceType",
      NULL::text AS "followRule__sourceId",
      ${channel?.id ?? null}::text AS "channel__id",
      ${channel?.name ?? null}::text AS "channel__name",
      ${channel?.provider ?? null}::text AS "channel__provider",
      ${channel?.status ?? null}::text AS "channel__status",
      ${channel?.evolutionInstanceName ?? null}::text AS "channel__evolutionInstanceName"
  `);

  return row ? mapFollowRow(row) : null;
}

export async function createFollowsFromRulesForSource(input: {
  workspaceId: string;
  contactId: string;
  sourceType: FollowSourceType;
  sourceId?: string | null;
  channelId?: string | null;
  executeAt?: Date | string | null;
}) {
  const normalizedSourceId = normalizeText(input.sourceId) || null;
  const rules = (await listFollowRulesByWorkspace(input.workspaceId)).filter((rule) => {
    if (!rule.isActive) {
      return false;
    }

    if (rule.sourceType !== input.sourceType) {
      return false;
    }

    if (normalizedSourceId && rule.sourceId !== normalizedSourceId) {
      return false;
    }

    return true;
  });

  if (!rules.length) {
    return { created: 0, followIds: [] as string[] };
  }

  const followIds: string[] = [];
  for (const rule of rules) {
    const follow = await createFollow({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      followRuleId: rule.id,
      channelId: input.channelId ?? rule.channelId ?? null,
      timeType: rule.timeType,
      timeValue: rule.timeValue,
      messageType: rule.messageType,
      content: rule.content,
      mediaUrl: rule.mediaUrl,
      actions: rule.actions as FollowActionInput[] | undefined,
      cancelOnActivity: rule.cancelOnActivity,
      executeAt: input.executeAt ?? resolveExecuteAt(rule.timeType, rule.timeValue),
    });

    if (!follow) {
      continue;
    }

    followIds.push(follow.id);
  }

  return { created: followIds.length, followIds };
}

export async function listFollowsByContact(input: {
  workspaceId: string;
  contactId: string;
  limit?: number;
}) {
  const hasNameColumn = await hasFollowNameColumn();
  const hasActionsColumn = await hasFollowActionsColumn("Follow");
  const rows = await prisma.$queryRaw<RawFollowRow[]>(Prisma.sql`
    SELECT
      f."id",
      f."workspaceId",
      f."contactId",
      ${hasNameColumn ? Prisma.sql`f."name",` : Prisma.sql`NULL::text AS "name",`}
      f."followRuleId",
      f."channelId",
      f."timeType",
      f."timeValue",
      f."executeAt",
      f."messageType",
      f."content",
      f."mediaUrl",
      ${hasActionsColumn ? Prisma.sql`f."actions",` : Prisma.sql`NULL::jsonb AS "actions",`}
      f."status",
      f."provider",
      f."cancelOnActivity",
      f."executionError",
      f."executedAt",
      f."cancelledAt",
      f."lockedAt",
      f."lockedBy",
      f."createdAt",
      f."updatedAt",
      fr."id" AS "followRule__id",
      fr."name" AS "followRule__name",
      fr."sourceType" AS "followRule__sourceType",
      fr."sourceId" AS "followRule__sourceId",
      c."id" AS "channel__id",
      c."name" AS "channel__name",
      c."provider" AS "channel__provider",
      c."status" AS "channel__status",
      c."evolutionInstanceName" AS "channel__evolutionInstanceName"
    FROM public."Follow" f
    LEFT JOIN public."FollowRule" fr ON fr."id" = f."followRuleId"
    LEFT JOIN public."WhatsAppChannel" c ON c."id" = f."channelId"
    WHERE f."workspaceId" = ${input.workspaceId}
      AND f."contactId" = ${input.contactId}
    ORDER BY f."executeAt" ASC, f."createdAt" DESC
    LIMIT ${Math.max(1, Math.min(100, input.limit ?? 25))}
  `);

  return rows.map(mapFollowRow);
}

export async function countFollowsByContact(input: {
  workspaceId: string;
  contactId: string;
}) {
  const [counts] = await prisma.$queryRaw<Array<{
    total: number | string | bigint;
    pending: number | string | bigint;
    executed: number | string | bigint;
    cancelled: number | string | bigint;
  }>>(Prisma.sql`
    SELECT
      COUNT(*)::int AS "total",
      COUNT(*) FILTER (WHERE "status" = 'PENDING')::int AS "pending",
      COUNT(*) FILTER (WHERE "status" = 'EXECUTED')::int AS "executed",
      COUNT(*) FILTER (WHERE "status" = 'CANCELLED')::int AS "cancelled"
    FROM public."Follow"
    WHERE "workspaceId" = ${input.workspaceId}
      AND "contactId" = ${input.contactId}
  `);

  return {
    total: counts ? toCount(counts.total) : 0,
    pending: counts ? toCount(counts.pending) : 0,
    executed: counts ? toCount(counts.executed) : 0,
    cancelled: counts ? toCount(counts.cancelled) : 0,
  };
}

export async function cancelPendingFollowsByContact(input: {
  workspaceId: string;
  contactId: string;
  reason?: string;
}) {
  const now = new Date();
  const reason = input.reason?.trim() || "Cancelado por actividad";
  const hasActionsColumn = await hasFollowActionsColumn("Follow");
  const pendingFollows = (await listFollowsByContact({
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    limit: 100,
  })).filter((follow) => follow.status === "PENDING" && follow.cancelOnActivity);

  for (const follow of pendingFollows) {
    const actions = buildCancelledFollowActions({
      actions: follow.actions as Prisma.JsonValue | null,
      messageType: follow.messageType as FollowMessageType,
      content: follow.content,
      mediaUrl: follow.mediaUrl,
      reason,
    });

    await prisma.$executeRaw(Prisma.sql`
      UPDATE public."Follow"
      SET
        "status" = 'CANCELLED',
        "cancelledAt" = ${now},
        "executionError" = ${reason},
        "lockedAt" = NULL,
        "lockedBy" = NULL,
        ${hasActionsColumn ? Prisma.sql`"actions" = ${JSON.stringify(actions)}::jsonb,` : Prisma.empty}
        "updatedAt" = ${now}
      WHERE "id" = ${follow.id}
    `);
  }

  return { cancelled: pendingFollows.length };
}

async function claimDueFollowsForExecution(input: {
  workspaceId?: string;
  limit: number;
  workerId: string;
}) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 10 * 60 * 1000);
  const workspaceWhere = input.workspaceId
    ? Prisma.sql`AND f."workspaceId" = ${input.workspaceId}`
    : Prisma.empty;

  return prisma.$queryRaw<ClaimedFollowRow[]>(Prisma.sql`
    WITH candidates AS (
      SELECT f."id"
      FROM public."Follow" f
      WHERE f."status" = 'PENDING'
        AND f."executeAt" <= ${now}
        AND (f."lockedAt" IS NULL OR f."lockedAt" < ${staleBefore})
        ${workspaceWhere}
      ORDER BY f."executeAt" ASC, f."createdAt" ASC
      LIMIT ${input.limit}
      FOR UPDATE SKIP LOCKED
    ),
    claimed AS (
      UPDATE public."Follow" f
      SET
        "lockedAt" = ${now},
        "lockedBy" = ${input.workerId},
        "updatedAt" = CURRENT_TIMESTAMP
      FROM candidates
      WHERE f."id" = candidates."id"
      RETURNING f.*
    )
    SELECT * FROM claimed
  `);
}

async function persistFollowActionProgress(followId: string, actions: FollowActionRecord[]) {
  const now = new Date();
  const hasActionsColumn = await hasFollowActionsColumn("Follow");
  await prisma.$executeRaw(Prisma.sql`
    UPDATE public."Follow"
    SET
      ${hasActionsColumn ? Prisma.sql`"actions" = ${JSON.stringify(actions)}::jsonb,` : Prisma.empty}
      "updatedAt" = ${now}
    WHERE "id" = ${followId}
  `);
}

async function finalizeFollowExecution(
  followId: string,
  actions: FollowActionRecord[],
  executionError: string | null,
) {
  const now = new Date();
  const hasActionsColumn = await hasFollowActionsColumn("Follow");
  await prisma.$executeRaw(Prisma.sql`
    UPDATE public."Follow"
    SET
      "status" = 'EXECUTED',
      "executedAt" = ${now},
      "executionError" = ${executionError},
      "lockedAt" = NULL,
      "lockedBy" = NULL,
      ${hasActionsColumn ? Prisma.sql`"actions" = ${JSON.stringify(actions)}::jsonb,` : Prisma.empty}
      "updatedAt" = ${now}
    WHERE "id" = ${followId}
  `);
}

function resolveFollowExecutionActions(follow: Pick<ClaimedFollowRow, "actions" | "messageType" | "content" | "mediaUrl">) {
  const storedActions = parseStoredFollowActions(follow.actions);
  if (storedActions.length) {
    return storedActions;
  }

  return [buildLegacyFollowAction({
    messageType: follow.messageType,
    content: follow.content,
    mediaUrl: follow.mediaUrl,
  })];
}

async function executeFollowRecord(follow: ClaimedFollowRow) {
  const actions = resolveFollowExecutionActions(follow);
  const workerId = follow.lockedBy || randomUUID();
  const actionErrors: Array<{ order: number; message: string }> = [];

  for (const action of actions) {
    if (action.status !== "PENDING") {
      continue;
    }

    const now = new Date().toISOString();
    action.lockedAt = now;
    action.lockedBy = workerId;
    await persistFollowActionProgress(follow.id, actions);

    try {
      const sendResult = await sendFollowMessage({
        workspaceId: follow.workspaceId,
        contactId: follow.contactId,
        channelId: follow.channelId,
        messageType: action.messageType,
        content: action.content,
        mediaUrl: action.mediaUrl,
      });

      // El mensaje ya se envió a WhatsApp; persistirlo en la conversación es lo que lo
      // hace visible en la vista de chats. Si esta escritura falla NO marcamos la acción
      // como fallida (provocaría un reenvío duplicado), solo lo registramos.
      try {
        await persistFollowMessage({
          workspaceId: follow.workspaceId,
          contactId: follow.contactId,
          messageType: action.messageType,
          content: action.content,
          mediaUrl: action.mediaUrl,
          result: sendResult,
        });
      } catch (persistError) {
        console.error("[follows] No se pudo persistir el mensaje de seguimiento en chats", {
          followId: follow.id,
          actionOrder: action.order,
          error: persistError,
        });
      }

      action.status = "EXECUTED";
      action.executedAt = new Date().toISOString();
      action.executionError = null;
      action.lockedAt = null;
      action.lockedBy = null;
    } catch (error) {
      const errorMessage = buildExecutionErrorMessage(error);
      action.status = "FAILED";
      action.executionError = errorMessage;
      action.executedAt = null;
      action.lockedAt = null;
      action.lockedBy = null;
      actionErrors.push({ order: action.order, message: errorMessage });
    }

    await persistFollowActionProgress(follow.id, actions);
  }

  const executionError = buildExecutionErrorSummary(actionErrors);
  await finalizeFollowExecution(follow.id, actions, executionError);
  return { ok: true as const, executionError };
}

export async function executePendingFollows(input: {
  workspaceId?: string;
  limit?: number;
  workerId?: string;
}) {
  const workerId = input.workerId?.trim() || randomUUID();
  const limit = Math.max(1, Math.min(100, input.limit ?? 25));
  const claimed = await claimDueFollowsForExecution({
    workspaceId: input.workspaceId,
    limit,
    workerId,
  });

  const results: Array<{ followId: string; ok: boolean; error?: string }> = [];
  let warningCount = 0;
  for (const follow of claimed) {
    const result = await executeFollowRecord(follow);
    if (result.executionError) {
      warningCount += 1;
    }
    results.push({
      followId: follow.id,
      ok: result.ok,
      error: result.executionError ?? undefined,
    });
  }

  return {
    claimed: claimed.length,
    executed: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    warnings: warningCount,
    results,
  };
}

export async function getFollowOverview(input: {
  workspaceId: string;
  contactId?: string;
}) {
  const hasNameColumn = await hasFollowNameColumn();
  const hasActionsColumn = await hasFollowActionsColumn("Follow");
  const [rules, follows] = await Promise.all([
    listFollowRulesByWorkspace(input.workspaceId),
    input.contactId
      ? listFollowsByContact({ workspaceId: input.workspaceId, contactId: input.contactId, limit: 50 })
      : prisma.$queryRaw<RawFollowRow[]>(Prisma.sql`
          SELECT
            f."id",
            f."workspaceId",
            f."contactId",
            ${hasNameColumn ? Prisma.sql`f."name",` : Prisma.sql`NULL::text AS "name",`}
            f."followRuleId",
            f."channelId",
            f."timeType",
            f."timeValue",
            f."executeAt",
            f."messageType",
            f."content",
            f."mediaUrl",
            ${hasActionsColumn ? Prisma.sql`f."actions",` : Prisma.sql`NULL::jsonb AS "actions",`}
            f."status",
            f."provider",
            f."cancelOnActivity",
            f."executionError",
            f."executedAt",
            f."cancelledAt",
            f."lockedAt",
            f."lockedBy",
            f."createdAt",
            f."updatedAt",
            fr."id" AS "followRule__id",
            fr."name" AS "followRule__name",
            fr."sourceType" AS "followRule__sourceType",
            fr."sourceId" AS "followRule__sourceId",
            c."id" AS "channel__id",
            c."name" AS "channel__name",
            c."provider" AS "channel__provider",
            c."status" AS "channel__status",
            c."evolutionInstanceName" AS "channel__evolutionInstanceName"
          FROM public."Follow" f
          LEFT JOIN public."FollowRule" fr ON fr."id" = f."followRuleId"
          LEFT JOIN public."WhatsAppChannel" c ON c."id" = f."channelId"
          WHERE f."workspaceId" = ${input.workspaceId}
          ORDER BY f."executeAt" DESC, f."createdAt" DESC
          LIMIT 50
        `).then((rows) => rows.map(mapFollowRow)),
  ]);

  const counts = input.contactId
    ? await countFollowsByContact({
        workspaceId: input.workspaceId,
        contactId: input.contactId,
      })
    : {
        total: toCount((await prisma.$queryRaw<Array<{ total: number | string | bigint }>>(Prisma.sql`
          SELECT COUNT(*)::int AS "total"
          FROM public."Follow"
          WHERE "workspaceId" = ${input.workspaceId}
        `))[0]?.total ?? 0),
        pending: toCount((await prisma.$queryRaw<Array<{ pending: number | string | bigint }>>(Prisma.sql`
          SELECT COUNT(*)::int AS "pending"
          FROM public."Follow"
          WHERE "workspaceId" = ${input.workspaceId} AND "status" = 'PENDING'
        `))[0]?.pending ?? 0),
        executed: toCount((await prisma.$queryRaw<Array<{ executed: number | string | bigint }>>(Prisma.sql`
          SELECT COUNT(*)::int AS "executed"
          FROM public."Follow"
          WHERE "workspaceId" = ${input.workspaceId} AND "status" = 'EXECUTED'
        `))[0]?.executed ?? 0),
        cancelled: toCount((await prisma.$queryRaw<Array<{ cancelled: number | string | bigint }>>(Prisma.sql`
          SELECT COUNT(*)::int AS "cancelled"
          FROM public."Follow"
          WHERE "workspaceId" = ${input.workspaceId} AND "status" = 'CANCELLED'
        `))[0]?.cancelled ?? 0),
      };

  return {
    rules,
    follows,
    counts,
  };
}

export async function resolveFollowSourceLabel(input: {
  workspaceId: string;
  sourceType: FollowSourceType;
  sourceId?: string | null;
}) {
  const sourceId = normalizeText(input.sourceId);

  if (!sourceId) {
    return input.sourceType === "MANUAL" ? "Manual" : "Sin origen";
  }

  if (input.sourceType === "CRM_STAGE") {
    return sourceId;
  }

  if (input.sourceType === "TAG") {
    const tag = await prisma.tag.findFirst({
      where: {
        id: sourceId,
        workspaceId: input.workspaceId,
      },
      select: {
        name: true,
      },
    });

    return tag?.name?.trim() || sourceId;
  }

  if (input.sourceType === "PRODUCT") {
    const product = await prisma.product.findFirst({
      where: { id: sourceId },
      select: {
        name: true,
      },
    });

    return product?.name?.trim() || sourceId;
  }

  if (input.sourceType === "FLOW") {
    const flowItems = await getCreatedFlowItems({
      workspaceId: input.workspaceId,
      includeOfficialApi: true,
    });
    const matchedFlow = flowItems.find((item) => item.id === sourceId);
    return matchedFlow?.title?.trim() || sourceId;
  }

  return sourceId;
}
