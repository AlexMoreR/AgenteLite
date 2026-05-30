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
  cancelOnActivity?: boolean;
  isActive?: boolean;
};

export type FollowInput = {
  workspaceId: string;
  contactId: string;
  followRuleId?: string | null;
  channelId?: string | null;
  timeType: FollowTimeType;
  timeValue: number;
  messageType: FollowMessageType;
  content?: string | null;
  mediaUrl?: string | null;
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
  followRuleId: string | null;
  channelId: string | null;
  timeType: FollowTimeType;
  timeValue: number;
  executeAt: Date;
  messageType: FollowMessageType;
  content: string | null;
  mediaUrl: string | null;
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

function isMediaType(value: FollowMessageType): value is Exclude<FollowMessageType, "TEXT"> {
  return value !== "TEXT";
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
    followRuleId: row.followRuleId,
    channelId: row.channelId,
    timeType: row.timeType,
    timeValue: row.timeValue,
    executeAt: row.executeAt,
    messageType: row.messageType,
    content: row.content,
    mediaUrl: row.mediaUrl,
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
    cancelOnActivity: input.cancelOnActivity ?? true,
    provider: "EVOLUTION" as const,
    isActive: input.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  };
}

function mapCreateFollowData(input: FollowInput & { executeAt: Date; channelId: string | null }) {
  const now = new Date();
  return {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    followRuleId: normalizeText(input.followRuleId) || null,
    channelId: normalizeText(input.channelId) || null,
    timeType: input.timeType,
    timeValue: normalizePositiveInt(input.timeValue),
    executeAt: input.executeAt,
    messageType: input.messageType,
    content: normalizeText(input.content) || null,
    mediaUrl: normalizeText(input.mediaUrl) || null,
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

async function sendFollowMessage(input: {
  workspaceId: string;
  contactId: string;
  channelId?: string | null;
  messageType: FollowMessageType;
  content: string | null;
  mediaUrl: string | null;
}) {
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

  if (input.messageType === "TEXT") {
    const text = caption?.trim();
    if (!text) {
      throw new Error("El seguimiento de texto no tiene contenido");
    }

    return sendEvolutionTextMessageWithReconnect({
      instanceName: channel.evolutionInstanceName,
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
      instanceName: channel.evolutionInstanceName,
      phoneNumber,
      audioUrl: input.mediaUrl,
      caption,
      delayMs: 0,
    });
  }

  if (input.messageType === "IMAGE") {
    return sendEvolutionImageMessage({
      instanceName: channel.evolutionInstanceName,
      phoneNumber,
      imageUrl: input.mediaUrl,
      caption,
      delayMs: 0,
    });
  }

  if (input.messageType === "VIDEO") {
    return sendEvolutionVideoMessage({
      instanceName: channel.evolutionInstanceName,
      phoneNumber,
      videoUrl: input.mediaUrl,
      caption,
      delayMs: 0,
    });
  }

  return sendEvolutionDocumentMessage({
    instanceName: channel.evolutionInstanceName,
    phoneNumber,
    documentUrl: input.mediaUrl,
    caption,
    fileName: buildMediaFileName(input.mediaUrl, "documento.pdf"),
    delayMs: 0,
  });
}

export async function createFollowRule(input: FollowRuleInput) {
  const data = mapCreateFollowRuleData(input);
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

export async function listFollowRulesByWorkspace(workspaceId: string) {
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
      "followRuleId",
      "channelId",
      "timeType",
      "timeValue",
      "executeAt",
      "messageType",
      "content",
      "mediaUrl",
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
      ${data.followRuleId},
      ${data.channelId},
      ${data.timeType},
      ${data.timeValue},
      ${data.executeAt},
      ${data.messageType},
      ${data.content},
      ${data.mediaUrl},
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
      "followRuleId",
      "channelId",
      "timeType",
      "timeValue",
      "executeAt",
      "messageType",
      "content",
      "mediaUrl",
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
  const rows = await prisma.$queryRaw<RawFollowRow[]>(Prisma.sql`
    SELECT
      f."id",
      f."workspaceId",
      f."contactId",
      f."followRuleId",
      f."channelId",
      f."timeType",
      f."timeValue",
      f."executeAt",
      f."messageType",
      f."content",
      f."mediaUrl",
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

  const cancelled = await prisma.$executeRaw(Prisma.sql`
    UPDATE public."Follow"
    SET
      "status" = 'CANCELLED',
      "cancelledAt" = ${now},
      "executionError" = ${reason},
      "lockedAt" = NULL,
      "lockedBy" = NULL,
      "updatedAt" = ${now}
    WHERE "workspaceId" = ${input.workspaceId}
      AND "contactId" = ${input.contactId}
      AND "status" = 'PENDING'
      AND "cancelOnActivity" = TRUE
  `);

  return { cancelled };
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

async function markFollowExecuted(followId: string) {
  const now = new Date();
  await prisma.$executeRaw(Prisma.sql`
    UPDATE public."Follow"
    SET
      "status" = 'EXECUTED',
      "executedAt" = ${now},
      "executionError" = NULL,
      "lockedAt" = NULL,
      "lockedBy" = NULL,
      "updatedAt" = ${now}
    WHERE "id" = ${followId}
  `);
}

async function markFollowFailed(followId: string, error: unknown, cancel = false) {
  const now = new Date();
  await prisma.$executeRaw(Prisma.sql`
    UPDATE public."Follow"
    SET
      "status" = ${cancel ? "CANCELLED" : "PENDING"},
      "cancelledAt" = ${cancel ? now : null},
      "executionError" = ${buildExecutionErrorMessage(error)},
      "lockedAt" = NULL,
      "lockedBy" = NULL,
      "updatedAt" = ${now}
    WHERE "id" = ${followId}
  `);
}

async function executeFollowRecord(follow: ClaimedFollowRow) {
  try {
    await sendFollowMessage({
      workspaceId: follow.workspaceId,
      contactId: follow.contactId,
      channelId: follow.channelId,
      messageType: follow.messageType,
      content: follow.content,
      mediaUrl: follow.mediaUrl,
    });

    await markFollowExecuted(follow.id);
    return { ok: true as const };
  } catch (error) {
    const isConfigurationError =
      !follow.content?.trim() && follow.messageType === "TEXT" ||
      (isMediaType(follow.messageType) && !follow.mediaUrl?.trim());

    await markFollowFailed(follow.id, error, isConfigurationError);
    return {
      ok: false as const,
      error: buildExecutionErrorMessage(error),
    };
  }
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
  for (const follow of claimed) {
    const result = await executeFollowRecord(follow);
    results.push({
      followId: follow.id,
      ok: result.ok,
      error: result.ok ? undefined : result.error,
    });
  }

  return {
    claimed: claimed.length,
    executed: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  };
}

export async function getFollowOverview(input: {
  workspaceId: string;
  contactId?: string;
}) {
  const [rules, follows] = await Promise.all([
    listFollowRulesByWorkspace(input.workspaceId),
    input.contactId
      ? listFollowsByContact({ workspaceId: input.workspaceId, contactId: input.contactId, limit: 50 })
      : prisma.$queryRaw<RawFollowRow[]>(Prisma.sql`
          SELECT
            f."id",
            f."workspaceId",
            f."contactId",
            f."followRuleId",
            f."channelId",
            f."timeType",
            f."timeValue",
            f."executeAt",
            f."messageType",
            f."content",
            f."mediaUrl",
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
