import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { analyzeImageForAgent, generateAgentReply, transcribeAudioForAgent } from "@/lib/agent-ai";
import { summarizeContactHistory } from "@/lib/contact-summary";
import {
  buildActiveProductContextNote,
  resolveAgentProductFlowReply,
  type ActiveProductContext,
  type FlowStep,
} from "@/lib/agent-product-flow";
import { composeAgentWelcomeReply } from "@/lib/agent-reply-composer";
import { getConversationAutomationPaused, setConversationAutomationPaused } from "@/lib/conversation-automation";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { prisma } from "@/lib/prisma";
import { sendChatPushToWorkspace } from "@/lib/web-push";
import {
  cancelPendingFollowsByContact,
  createFollowsFromRulesForSource,
  scheduleFollowRuleForContact,
} from "@/features/seguimientos/services/follows";
import { resolveAgentV2StageFollowRuleIds } from "@/lib/agent-v2-stage-follows";
import { resolveEvolutionQuickResponseFlow } from "@/features/flows/services/resolveEvolutionQuickResponseFlow";
import {
  extractEvolutionConnectionState,
  extractEvolutionInstanceKey,
  extractEvolutionCallDirection,
  extractEvolutionCallStatus,
  extractEvolutionEventName,
  extractEvolutionFromMe,
  extractEvolutionInstanceName,
  extractEvolutionMessageId,
  extractEvolutionMessageText,
  extractEvolutionMessageType,
  extractEvolutionMediaUrl,
  extractEvolutionPairingCode,
  extractEvolutionPhoneNumber,
  extractEvolutionPushName,
  extractEvolutionQrCode,
  extractEvolutionRemoteJid,
  hasEvolutionCallPayload,
  hasEvolutionDeletedMessagePayload,
  hasEvolutionEditedMessagePayload,
  isEvolutionStatusBroadcastPayload,
  isInboundMessageEvent,
  normalizePhoneFromJid,
} from "@/lib/evolution-webhook";
import {
  ensureEvolutionInstanceReady,
  sendEvolutionAudioMessage,
  sendEvolutionDocumentMessage,
  sendEvolutionImageMessage,
  sendEvolutionPresence,
  sendEvolutionTextMessageWithReconnect,
  sendEvolutionVideoMessage,
  resolveEvolutionMessageMediaUrl,
} from "@/lib/evolution";
import { resolveAgentKnowledgeBaseReply } from "@/lib/agent-knowledge-media";
import { recordContactMatch } from "@/lib/contact-matches";
import { buildConversationMatchContextNote, getLatestConversationMatch } from "@/lib/contact-matches";
import { buildFlowExecutionContextNote, getConversationExecutedFlowSlugs, getFlowSlug } from "@/lib/flow-execution-history";
import {
  buildCommercialConversationContext,
  buildCommercialConversationContextPromptSection,
  buildCommercialStagePromptSection,
  buildNegotiationAdvanceReply,
  classifyCommercialStage,
  parseCommercialConversationContext,
  shouldOverrideCommercialReply,
  shouldPrioritizeCommercialStageOverFaq,
} from "@/lib/commercial-stage";
import { enforceWorkspacePlanAccess } from "@/lib/workspace-plan-access";
import { getEvolutionSettings } from "@/lib/system-settings";
import { buildHandoffMessage, parseAgentTrainingConfig } from "@/lib/agent-training";
import {
  CONSULTAR_FLUJOS_TOOL,
  CONSULTAR_PRODUCTOS_TOOL,
  resolveNotifyHumanAction,
  resolveUnknownProductNotifyAction,
  NOTIFICAR_ASESOR_TOOL,
  executeConsultarFlujosTool,
  executeConsultarProductosTool,
  sendNotificarAsesorNotification,
} from "@/features/agent-actions";
import { syncLeadLifecycleForContact } from "@/lib/contact-default-tags";
import { persistEvolutionHistorySync, syncEvolutionMessagesSince } from "@/lib/evolution-chat-sync";
import { persistChatMediaFromDataUrl } from "@/lib/chat-media-storage";

function mapChannelStatus(eventName: string | null, rawState: string | null) {
  const state = rawState?.toLowerCase() ?? "";

  if (eventName === "QRCODE_UPDATED" || eventName === "QRCODE") {
    return "QRCODE" as const;
  }

  if (eventName === "PAIRSUCCESS") {
    return "CONNECTING" as const;
  }

  if (["open", "connected", "connection_open", "online"].includes(state)) {
    return "CONNECTED" as const;
  }

  if (["close", "closed", "disconnected", "connection_close", "offline"].includes(state)) {
    return "DISCONNECTED" as const;
  }

  if (["connecting", "starting", "syncing"].includes(state)) {
    return "CONNECTING" as const;
  }

  return null;
}

function buildInboundExternalId(input: {
  messageExternalId: string | null;
  eventName: string | null;
  instanceName: string | null;
  remoteJid: string | null;
  messageText: string | null;
  payload: unknown;
}) {
  if (input.messageExternalId) {
    return input.messageExternalId;
  }

  // Keep retries idempotent even when the provider omits a message id.
  return createHash("sha256")
    .update(
      JSON.stringify({
        eventName: input.eventName,
        instanceName: input.instanceName,
        remoteJid: input.remoteJid,
        messageText: input.messageText,
        payload: input.payload,
      }),
    )
    .digest("hex");
}

function buildCallMessageContent(input: { direction: "INBOUND" | "OUTBOUND"; status: string | null }) {
  const directionLabel = input.direction === "OUTBOUND" ? "saliente" : "entrante";
  const statusLabel = input.status?.trim().toLowerCase() || "";

  if (!statusLabel) {
    return `Llamada ${directionLabel}`;
  }

  const statusMap: Record<string, string> = {
    answered: "respondida",
    accepted: "respondida",
    connected: "respondida",
    missed: "perdida",
    rejected: "rechazada",
    declined: "rechazada",
    canceled: "cancelada",
    cancelled: "cancelada",
    ended: "finalizada",
    completed: "finalizada",
  };

  const normalizedStatus = statusMap[statusLabel] ?? statusLabel;
  return `Llamada ${directionLabel} ${normalizedStatus}`;
}

async function persistEvolutionMessage(args: { data: Prisma.MessageUncheckedCreateInput }) {
  const { data } = args;
  const externalId = typeof data.externalId === "string" ? data.externalId.trim() : "";

  if (externalId && typeof data.channelId === "string" && data.channelId.trim()) {
    await prisma.message.upsert({
      where: {
        channelId_externalId: {
          channelId: data.channelId,
          externalId,
        },
      },
      create: {
        ...data,
        externalId,
      },
      update: {
        ...data,
        externalId,
      },
    });
    return;
  }

  await prisma.message.create({
    data: {
      ...data,
      externalId: externalId || null,
    },
  });
}

async function sendAndPersistEvolutionFlowStep(input: {
  step: FlowStep;
  workspaceId: string;
  conversationId: string;
  channelId: string;
  contactId: string;
  agentId: string;
  instanceName: string;
  phoneNumber: string;
}) {
  const {
    step,
    workspaceId,
    conversationId,
    channelId,
    contactId,
    agentId,
    instanceName,
    phoneNumber,
  } = input;

  if (step.kind === "text") {
    const outbound = await sendEvolutionTextMessageWithReconnect({
      instanceName,
      phoneNumber,
      text: step.content,
      delayMs: 0,
    });
    await persistEvolutionMessage({
      data: {
        workspaceId,
        conversationId,
        channelId,
        contactId,
        agentId,
        externalId: outbound.externalId,
        direction: "OUTBOUND",
        type: "TEXT",
        status: "SENT",
        content: step.content,
        sentAt: new Date(),
        rawPayload: outbound.raw as never,
      },
    });
  } else if (step.kind === "image") {
    const outbound = await sendEvolutionImageMessage({
      instanceName,
      phoneNumber,
      imageUrl: step.url,
      caption: step.caption,
      delayMs: 0,
    });
    await persistEvolutionMessage({
      data: {
        workspaceId,
        conversationId,
        channelId,
        contactId,
        agentId,
        externalId: outbound.externalId,
        direction: "OUTBOUND",
        type: "IMAGE",
        status: "SENT",
        content: step.caption,
        mediaUrl: step.url,
        sentAt: new Date(),
        rawPayload: outbound.raw as never,
      },
    });
  } else if (step.kind === "audio") {
    const outbound = await sendEvolutionAudioMessage({
      instanceName,
      phoneNumber,
      audioUrl: step.url,
      caption: step.caption,
      delayMs: 0,
    });
    await persistEvolutionMessage({
      data: {
        workspaceId,
        conversationId,
        channelId,
        contactId,
        agentId,
        externalId: outbound.externalId,
        direction: "OUTBOUND",
        type: "AUDIO",
        status: "SENT",
        content: step.caption,
        mediaUrl: step.url,
        sentAt: new Date(),
        rawPayload: outbound.raw as never,
      },
    });
  } else if (step.kind === "video") {
    const outbound = await sendEvolutionVideoMessage({
      instanceName,
      phoneNumber,
      videoUrl: step.url,
      caption: step.caption,
      delayMs: 0,
    });
    await persistEvolutionMessage({
      data: {
        workspaceId,
        conversationId,
        channelId,
        contactId,
        agentId,
        externalId: outbound.externalId,
        direction: "OUTBOUND",
        type: "VIDEO",
        status: "SENT",
        content: step.caption,
        mediaUrl: step.url,
        sentAt: new Date(),
        rawPayload: outbound.raw as never,
      },
    });
  } else if (step.kind === "document") {
    const outbound = await sendEvolutionDocumentMessage({
      instanceName,
      phoneNumber,
      documentUrl: step.url,
      caption: step.caption,
      fileName: step.fileName,
      delayMs: 0,
    });
    await persistEvolutionMessage({
      data: {
        workspaceId,
        conversationId,
        channelId,
        contactId,
        agentId,
        externalId: outbound.externalId,
        direction: "OUTBOUND",
        type: "DOCUMENT",
        status: "SENT",
        content: step.caption,
        mediaUrl: step.url,
        sentAt: new Date(),
        rawPayload: outbound.raw as never,
      },
    });
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Envía un paso del flujo con resiliencia: si evogo cierra la WS a mitad de un medio pesado
// (p.ej. un PDF de 14MB), reconecta y reintenta ESE paso una vez; si aun asi falla, lo marca
// FAILED y devuelve false — pero NUNCA lanza, para que un paso caido no aborte el flujo entero.
async function sendAndPersistEvolutionFlowStepResilient(input: {
  step: FlowStep;
  workspaceId: string;
  conversationId: string;
  channelId: string;
  contactId: string;
  agentId: string;
  instanceName: string;
  phoneNumber: string;
}): Promise<boolean> {
  try {
    await sendAndPersistEvolutionFlowStep(input);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(
      `[EVOLUTION] flow_step_failed kind=${input.step.kind} conversationId=${input.conversationId} error=${message}`,
    );
    if (message.toLowerCase().includes("connection closed")) {
      try {
        await ensureEvolutionInstanceReady(input.instanceName);
        await sendAndPersistEvolutionFlowStep(input);
        return true;
      } catch {
        // el reintento tras reconectar tambien fallo: cae al registro FAILED
      }
    }
    const failedType =
      input.step.kind === "text"
        ? "TEXT"
        : input.step.kind === "image"
          ? "IMAGE"
          : input.step.kind === "audio"
            ? "AUDIO"
            : input.step.kind === "video"
              ? "VIDEO"
              : "DOCUMENT";
    await persistEvolutionMessage({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        channelId: input.channelId,
        contactId: input.contactId,
        agentId: input.agentId,
        direction: "OUTBOUND",
        type: failedType,
        status: "FAILED",
        content: input.step.kind === "text" ? input.step.content : input.step.caption ?? null,
        mediaUrl: input.step.kind === "text" ? null : input.step.url,
        failedAt: new Date(),
      },
    }).catch(() => {});
    return false;
  }
}

type AutoReplyBufferMessage = {
  content: string;
  type: string;
  createdAt: string;
};

type AutoReplyBufferState = {
  token: string;
  startedAt: string;
  dueAt: string;
  messages: AutoReplyBufferMessage[];
};

function parseAutoReplyBuffer(value: Prisma.JsonValue | null | undefined): AutoReplyBufferState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const token = typeof raw.token === "string" ? raw.token.trim() : "";
  const startedAt = typeof raw.startedAt === "string" ? raw.startedAt.trim() : "";
  const dueAt = typeof raw.dueAt === "string" ? raw.dueAt.trim() : "";
  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .map((message) => {
          if (!message || typeof message !== "object" || Array.isArray(message)) {
            return null;
          }

          const rawMessage = message as Record<string, unknown>;
          const content = typeof rawMessage.content === "string" ? rawMessage.content : "";
          const type = typeof rawMessage.type === "string" ? rawMessage.type : "TEXT";
          const createdAt = typeof rawMessage.createdAt === "string" ? rawMessage.createdAt : "";

          if (!createdAt) {
            return null;
          }

          return {
            content,
            type,
            createdAt,
          } satisfies AutoReplyBufferMessage;
        })
        .filter((message): message is AutoReplyBufferMessage => Boolean(message))
    : [];

  if (!token || !startedAt || !dueAt || messages.length === 0) {
    return null;
  }

  return {
    token,
    startedAt,
    dueAt,
    messages,
  };
}

function buildAutoReplyBufferText(
  messages: AutoReplyBufferMessage[],
  latestIncomingAudioTranscript: string | null,
  latestIncomingImageAnalysis: string | null,
) {
  return messages
    .map((item, index) => {
      const textContent = (item.content ?? "").trim();
      if (textContent) {
        return textContent;
      }

      if (index === messages.length - 1) {
        if (item.type === "AUDIO" && latestIncomingAudioTranscript) {
          return latestIncomingAudioTranscript.trim();
        }

        if ((item.type === "IMAGE" || item.type === "STICKER") && latestIncomingImageAnalysis) {
          return latestIncomingImageAnalysis.trim();
        }
      }

      if (item.type === "AUDIO") {
        return "[AUDIO]";
      }

      if (item.type === "IMAGE" || item.type === "STICKER") {
        return "[IMAGEN]";
      }

      if (item.type === "DOCUMENT") {
        return "[DOCUMENTO]";
      }

      return "";
    })
    .filter((value) => value.trim().length > 0)
    .join("\n");
}

async function readConversationBufferState(conversationId: string) {
  return prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      autoReplyBuffer: true,
      autoReplyBatchDueAt: true,
      autoReplyBatchToken: true,
    },
  });
}

async function appendConversationBuffer(args: {
  conversationId: string;
  bufferedMessage: AutoReplyBufferMessage;
  responseDelayMs: number;
}) {
  const now = new Date();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const liveConversationState = await readConversationBufferState(args.conversationId);
    const existingBuffer = parseAutoReplyBuffer(liveConversationState?.autoReplyBuffer ?? null);
    const currentBufferStillOpen =
      Boolean(existingBuffer) &&
      liveConversationState?.autoReplyBatchToken === existingBuffer?.token &&
      Boolean(liveConversationState?.autoReplyBatchDueAt && liveConversationState.autoReplyBatchDueAt > now);

    const nextBuffer: AutoReplyBufferState = currentBufferStillOpen && existingBuffer
      ? {
          token: existingBuffer.token,
          startedAt: existingBuffer.startedAt,
          dueAt: new Date(now.getTime() + args.responseDelayMs).toISOString(),
          messages: [...existingBuffer.messages, args.bufferedMessage],
        }
      : {
          token: randomUUID(),
          startedAt: now.toISOString(),
          dueAt: new Date(now.getTime() + args.responseDelayMs).toISOString(),
          messages: [args.bufferedMessage],
        };

    const updateResult = await prisma.conversation.updateMany({
      where: {
        id: args.conversationId,
        autoReplyBatchToken: liveConversationState?.autoReplyBatchToken ?? null,
        autoReplyBatchDueAt: liveConversationState?.autoReplyBatchDueAt ?? null,
      },
      data: {
        autoReplyBuffer: nextBuffer as unknown as Prisma.InputJsonValue,
        autoReplyBatchStartedAt: new Date(nextBuffer.startedAt),
        autoReplyBatchDueAt: new Date(nextBuffer.dueAt),
        autoReplyBatchToken: nextBuffer.token,
      },
    });

    if (updateResult.count > 0) {
      return nextBuffer;
    }

    await sleep(25);
  }

  throw new Error("Unable to append conversation buffer after multiple retries");
}

async function finalizeConversationBuffer(args: { conversationId: string; batchToken: string }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const liveConversationState = await readConversationBufferState(args.conversationId);
    const currentBuffer = parseAutoReplyBuffer(liveConversationState?.autoReplyBuffer ?? null);

    if (
      !currentBuffer ||
      liveConversationState?.autoReplyBatchToken !== args.batchToken ||
      !liveConversationState?.autoReplyBatchDueAt ||
      liveConversationState.autoReplyBatchDueAt > new Date()
    ) {
      return null;
    }

    const updateResult = await prisma.conversation.updateMany({
      where: {
        id: args.conversationId,
        autoReplyBatchToken: args.batchToken,
        autoReplyBatchDueAt: liveConversationState.autoReplyBatchDueAt,
      },
      data: {
        autoReplyBuffer: Prisma.DbNull,
        autoReplyBatchStartedAt: null,
        autoReplyBatchDueAt: null,
        autoReplyBatchToken: null,
      },
    });

    if (updateResult.count > 0) {
      return { currentBuffer };
    }

    await sleep(25);
  }

  return null;
}

async function resolveConversationWithLock(args: {
  workspaceId: string;
  channelId: string;
  contactId: string;
  agentId: string | null;
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const existingConversation = await prisma.conversation.findFirst({
        where: {
          workspaceId: args.workspaceId,
          channelId: args.channelId,
          contactId: args.contactId,
        },
        orderBy: {
          updatedAt: "desc",
        },
        select: {
          id: true,
          status: true,
          activeProductContext: true,
          commercialContext: true,
        },
      });

      if (existingConversation) {
        return {
          id: existingConversation.id,
          status: existingConversation.status,
          activeProductContext: existingConversation.activeProductContext ?? null,
          commercialContext: existingConversation.commercialContext ?? null,
        };
      }

      const createdConversation = await prisma.conversation.create({
        data: {
          workspaceId: args.workspaceId,
          channelId: args.channelId,
          agentId: args.agentId,
          contactId: args.contactId,
          status: "OPEN",
          lastMessageAt: new Date(),
        },
        select: {
          id: true,
          status: true,
          activeProductContext: true,
          commercialContext: true,
        },
      });

      return {
        id: createdConversation.id,
        status: createdConversation.status,
        activeProductContext: createdConversation.activeProductContext ?? null,
        commercialContext: createdConversation.commercialContext ?? null,
      };
    } catch (error) {
      const isDuplicateConversation =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002";

      if (isDuplicateConversation && attempt < 2) {
        await sleep(50 * (attempt + 1));
        continue;
      }

      if (!isDuplicateConversation || attempt === 2) {
        throw error;
      }
    }
  }

  return null;
}

// Auto-asignación round-robin entre los colaboradores del canal.
// Solo asigna si la conversación está SIN asignar (no toca las que ya tienen dueño).
// El turno se guarda en channel.metadata.lastAutoAssignedUserId.
async function autoAssignConversationToCollaborator(args: {
  conversationId: string;
  channelId: string;
  workspaceId: string;
}) {
  const [conversation, channel] = await Promise.all([
    prisma.conversation.findUnique({
      where: { id: args.conversationId },
      select: { assignedToUserId: true },
    }),
    prisma.whatsAppChannel.findUnique({
      where: { id: args.channelId },
      select: { metadata: true },
    }),
  ]);

  // Si ya está asignada, no la tocamos.
  if (!conversation || conversation.assignedToUserId) {
    return;
  }

  const metadata =
    channel?.metadata && typeof channel.metadata === "object" && !Array.isArray(channel.metadata)
      ? (channel.metadata as Record<string, unknown>)
      : {};

  const collaboratorIds = Array.isArray(metadata.collaboratorIds)
    ? (metadata.collaboratorIds as unknown[]).filter((id): id is string => typeof id === "string")
    : [];

  if (collaboratorIds.length === 0) {
    return;
  }

  // Solo colaboradores que sigan siendo miembros activos del workspace.
  const activeMembers = await prisma.workspaceMember.findMany({
    where: { workspaceId: args.workspaceId, isActive: true, userId: { in: collaboratorIds } },
    select: { userId: true },
  });
  const activeSet = new Set(activeMembers.map((m) => m.userId));
  const validIds = collaboratorIds.filter((id) => activeSet.has(id));
  if (validIds.length === 0) {
    return;
  }

  // Siguiente colaborador tras el último asignado (round-robin cíclico).
  const lastId = typeof metadata.lastAutoAssignedUserId === "string" ? metadata.lastAutoAssignedUserId : null;
  const lastIndex = lastId ? validIds.indexOf(lastId) : -1;
  const nextUserId = validIds[(lastIndex + 1) % validIds.length];

  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { assignedToUserId: nextUserId },
  });
  await prisma.whatsAppChannel.update({
    where: { id: args.channelId },
    data: { metadata: { ...metadata, lastAutoAssignedUserId: nextUserId } as Prisma.InputJsonValue },
  });

  // Registro de actividad: "<Nombre> auto-asignado a esta conversación".
  const assignee = await prisma.user.findUnique({
    where: { id: nextUserId },
    select: { name: true, email: true },
  });
  const assigneeName = assignee?.name?.trim() || assignee?.email || "Colaborador";
  await recordConversationActivity({
    workspaceId: args.workspaceId,
    conversationId: args.conversationId,
    channelId: args.channelId,
    kind: "assigned",
    text: `${assigneeName} auto-asignado a esta conversación`,
  });
}

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);

  if (!payload) {
    return NextResponse.json({ ok: false, message: "Invalid JSON payload" }, { status: 400 });
  }

  const settings = await getEvolutionSettings();
  const providedSecret =
    request.headers.get("x-webhook-secret") ||
    request.headers.get("x-evolution-secret") ||
    request.headers.get("authorization") ||
    request.nextUrl.searchParams.get("token") ||
    request.nextUrl.searchParams.get("secret");

  if (settings.webhookSecret) {
    const normalizedSecret = providedSecret?.replace(/^Bearer\s+/i, "").trim();
    if (normalizedSecret !== settings.webhookSecret) {
      return NextResponse.json({ ok: false, message: "Unauthorized webhook" }, { status: 401 });
    }
  }

  const eventName = extractEvolutionEventName(payload);
  const instanceName = extractEvolutionInstanceName(payload);
  const instanceKey = extractEvolutionInstanceKey(payload);
  const channelPhoneNumber = normalizePhoneFromJid(extractEvolutionPhoneNumber(payload));

  const isConnectionEvent =
    eventName === "QRCODE_UPDATED" ||
    eventName === "CONNECTION_UPDATE" ||
    eventName === "QRCODE" ||
    eventName === "CONNECTED" ||
    eventName === "PAIRSUCCESS" ||
    eventName === "OFFLINESYNCCOMPLETED" ||
    eventName === "LOGGEDOUT";
  const isCallEvent = hasEvolutionCallPayload(payload);

  const channelSelect = {
    id: true,
    workspaceId: true,
    agentId: true,
    name: true,
    isActive: true,
    evolutionInstanceName: true,
    evolutionExternalKey: true,
    metadata: true,
    status: true,
    phoneNumber: true,
    qrCode: true,
    // Para saber desde cuando rellenar cuando el canal vuelve (ver el gap sync mas abajo).
    lastDisconnectionAt: true,
  } as const;

  let channel = instanceKey
    ? await prisma.whatsAppChannel.findFirst({
        where: {
          provider: "EVOLUTION",
          OR: [{ evolutionExternalKey: instanceKey }, { metadata: { path: ["instanceToken"], equals: instanceKey } }],
        },
        select: channelSelect,
      })
    : null;

  if (!channel && instanceName) {
    channel = await prisma.whatsAppChannel.findUnique({
      where: { evolutionInstanceName: instanceName },
      select: channelSelect,
    });
  }

  // Rescate: la instancia del evento no existe en nuestra BD, asi que buscamos el canal por el
  // telefono. Sirve para no perder MENSAJES cuando el instanceName no cuadra, pero es un match
  // debil: dos instancias pueden compartir el mismo numero de WhatsApp (justo lo que pasa al
  // migrar de gateway, o al dejar la instancia vieja viva). Por eso se marca.
  let channelMatchedByPhoneOnly = false;
  if (!channel && channelPhoneNumber) {
    channel = await prisma.whatsAppChannel.findFirst({
      where: {
        provider: "EVOLUTION",
        phoneNumber: channelPhoneNumber,
      },
      orderBy: [{ updatedAt: "desc" }],
      select: channelSelect,
    });
    channelMatchedByPhoneOnly = Boolean(channel);
  }

  await prisma.webhookEventLog.create({
    data: {
      provider: "EVOLUTION",
      event: eventName,
      instanceName,
      channelId: channel?.id ?? null,
      workspaceId: channel?.workspaceId ?? null,
      status: channel ? "matched" : "unmatched",
      payload: payload as never,
    },
  });

  if (!channel) {
    console.warn("[EVOLUTION] channel_not_found", {
      eventName,
      instanceName,
      instanceKey,
      channelPhoneNumber,
    });
    return NextResponse.json({
      ok: true,
      message: "Webhook received but no matching channel was found",
      instanceName,
      event: eventName,
    });
  }

  if (isConnectionEvent) {
    // Un aviso de conexion habla de UNA instancia. Si al canal solo lo encontramos por telefono,
    // el evento puede venir de otra instancia que comparte ese numero, y aplicarselo lo marca
    // conectado/desconectado por algo que no le paso.
    //
    // Paso de verdad el 16-jul-2026: al borrar una instancia vieja de Evolution API que tenia el
    // numero de Ventas, su CONNECTION_UPDATE cayo aca, no encontro esa instancia, hizo match por
    // telefono con Ventas (que ya estaba en otra instancia, en evogo, y andando) y lo dejo en
    // DISCONNECTED. El canal funcionaba; la app decia que no.
    //
    // El rescate por telefono se conserva para los MENSAJES, que es donde salva datos: perder un
    // mensaje es peor que anotarlo en el canal equivocado. Un estado de conexion mentiroso, no.
    if (channelMatchedByPhoneOnly) {
      console.warn("[EVOLUTION] connection_event_ignorado_match_debil", {
        eventName,
        instanceName,
        canal: channel.name,
        instanciaDelCanal: channel.evolutionInstanceName,
        motivo: "el evento es de otra instancia que comparte el numero",
      });

      return NextResponse.json({
        ok: true,
        message: "Connection event ignored: channel matched by phone only",
        instanceName,
        event: eventName,
      });
    }

    const qrCode = extractEvolutionQrCode(payload);
    const pairingCode = extractEvolutionPairingCode(payload);
    const phoneNumber = normalizePhoneFromJid(extractEvolutionPhoneNumber(payload));
    const nextStatus = mapChannelStatus(eventName, extractEvolutionConnectionState(payload));
    const channelMetadata =
      channel.metadata && typeof channel.metadata === "object" && !Array.isArray(channel.metadata)
        ? (channel.metadata as Record<string, unknown>)
        : null;

    await prisma.whatsAppChannel.update({
      where: { id: channel.id },
      data: {
        ...(qrCode ? { qrCode, status: "QRCODE" } : {}),
        ...(phoneNumber ? { phoneNumber } : {}),
        ...(pairingCode ? { metadata: { ...(channelMetadata ?? {}), pairingCode } } : {}),
        ...(instanceKey && !channel.evolutionExternalKey ? { evolutionExternalKey: instanceKey } : {}),
        ...(nextStatus ? { status: nextStatus } : {}),
        ...(nextStatus === "CONNECTED"
          ? {
              lastConnectionAt: new Date(),
              qrCode: null,
            }
          : {}),
        ...(nextStatus === "DISCONNECTED"
          ? {
              lastDisconnectionAt: new Date(),
            }
          : {}),
      },
    });

    // El canal VOLVIO despues de estar caido: rellenar lo que entro mientras no estabamos.
    //
    // Este es el hueco por el que se pierden los chats, y es la razon de fondo por la que las
    // asesoras no confian en el CRM y abren WhatsApp para verificar: un mensaje que nunca llego
    // no deja rastro, asi que nadie puede pedirlo a mano (el boton del chat solo sirve cuando
    // alguien NOTA que falta algo).
    //
    // Solo se traen los chats con movimiento dentro del hueco (findChats trae updatedAt), asi
    // que no revive conversaciones viejas ni ensucia el CRM como hacia el backfill ciego que se
    // quito. Se marca el hueco ya rellenado para no repetirlo en cada reconexion.
    if (nextStatus === "CONNECTED" && channel.lastDisconnectionAt) {
      const disconnectedAt = channel.lastDisconnectionAt;
      const alreadySyncedRaw = channelMetadata?.gapSyncedAt;
      const alreadySyncedMs =
        typeof alreadySyncedRaw === "string" ? new Date(alreadySyncedRaw).getTime() : 0;

      if (!Number.isFinite(alreadySyncedMs) || alreadySyncedMs < disconnectedAt.getTime()) {
        const gapChannel = channel;
        after(async () => {
          try {
            const result = await syncEvolutionMessagesSince({
              workspaceId: gapChannel.workspaceId,
              channelId: gapChannel.id,
              since: disconnectedAt,
            });

            if (result.ok) {
              console.log("[EVOLUTION] gap_sync", {
                instanceName,
                channelId: gapChannel.id,
                desde: disconnectedAt.toISOString(),
                chats: result.chats,
                mensajes: result.imported,
                ...(result.skippedTooOld ? { omitido: "hueco mayor a 7 dias" } : {}),
              });
            } else {
              console.warn("[EVOLUTION] gap_sync_failed", {
                instanceName,
                channelId: gapChannel.id,
                reason: result.reason,
              });
            }

            // Se marca aunque haya fallado: si el gateway no responde, reintentar en cada
            // reconexion solo lo golpearia mas. Queda el boton manual como salida.
            await prisma.whatsAppChannel.update({
              where: { id: gapChannel.id },
              data: {
                metadata: {
                  ...(gapChannel.metadata && typeof gapChannel.metadata === "object" && !Array.isArray(gapChannel.metadata)
                    ? (gapChannel.metadata as Record<string, unknown>)
                    : {}),
                  gapSyncedAt: disconnectedAt.toISOString(),
                },
              },
            });
          } catch (error) {
            console.error("[EVOLUTION] gap_sync_error", {
              instanceName,
              channelId: gapChannel.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      }
    }

    return NextResponse.json({
      ok: true,
      message: "Channel state updated",
      instanceName,
      event: eventName,
    });
  }

  // Historial pedido a mano (evogo responde el POST /chat/history-sync con este evento). Se
  // atiende ANTES del camino de mensajes y se corta aca a proposito: si siguiera de largo, el
  // agente le contestaria a conversaciones de hace semanas. Es el mismo daño que hacia el
  // backfill automatico que se quito, y la razon por la que estos mensajes se guardan por
  // separado (persistEvolutionHistorySync) en vez de reusar el pipeline normal.
  if ((eventName ?? "").toUpperCase().replace(/[^A-Z]/g, "").includes("HISTORYSYNC")) {
    const historyChannel = channel;
    after(async () => {
      try {
        const result = await persistEvolutionHistorySync({
          workspaceId: historyChannel.workspaceId,
          channelId: historyChannel.id,
          payload,
        });
        console.log("[EVOLUTION] history_sync", {
          instanceName,
          channelId: historyChannel.id,
          chats: result.chats,
          mensajes: result.imported,
        });
      } catch (error) {
        console.error("[EVOLUTION] history_sync_error", {
          instanceName,
          channelId: historyChannel.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return NextResponse.json({
      ok: true,
      message: "History sync received",
      instanceName,
      event: eventName,
    });
  }

  const isMessageEvent =
    isInboundMessageEvent(eventName) ||
    isCallEvent ||
    hasEvolutionEditedMessagePayload(payload) ||
    hasEvolutionDeletedMessagePayload(payload);

  if (!isMessageEvent) {
    // Aca vivia un backfill AUTOMATICO: ante un evento de contacto/chat de Evolution se pedia
    // el historial reciente de ese numero para rellenar huecos. Se quito a proposito.
    //
    // El costo era peor que el beneficio: importaba conversaciones viejas sin que nadie lo
    // pidiera, revivia chats que se habian borrado y hacia que una conversacion nueva
    // pareciera "ya contestada", suprimiendo el mensaje de bienvenida.
    //
    // La importacion de historial ahora es SIEMPRE manual y deliberada:
    //   - por contacto, desde el chat (lo usan las asesoras cuando ven el historial cortado)
    //   - masiva por canal, desde Conexion (solo administradores)
    //
    // Contrapartida asumida: si el webhook se pierde un mensaje (servidor caido, gateway
    // reiniciandose), ese hueco ya no se rellena solo. Hay que sincronizar el contacto a mano.

    return NextResponse.json({
      ok: true,
      message: "Event logged",
      instanceName,
      event: eventName,
    });
  }

  // A message arrived → the channel is definitely connected. Auto-correct stale status.
  if (channel && channel.status !== "CONNECTED") {
    await prisma.whatsAppChannel.update({
      where: { id: channel.id },
      data: { status: "CONNECTED", qrCode: null, lastConnectionAt: new Date() },
    });
    channel = { ...channel, status: "CONNECTED", qrCode: null };
  }

  const remoteJid = extractEvolutionRemoteJid(payload);
  if (isEvolutionStatusBroadcastPayload(payload) || remoteJid?.trim().toLowerCase() === "status@broadcast") {
    return NextResponse.json({
      ok: true,
      message: "Status broadcast ignored",
      instanceName,
      event: eventName,
    });
  }

  let phoneNumber = normalizePhoneFromJid(remoteJid);
  const callDirection = isCallEvent ? extractEvolutionCallDirection(payload) : null;
  const fromMe = extractEvolutionFromMe(payload);
  // Nombre de perfil de WhatsApp del remitente. Solo para mensajes ENTRANTES: en los
  // salientes (fromMe) el pushName es el del negocio, no el del cliente.
  const contactPushName = !fromMe ? (extractEvolutionPushName(payload)?.trim() || "") : "";
  const direction = (callDirection ?? (fromMe ? "OUTBOUND" : "INBOUND")) as Prisma.MessageUncheckedCreateInput["direction"];
  const callStatus = isCallEvent ? extractEvolutionCallStatus(payload) : null;
  const messageText = isCallEvent
    ? buildCallMessageContent({ direction, status: callStatus })
    : extractEvolutionMessageText(payload);
  const messageType = isCallEvent ? ("SYSTEM" as const) : extractEvolutionMessageType(payload);
  const mediaUrl = extractEvolutionMediaUrl(payload);
  const messageExternalId = extractEvolutionMessageId(payload);
  const inboundExternalId = buildInboundExternalId({
    messageExternalId,
    eventName,
    instanceName,
    remoteJid,
    messageText,
    payload,
  });
  const messageWasEdited = hasEvolutionEditedMessagePayload(payload);
  const messageWasDeleted = hasEvolutionDeletedMessagePayload(payload);
  let shouldTouchConversation = !messageWasEdited && !messageWasDeleted;

  if (messageType === "STICKER") {
    console.log("[EVOLUTION] sticker_received", {
      eventName,
      instanceName,
      channelId: channel.id,
      fromMe,
      direction,
      messageExternalId,
      hasMediaUrl: Boolean(mediaUrl),
      messageWasEdited,
      messageWasDeleted,
    });
  }
  const callFallbackConversation =
    isCallEvent && !phoneNumber
      ? await prisma.conversation.findFirst({
          where: {
            workspaceId: channel.workspaceId,
            channelId: channel.id,
            messages: {
              some: {
                type: {
                  not: "SYSTEM",
                },
              },
            },
          },
          orderBy: {
            updatedAt: "desc",
          },
          select: {
            id: true,
            status: true,
            activeProductContext: true,
            commercialContext: true,
            contact: {
              select: {
                id: true,
                name: true,
                phoneNumber: true,
              },
            },
          },
        })
      : null;

  if (isCallEvent && !phoneNumber && callFallbackConversation?.contact.phoneNumber) {
    phoneNumber = callFallbackConversation.contact.phoneNumber;
  }
  const existingMessage = messageExternalId
    ? await prisma.message.findFirst({
        where: {
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          externalId: messageExternalId,
        },
        select: {
          id: true,
          conversationId: true,
          contactId: true,
          agentId: true,
        },
      })
    : null;

  if (existingMessage && !messageWasEdited && !messageWasDeleted) {
    return NextResponse.json({
      ok: true,
      message: "Duplicate inbound event ignored",
      instanceName,
      event: eventName,
    });
  }

  if (!phoneNumber) {
    return NextResponse.json({
      ok: true,
      message: "Inbound event logged without identifiable phone number",
      instanceName,
      event: eventName,
    });
  }

  const existingContact = callFallbackConversation?.contact
    ? callFallbackConversation.contact
    : existingMessage?.contactId
      ? await prisma.contact.findFirst({
          where: {
            id: existingMessage.contactId,
            workspaceId: channel.workspaceId,
          },
          select: {
            id: true,
            name: true,
            phoneNumber: true,
          },
        })
      : await prisma.contact.findUnique({
          where: {
            workspaceId_phoneNumber: {
              workspaceId: channel.workspaceId,
              phoneNumber,
            },
          },
          select: {
            id: true,
            name: true,
            phoneNumber: true,
          },
        });

  let contact = existingContact;

  if (!contact && existingMessage?.contactId) {
    contact = await prisma.contact.findFirst({
      where: {
        id: existingMessage.contactId,
        workspaceId: channel.workspaceId,
      },
      select: { id: true, name: true, phoneNumber: true },
    });
  }

  if (!contact) {
    try {
      contact = await prisma.contact.upsert({
        where: {
          workspaceId_phoneNumber: {
            workspaceId: channel.workspaceId,
            phoneNumber,
          },
        },
        update: {},
        create: {
          workspaceId: channel.workspaceId,
          phoneNumber,
        },
        select: { id: true, name: true, phoneNumber: true },
      });
    } catch (error) {
      const isDuplicateContact =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002";

      if (!isDuplicateContact) {
        throw error;
      }

      contact = await prisma.contact.findUnique({
        where: {
          workspaceId_phoneNumber: {
            workspaceId: channel.workspaceId,
            phoneNumber,
          },
        },
        select: { id: true, name: true, phoneNumber: true },
      });
    }
  }

  // Usa el nombre de perfil de WhatsApp (pushName) como nombre del contacto/lead cuando
  // todavía no tiene uno (contactos nuevos, o creados antes sin nombre). No sobrescribe
  // un nombre ya definido, ni usa el pushName si coincide con el propio número.
  if (contact && contactPushName && !contact.name?.trim() && contactPushName !== phoneNumber) {
    try {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { name: contactPushName },
      });
      contact = { ...contact, name: contactPushName };
    } catch {
      // best-effort: no debe bloquear el procesamiento del mensaje
    }
  }

  if (!contact) {
    return NextResponse.json(
      {
        ok: false,
        message: "Unable to resolve contact for inbound Evolution webhook",
        instanceName,
        event: eventName,
      },
      { status: 500 },
    );
  }

  let existingConversation = callFallbackConversation
    ? {
        id: callFallbackConversation.id,
        status: callFallbackConversation.status,
        activeProductContext: callFallbackConversation.activeProductContext ?? null,
        commercialContext: null,
      }
      : existingMessage
      ? {
          id: existingMessage.conversationId,
          status: "CLOSED" as const,
          activeProductContext: null,
          commercialContext: null,
        }
      : await resolveConversationWithLock({
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          contactId: contact.id,
          agentId: channel.agentId ?? null,
        });

  if (!existingConversation) {
    existingConversation = await resolveConversationWithLock({
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      contactId: contact.id,
      agentId: channel.agentId ?? null,
    });
  }

  const conversation: { id: string; activeProductContext: Prisma.InputJsonValue | null; commercialContext: Prisma.InputJsonValue | null } = existingConversation
    ? {
        id: existingConversation.id,
        activeProductContext: existingConversation.activeProductContext ?? null,
        commercialContext: existingConversation.commercialContext ?? null,
      }
    : {
        id: "",
        activeProductContext: null,
        commercialContext: null,
      };

  if (!messageWasEdited && existingConversation && !["OPEN", "PENDING"].includes(existingConversation.status)) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: "OPEN",
        lastMessageAt: new Date(),
      },
    });
  }

  // Auto-asignación round-robin: en un mensaje entrante, si la conversación está sin
  // asignar, se asigna al siguiente colaborador del canal. No toca las ya asignadas.
  if (direction === "INBOUND" && !messageWasEdited && !messageWasDeleted && conversation.id) {
    try {
      await autoAssignConversationToCollaborator({
        conversationId: conversation.id,
        channelId: channel.id,
        workspaceId: channel.workspaceId,
      });
    } catch {
      // La auto-asignación nunca debe romper el procesamiento del mensaje.
    }
  }

  try {
    const status = (direction === "OUTBOUND" ? "SENT" : "RECEIVED") as Prisma.MessageUncheckedCreateInput["status"];

    const messageData = {
      workspaceId: channel.workspaceId,
      conversationId: conversation.id,
      channelId: channel.id,
      contactId: contact.id,
      agentId: channel.agentId ?? null,
      externalId: inboundExternalId,
      direction,
      type: messageType,
      status,
      content: messageText,
      mediaUrl,
      rawPayload: {
        source: direction === "OUTBOUND" ? "instance" : "webhook",
        evolution: payload,
      } as never,
      // Los broadcasts ya se descartan antes de persistir (ver guard de status@broadcast),
      // pero lo calculamos igual para que la columna sea siempre consistente con rawPayload.
      isStatusBroadcast: isEvolutionStatusBroadcastPayload(payload),
      ...(direction === "OUTBOUND" ? { sentAt: new Date() } : {}),
    };

    if (messageType === "STICKER") {
      console.log("[EVOLUTION] sticker_persist", {
        conversationId: conversation.id,
        channelId: channel.id,
        externalId: inboundExternalId,
        fromMe,
        direction,
        hasContent: Boolean(messageText && messageText.trim()),
        hasMediaUrl: Boolean(mediaUrl),
        messageWasEdited,
        messageWasDeleted,
        isCallEvent,
      });
    }

    if (messageWasDeleted && messageExternalId) {
      const existingMessageRecord = await prisma.message.findFirst({
        where: {
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          externalId: messageExternalId,
        },
        select: { id: true },
      });

      if (existingMessageRecord) {
        await prisma.message.update({
          where: { id: existingMessageRecord.id },
          data: {
            deletedAt: new Date(),
            rawPayload: {
              source: direction === "OUTBOUND" ? "instance" : "webhook",
              evolution: payload,
            } as never,
          },
        });
      } else {
        // No creamos una burbuja nueva para un borrado cuyo mensaje original no
        // tenemos: Evolution reenvia el "revoke" de mensajes que ya marcamos como
        // eliminados (p. ej. al borrar desde el CRM) y crear uno nuevo generaba
        // burbujas "Eliminado" duplicadas.
        console.warn("[EVOLUTION] delete_without_match_ignored", {
          instanceName,
          channelId: channel.id,
          messageExternalId,
        });
      }
    } else if (isCallEvent && messageExternalId) {
      const callMessageWhere = {
        channelId_externalId: {
          channelId: channel.id,
          externalId: messageExternalId,
        },
      } as const;

      const existingCallMessage = await prisma.message.findUnique({
        where: callMessageWhere,
        select: {
          id: true,
          content: true,
          direction: true,
          type: true,
          status: true,
          mediaUrl: true,
          deletedAt: true,
        },
      });

      if (existingCallMessage) {
        const callAlreadyStored =
          existingCallMessage.content === messageText &&
          existingCallMessage.direction === direction &&
          existingCallMessage.type === messageType &&
          existingCallMessage.status === status &&
          existingCallMessage.mediaUrl === mediaUrl &&
          existingCallMessage.deletedAt === null;

        if (callAlreadyStored) {
          shouldTouchConversation = false;
        } else {
          await prisma.message.upsert({
            where: callMessageWhere,
            create: messageData,
            update: {
              ...messageData,
              content: messageText,
            },
          });
          shouldTouchConversation = true;
        }
      } else {
        await prisma.message.upsert({
          where: callMessageWhere,
          create: messageData,
          update: {
            ...messageData,
            content: messageText,
          },
        });
        shouldTouchConversation = true;
      }
    } else if (messageWasEdited && messageExternalId) {
      const existingMessage = await prisma.message.findFirst({
        where: {
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          externalId: messageExternalId,
        },
        select: { id: true },
      });

      if (existingMessage) {
        await prisma.message.update({
          where: { id: existingMessage.id },
          data: {
            ...messageData,
            editedAt: new Date(),
          },
        });
      } else {
        await persistEvolutionMessage({
          data: {
            ...messageData,
            editedAt: new Date(),
          },
        });
        shouldTouchConversation = true;
      }
    } else {
      await persistEvolutionMessage({
        data: messageData,
      });
    }
  } catch (error) {
    const isDuplicateMessage =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002";

    if (isDuplicateMessage) {
      console.log("[EVOLUTION] inbound_duplicate_ignored", {
        eventName,
        instanceName,
        channelId: channel.id,
        conversationId: conversation.id,
        externalId: inboundExternalId,
      });

      return NextResponse.json({
        ok: true,
        message: fromMe ? "Duplicate outbound/self event ignored" : "Duplicate inbound event ignored",
        instanceName,
        event: eventName,
      });
    }

    throw error;
  }

  if (shouldTouchConversation) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        status: "OPEN",
      },
    });
  }

  const resolvedCurrentMediaUrl =
    messageType === "IMAGE" || messageType === "STICKER" || messageType === "AUDIO"
      ? await resolveEvolutionMessageMediaUrl({
          instanceName: channel.evolutionInstanceName,
          messageId: messageExternalId,
          mediaType: messageType,
          mediaUrl,
          rawPayload: payload,
        })
      : null;

  if (messageType === "AUDIO") {
    console.log("[EVOLUTION] audio_resolution", {
      conversationId: conversation.id,
      agentId: channel.agentId,
      messageExternalId,
      hasResolvedMediaUrl: Boolean(resolvedCurrentMediaUrl),
      resolvedMediaUrlType: resolvedCurrentMediaUrl?.startsWith("data:")
        ? "data"
        : resolvedCurrentMediaUrl
          ? "url"
          : "none",
    });
  }

  // Persistir el binario del medio en el almacenamiento propio de AgenteLite en el
  // momento de la ingesta (unico instante en que esta garantizado disponible en
  // WhatsApp), guardando una URL permanente y renderable en message.mediaUrl. Asi el
  // chat lee una URL estable en vez de re-resolver contra Evolution en cada carga.
  // La resolucion perezosa del live route se mantiene como fallback.
  if (
    !messageWasDeleted &&
    !messageWasEdited &&
    !isCallEvent &&
    (messageType === "IMAGE" ||
      messageType === "STICKER" ||
      messageType === "VIDEO" ||
      messageType === "AUDIO" ||
      messageType === "DOCUMENT")
  ) {
    try {
      // Reutiliza el binario ya resuelto para la IA (IMAGE/STICKER/AUDIO); para
      // VIDEO/DOCUMENT lo resuelve aqui (la IA no los consume).
      const mediaDataUrl =
        resolvedCurrentMediaUrl ??
        (await resolveEvolutionMessageMediaUrl({
          instanceName: channel.evolutionInstanceName,
          messageId: messageExternalId,
          mediaType: messageType,
          mediaUrl,
          rawPayload: payload,
        }));

      const persistedMediaUrl = await persistChatMediaFromDataUrl({
        dataUrl: mediaDataUrl,
        mediaType: messageType,
      });

      if (persistedMediaUrl) {
        await prisma.message.update({
          where: {
            channelId_externalId: {
              channelId: channel.id,
              externalId: inboundExternalId,
            },
          },
          data: { mediaUrl: persistedMediaUrl },
        });
      }
    } catch (error) {
      // No bloquear la ingesta: si falla, queda la resolucion perezosa como fallback.
      console.warn("[EVOLUTION] media_persist_failed", {
        conversationId: conversation.id,
        channelId: channel.id,
        externalId: inboundExternalId,
        messageType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const response = NextResponse.json({
    ok: true,
    message: "Inbound message processed",
    instanceName,
    event: eventName,
  });

  // Notificación push "tipo WhatsApp": suena/vibra en el celular del equipo aunque la
  // PWA esté cerrada o en segundo plano. Solo para mensajes ENTRANTES nuevos (no
  // salientes, ni ediciones/borrados). Best-effort: nunca bloquea ni rompe la ingesta.
  if (direction === "INBOUND" && !messageWasEdited && !messageWasDeleted && !isCallEvent) {
    const pushContactName = contact.name?.trim() || phoneNumber;
    const pushBody =
      messageText?.trim() ||
      (messageType === "AUDIO"
        ? "🎤 Audio"
        : messageType === "IMAGE"
          ? "📷 Foto"
          : messageType === "VIDEO"
            ? "🎥 Video"
            : messageType === "DOCUMENT"
              ? "📄 Documento"
              : messageType === "STICKER"
                ? "Sticker"
                : "Nuevo mensaje");

    after(async () => {
      try {
        await sendChatPushToWorkspace({
          workspaceId: channel.workspaceId,
          payload: {
            title: pushContactName,
            body: pushBody,
            tag: `chat:${conversation.id || phoneNumber}`,
            url: "/cliente/chats",
          },
        });
      } catch (error) {
        console.warn("[EVOLUTION] web_push_failed", {
          channelId: channel.id,
          conversationId: conversation.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  after(async () => {
    try {
      const [outboundCount, workspace, conversationAutomationPaused] = await Promise.all([
        existingContact
          ? prisma.message.count({
              where: {
                workspaceId: channel.workspaceId,
                contactId: existingContact.id,
                direction: "OUTBOUND",
              },
            })
          : Promise.resolve(0),
        prisma.workspace.findUnique({
          where: { id: channel.workspaceId },
          select: { businessConfig: true },
        }),
        getConversationAutomationPaused({
          conversationId: conversation.id,
          workspaceId: channel.workspaceId,
        }),
      ]);

      const autoTagNewLeads =
        workspace &&
        workspace.businessConfig !== null &&
        typeof workspace.businessConfig === "object" &&
        !Array.isArray(workspace.businessConfig) &&
        (workspace.businessConfig as { autoTagNewLeads?: unknown }).autoTagNewLeads !== false;
      const newLeadTagName =
        workspace &&
        workspace.businessConfig !== null &&
        typeof workspace.businessConfig === "object" &&
        !Array.isArray(workspace.businessConfig) &&
        typeof (workspace.businessConfig as { newLeadTagName?: unknown }).newLeadTagName === "string"
          ? ((workspace.businessConfig as { newLeadTagName?: string }).newLeadTagName ?? "").trim()
          : "";

      if (autoTagNewLeads) {
        await syncLeadLifecycleForContact({
          workspaceId: channel.workspaceId,
          contactId: contact.id,
          newLeadTagName,
          hasHistory: outboundCount > 0,
        });
      }

      if (messageWasEdited || messageWasDeleted) {
        return;
      }

      if (isCallEvent) {
        return;
      }

      if (!fromMe && !isCallEvent) {
        await cancelPendingFollowsByContact({
          workspaceId: channel.workspaceId,
          contactId: contact.id,
          reason: "Respuesta del cliente",
        });
      }

      if (fromMe && channel.agentId && channel.isActive && channel.evolutionInstanceName && messageText) {
        await cancelPendingFollowsByContact({
          workspaceId: channel.workspaceId,
          contactId: contact.id,
          reason: "Actividad del agente",
        });

        const ownerTriggeredFlow = await resolveEvolutionQuickResponseFlow({
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          manualMessage: messageText,
        });

        if (ownerTriggeredFlow) {
          console.log("[EVOLUTION] owner_triggered_flow", {
            conversationId: conversation.id,
            agentId: channel.agentId,
            keyword: ownerTriggeredFlow.keyword,
            scenarioTitle: ownerTriggeredFlow.scenarioTitle,
            phoneNumber,
          });

          await createFollowsFromRulesForSource({
            workspaceId: channel.workspaceId,
            contactId: contact.id,
            sourceType: "FLOW",
            sourceId: ownerTriggeredFlow.flowId,
            channelId: channel.id,
          });

          try {
            await sendEvolutionPresence({
              instanceName: channel.evolutionInstanceName,
              phoneNumber,
              presence: "composing",
              delay: 800,
            }).catch(() => null);

            for (const step of ownerTriggeredFlow.reply.steps) {
              await sendAndPersistEvolutionFlowStep({
                step,
                workspaceId: channel.workspaceId,
                conversationId: conversation.id,
                channelId: channel.id,
                contactId: contact.id,
                agentId: channel.agentId,
                instanceName: channel.evolutionInstanceName,
                phoneNumber,
              });
            }
      } catch (error) {
        console.error("[EVOLUTION] owner_triggered_flow_failed", {
          conversationId: conversation.id,
          keyword: ownerTriggeredFlow.keyword,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return NextResponse.json({
        ok: true,
        message: "Owner-triggered flow executed",
        instanceName,
        event: eventName,
      });
    }
  }

  if (fromMe && channel.agentId && !isCallEvent) {
    await setConversationAutomationPaused({ conversationId: conversation.id, paused: true });
  }

      if (!fromMe && channel.agentId && !isCallEvent) {
    const workspaceAccess = await enforceWorkspacePlanAccess(channel.workspaceId);

    if (workspaceAccess.planState.blockClientArea) {
      return NextResponse.json({
        ok: true,
        message: "Inbound message logged but auto reply blocked by expired plan",
        instanceName,
        event: eventName,
      });
    }

    const agent = await prisma.agent.findUnique({
      where: { id: channel.agentId },
      select: {
        id: true,
        name: true,
        status: true,
        isActive: true,
        model: true,
        systemPrompt: true,
        welcomeMessage: true,
        fallbackMessage: true,
        trainingConfig: true,
        graph: true,
      },
    });

    if (!agent) {
      console.warn("[EVOLUTION] agent_not_found", {
        channelId: channel.id,
        agentId: channel.agentId,
      });
      return NextResponse.json({
        ok: true,
        message: "Inbound message logged but no matching agent was found",
        instanceName,
        event: eventName,
      });
    }

    const responseDelaySeconds =
      agent.trainingConfig &&
      typeof agent.trainingConfig === "object" &&
      !Array.isArray(agent.trainingConfig) &&
      typeof (agent.trainingConfig as { responseDelaySeconds?: unknown }).responseDelaySeconds === "number" &&
      Number.isFinite((agent.trainingConfig as { responseDelaySeconds?: number }).responseDelaySeconds)
        ? Math.max(
            0,
            Math.min(120, Math.round((agent.trainingConfig as { responseDelaySeconds?: number }).responseDelaySeconds ?? 10)),
          )
        : 10;
    const responseDelayMs = responseDelaySeconds * 1000;

    console.log("[EVOLUTION] agent_loaded", {
      agentId: channel.agentId,
      exists: true,
      status: agent?.status,
      isActive: agent?.isActive,
      hasWelcomeMessage: Boolean(agent?.welcomeMessage),
      hasFallbackMessage: Boolean(agent?.fallbackMessage),
      hasSystemPrompt: Boolean(agent?.systemPrompt),
      model: agent?.model ?? null,
      responseDelaySeconds,
    });

    const bufferNow = new Date();
    const bufferedMessage: AutoReplyBufferMessage = {
      content: (messageText ?? "").trim(),
      type: messageType,
      createdAt: bufferNow.toISOString(),
    };

    const bufferedState = await appendConversationBuffer({
      conversationId: conversation.id,
      bufferedMessage,
      responseDelayMs,
    });

    const batchToken = bufferedState.token;
    const batchStartedAt = new Date(bufferedState.startedAt);
    const batchDueAt = new Date(bufferedState.dueAt);

    if (responseDelayMs > 0) {
      await sleep(responseDelayMs);
    }

    const latestBatchState = await finalizeConversationBuffer({
      conversationId: conversation.id,
      batchToken,
    });

    if (!latestBatchState) {
      console.log("[EVOLUTION] reply_batch_skipped", {
        conversationId: conversation.id,
        agentId: agent.id,
        currentToken: batchToken,
        latestToken: null,
        dueAt: batchDueAt.toISOString(),
      });
      return;
    }

    const latestIncomingAudioTranscript =
      resolvedCurrentMediaUrl && messageType === "AUDIO"
        ? await transcribeAudioForAgent({
            audioUrl: resolvedCurrentMediaUrl,
            model: agent.model,
          })
        : null;

    if (resolvedCurrentMediaUrl && messageType === "AUDIO") {
      console.log("[EVOLUTION] audio_input", {
        conversationId: conversation.id,
        agentId: agent.id,
        messageType,
        mediaUrl: resolvedCurrentMediaUrl,
      });
    }

    if (latestIncomingAudioTranscript) {
      console.log("[EVOLUTION] audio_transcription", {
        conversationId: conversation.id,
        agentId: agent.id,
        messageType,
        transcript: latestIncomingAudioTranscript,
      });
    } else if (resolvedCurrentMediaUrl && messageType === "AUDIO") {
      console.log("[EVOLUTION] audio_transcription_missing", {
        conversationId: conversation.id,
        agentId: agent.id,
        messageType,
        mediaUrl: resolvedCurrentMediaUrl,
      });
    }

    // No analizar imagenes de stickers, ni cuando el agente esta apagado.
    const agentIsActive = Boolean(agent?.isActive && agent.status === "ACTIVE");
    const shouldAnalyzeImage = Boolean(
      resolvedCurrentMediaUrl && messageType === "IMAGE" && agentIsActive,
    );

    let latestIncomingImageAnalysis: string | null = null;
    latestIncomingImageAnalysis = shouldAnalyzeImage && resolvedCurrentMediaUrl
      ? await analyzeImageForAgent({
          imageUrl: resolvedCurrentMediaUrl,
          model: agent.model,
        })
      : null;

    if (latestIncomingImageAnalysis) {
      console.log("[EVOLUTION] image_analysis", {
        conversationId: conversation.id,
        agentId: agent.id,
        messageType,
        analysis: latestIncomingImageAnalysis,
      });
    } else if (shouldAnalyzeImage) {
      console.log("[EVOLUTION] image_analysis_missing", {
        conversationId: conversation.id,
        agentId: agent.id,
        messageType,
      });
    }

    const batchedInboundMessages = latestBatchState.currentBuffer.messages;
    const batchedInboundText = buildAutoReplyBufferText(
      batchedInboundMessages,
      latestIncomingAudioTranscript,
      latestIncomingImageAnalysis,
    );

    const inboundTextForProcessing = (batchedInboundText.trim() || messageText?.trim() || latestIncomingAudioTranscript || "").trim();
    const hasInboundContent = Boolean(inboundTextForProcessing || resolvedCurrentMediaUrl);

    if (process.env.NODE_ENV !== "production") {
      console.info("[EVOLUTION] inbound_batch_debug", {
        conversationId: conversation.id,
        batchToken,
        batchWindowStart: batchStartedAt.toISOString(),
        batchWindowEnd: batchDueAt.toISOString(),
        batchedInboundCount: batchedInboundMessages.length,
        batchedInboundText: batchedInboundText.trim(),
        inboundTextForProcessing,
        messageText: messageText?.trim() || "",
        latestIncomingAudioTranscript: latestIncomingAudioTranscript?.trim() || "",
        latestIncomingImageAnalysis: latestIncomingImageAnalysis?.trim() || "",
      });
    }

      let quickResponseFlow = channel.isActive && !conversationAutomationPaused && channel.evolutionInstanceName && inboundTextForProcessing
        ? await resolveEvolutionQuickResponseFlow({
            workspaceId: channel.workspaceId,
            channelId: channel.id,
            manualMessage: inboundTextForProcessing,
          })
        : null;

      if (
        channel.isActive &&
        !conversationAutomationPaused &&
        channel.evolutionInstanceName &&
        hasInboundContent &&
        (quickResponseFlow || (agent?.isActive && agent.status === "ACTIVE"))
      ) {
      const existingOutbound = await prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          direction: "OUTBOUND",
          // Las notas de timeline (auto-asignación, tags, etapas, etc.) se
          // guardan como OUTBOUND/SYSTEM y NO son respuestas reales del bot.
          // Si las contáramos, la bienvenida quedaría suprimida en toda
          // conversación nueva (siempre hay una nota de auto-asignación).
          type: { not: "SYSTEM" },
        },
        select: { id: true },
      });

        let replyText: string | null = null;

      const recentMessages = (await prisma.message.findMany({
        where: {
          conversationId: conversation.id,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 12,
        select: {
          direction: true,
          content: true,
          type: true,
          mediaUrl: true,
        },
      }))
        .reverse()
        .map((m) => ({
          direction: m.direction,
          content: m.content,
          type: m.type as "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "TEMPLATE" | "INTERACTIVE" | "SYSTEM" | undefined,
          mediaUrl: m.mediaUrl,
        }));
      const recentMessagesForModel =
        resolvedCurrentMediaUrl && recentMessages.length > 0
          ? recentMessages.map((message, index) =>
              index === recentMessages.length - 1 && (message.type === "IMAGE" || message.type === "STICKER")
                ? { ...message, mediaUrl: resolvedCurrentMediaUrl }
                : message,
            )
          : recentMessages;
      const executedFlowSlugs = await getConversationExecutedFlowSlugs({
        workspaceId: channel.workspaceId,
        conversationId: conversation.id,
      });
      const aiContextNotes = new Set<string>();
      const activeProductContextNote = buildActiveProductContextNote(
        (existingConversation?.activeProductContext as ActiveProductContext | null | undefined) ?? null,
      );
      if (activeProductContextNote) {
        aiContextNotes.add(activeProductContextNote);
      }

      const agentTraining = parseAgentTrainingConfig(agent.trainingConfig);

      const notifyHumanAction = resolveNotifyHumanAction({
        trainingConfig: agent.trainingConfig,
        agentName: agent.name,
        customerPhoneNumber: phoneNumber,
        customerName: contact.name,
        latestUserMessage: inboundTextForProcessing,
        history: recentMessagesForModel,
        commercialContext: conversation.commercialContext,
      });
      const notifyHumanPromise = notifyHumanAction && channel.evolutionInstanceName
        ? sendEvolutionTextMessageWithReconnect({
            instanceName: channel.evolutionInstanceName,
            phoneNumber: notifyHumanAction.destinationPhoneNumber,
            text: notifyHumanAction.message,
            delayMs: 0,
          }).catch((error) => {
            console.warn("[EVOLUTION] human_notification_failed", {
              conversationId: conversation.id,
              agentId: agent.id,
              phoneNumber,
              destinationPhoneNumber: notifyHumanAction.destinationPhoneNumber,
              error: error instanceof Error ? error.message : String(error),
            });
            return null;
          })
        : null;
      const shouldHandoffToHuman = Boolean(notifyHumanAction);

      if (shouldHandoffToHuman) {
        await setConversationAutomationPaused({ conversationId: conversation.id, paused: true });
      }

      if (quickResponseFlow && !quickResponseFlow.replyEveryMessageEnabled) {
      const quickFlowSlug = getFlowSlug(quickResponseFlow.scenarioTitle);
        if (executedFlowSlugs.has(quickFlowSlug)) {
          const note = buildFlowExecutionContextNote({
            flowTitle: quickResponseFlow.scenarioTitle,
            modeLabel: "flujo",
          });
          if (note) {
            aiContextNotes.add(note);
          }
          quickResponseFlow = null;
        }
      }

      if (quickResponseFlow?.flowId) {
        await createFollowsFromRulesForSource({
          workspaceId: channel.workspaceId,
          contactId: contact.id,
          sourceType: "FLOW",
          sourceId: quickResponseFlow.flowId,
          channelId: channel.id,
        });
      }

      const previousCommercialContext = parseCommercialConversationContext(conversation.commercialContext);
      const previousActiveProductContext = (existingConversation?.activeProductContext as ActiveProductContext | null | undefined) ?? null;

      const hardFlowResolution = shouldHandoffToHuman || quickResponseFlow
        ? null
        : await resolveAgentProductFlowReply({
            agentId: agent.id,
            workspaceId: channel.workspaceId,
            latestUserMessage: inboundTextForProcessing,
            history: recentMessagesForModel,
            includeOfficialApi: true,
            commercialContext: previousCommercialContext,
            activeProductContext: previousActiveProductContext,
          });
      let hardFlowReply = hardFlowResolution?.steps
        ? hardFlowResolution
        : null;

      const previousCommercialStage = previousCommercialContext?.currentStage ?? null;
      const commercialStageResolution = classifyCommercialStage({
        latestUserMessage: inboundTextForProcessing,
        history: recentMessagesForModel,
        activeProductContext: hardFlowResolution?.activeProductContext ?? previousActiveProductContext,
        previousStage: previousCommercialStage,
        commercialContext: previousCommercialContext,
      });
      const commercialConversationContext = buildCommercialConversationContext({
        stage: commercialStageResolution,
        latestUserMessage: inboundTextForProcessing,
        history: recentMessagesForModel,
        activeProductContext: hardFlowResolution?.activeProductContext ?? previousActiveProductContext,
        previousContext: previousCommercialContext,
      });
      const conversationUpdateData: Prisma.ConversationUpdateInput = {
        commercialContext: commercialConversationContext as unknown as Prisma.InputJsonValue,
      };
      if (hardFlowResolution?.activeProductContext) {
        conversationUpdateData.activeProductContext = hardFlowResolution.activeProductContext as Prisma.InputJsonValue;
      }

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: conversationUpdateData,
      });

      // Agente V2: al llegar el lead a una etapa nueva (con el producto activo),
      // agenda los nodos Seguimiento anclados a esa etapa. Reglas AGENT_NODE; el
      // helper deduplica (no re-agenda si ya hay un follow PENDING de esa regla).
      const stageFollowProductId =
        hardFlowResolution?.activeProductContext?.productId ??
        previousActiveProductContext?.productId ??
        "";
      const newCommercialStage = commercialConversationContext.currentStage;
      if (
        agent.graph &&
        stageFollowProductId &&
        newCommercialStage &&
        newCommercialStage !== previousCommercialStage
      ) {
        try {
          const stageFollowRuleIds = resolveAgentV2StageFollowRuleIds({
            graph: agent.graph,
            productId: stageFollowProductId,
            currentStage: newCommercialStage,
          });
          for (const ruleId of stageFollowRuleIds) {
            await scheduleFollowRuleForContact({
              workspaceId: channel.workspaceId,
              contactId: contact.id,
              ruleId,
              channelId: channel.id,
            });
          }
          if (stageFollowRuleIds.length) {
            console.log("[EVOLUTION] agent_v2_stage_follows", {
              conversationId: conversation.id,
              productId: stageFollowProductId,
              stage: newCommercialStage,
              scheduled: stageFollowRuleIds.length,
            });
          }
        } catch (error) {
          console.error("[EVOLUTION] agent_v2_stage_follows_error", {
            conversationId: conversation.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Los modos default/ia enganchan en dos turnos: el contexto del producto
      // solo se inyecta cuando el producto ya estaba activo. En modo CHATBOT
      // (activacion por palabras clave) el envio es deterministico, asi que si
      // no hubo un flujo que enviar le damos el contexto a la IA desde el primer
      // turno para que responda sobre el producto y no solo con el saludo.
      const resolvedActiveProductContext = hardFlowResolution?.activeProductContext ?? null;
      const resolvedProductIsChatbot = /Activacion:\s*chatbot/i.test(
        resolvedActiveProductContext?.instructions ?? "",
      );
      if (
        resolvedActiveProductContext &&
        (previousActiveProductContext || (resolvedProductIsChatbot && !hardFlowReply))
      ) {
        const activeProductContextNote = buildActiveProductContextNote(resolvedActiveProductContext);
        if (activeProductContextNote) {
          aiContextNotes.add(activeProductContextNote);
        }
      }

      aiContextNotes.add(buildCommercialStagePromptSection(commercialStageResolution));
      aiContextNotes.add(buildCommercialConversationContextPromptSection(commercialConversationContext));

      const hasActiveProductContext = Boolean(hardFlowResolution?.activeProductContext);
      if (hardFlowReply) {
        const hardFlowSlug = getFlowSlug(hardFlowReply.flowTitle ?? "");
        if (executedFlowSlugs.has(hardFlowSlug)) {
          const note = buildFlowExecutionContextNote({
            flowTitle: hardFlowReply.flowTitle ?? "flujo",
            modeLabel: "flujo",
          });
          if (note) {
            aiContextNotes.add(note);
          }
          hardFlowReply = null;
        }
      }

      if (
        hardFlowResolution?.activeProductContext?.productId &&
        previousActiveProductContext?.productId !== hardFlowResolution.activeProductContext.productId
      ) {
        await createFollowsFromRulesForSource({
          workspaceId: channel.workspaceId,
          contactId: contact.id,
          sourceType: "PRODUCT",
          sourceId: hardFlowResolution.activeProductContext.productId,
          channelId: channel.id,
        });
      }

      if (hardFlowReply?.flowId) {
        await createFollowsFromRulesForSource({
          workspaceId: channel.workspaceId,
          contactId: contact.id,
          sourceType: "FLOW",
          sourceId: hardFlowReply.flowId,
          channelId: channel.id,
        });
      }

      const knowledgeBaseReply = hardFlowReply
        ? null
        : shouldHandoffToHuman
          ? null
          : shouldPrioritizeCommercialStageOverFaq(commercialStageResolution.currentStage)
            ? null
          : await resolveAgentKnowledgeBaseReply({
              agentId: agent.id,
              workspaceId: channel.workspaceId,
              conversationId: conversation.id,
              latestUserMessage: inboundTextForProcessing,
              history: recentMessagesForModel,
            });

      const autoUnknownProductNotifyAction =
        !shouldHandoffToHuman &&
        !hasActiveProductContext &&
        !hardFlowReply &&
        !knowledgeBaseReply &&
        agentTraining?.actions.notify.autoNotifyOnUnknownProduct
          ? resolveUnknownProductNotifyAction({
              trainingConfig: agent.trainingConfig,
              agentName: agent.name,
              customerPhoneNumber: phoneNumber,
              customerName: contact.name,
              latestUserMessage: inboundTextForProcessing,
            })
          : null;
      const autoUnknownProductNotifyPromise = autoUnknownProductNotifyAction && channel.evolutionInstanceName
        ? sendNotificarAsesorNotification({
            trainingConfig: agent.trainingConfig,
            agentName: agent.name,
            customerPhoneNumber: phoneNumber,
            customerName: contact.name,
            latestUserMessage: inboundTextForProcessing,
            toolInput: {
              motivo: "Cliente pidió un producto o catálogo que no existe en la base de conocimiento",
              prioridad: "media",
              resumen_cliente: inboundTextForProcessing,
              ultimo_mensaje: inboundTextForProcessing,
            },
            sendMessage: async (destinationPhoneNumber, text) => {
              if (!channel.evolutionInstanceName) {
                throw new Error("La instancia de Evolution no esta disponible");
              }

              return sendEvolutionTextMessageWithReconnect({
                instanceName: channel.evolutionInstanceName,
                phoneNumber: destinationPhoneNumber,
                text,
                delayMs: 0,
              });
            },
          }).catch((error) => {
            console.warn("[EVOLUTION] auto_unknown_product_notification_failed", {
              conversationId: conversation.id,
              agentId: agent.id,
              phoneNumber,
              error: error instanceof Error ? error.message : String(error),
            });
            return null;
          })
        : null;
      const commercialStagePrompt = buildCommercialStagePromptSection(commercialStageResolution);
      const commercialContextPrompt = buildCommercialConversationContextPromptSection(commercialConversationContext);

      let shouldComposeWelcome = true;

      if (shouldHandoffToHuman) {
        replyText = notifyHumanAction?.customerMessage ?? buildHandoffMessage();
        shouldComposeWelcome = false;
      } else if (quickResponseFlow) {
        replyText = null;
        shouldComposeWelcome = false;
      } else if (hardFlowReply) {
        // steps executed directly in the flow engine block below
        replyText = null;
        shouldComposeWelcome = false;
      } else if (autoUnknownProductNotifyAction) {
        replyText = "👨🏻‍💻 Un asesor te atenderá en breve ⏰";
        shouldComposeWelcome = true;
      } else if (knowledgeBaseReply) {
        replyText = knowledgeBaseReply.text ?? null;
        shouldComposeWelcome = Boolean(replyText);
      } else {
        const latestConversationMatch = await getLatestConversationMatch({
          workspaceId: channel.workspaceId,
          conversationId: conversation.id,
        });
        const matchContextNote = latestConversationMatch ? buildConversationMatchContextNote(latestConversationMatch) : null;
        if (matchContextNote) {
          aiContextNotes.add(matchContextNote);
        }
        const aiLatestUserMessage = aiContextNotes.size > 0
          ? `${Array.from(aiContextNotes).join("\n")}\n\nMensaje del cliente: ${inboundTextForProcessing}`
          : inboundTextForProcessing;
        const aiLatestUserMessageWithImageContext =
          latestIncomingImageAnalysis
            ? `${aiLatestUserMessage}\n\nAnalisis visual de la imagen del cliente: ${latestIncomingImageAnalysis}`
            : aiLatestUserMessage;
        const effectiveSystemPrompt = agentTraining?.useCustomPrompt && agentTraining.customSystemPrompt?.trim()
          ? `${agentTraining.customSystemPrompt.trim()}\n\n${commercialStagePrompt}\n\n${commercialContextPrompt}`
          : `${agent.systemPrompt}\n\n${commercialStagePrompt}\n\n${commercialContextPrompt}`;
        const toolHandlers = {
          Notificar_asesor: async (args: Record<string, unknown>) => {
            const result = await sendNotificarAsesorNotification({
              trainingConfig: agent.trainingConfig,
              agentName: agent.name,
              customerPhoneNumber: phoneNumber,
              customerName: contact.name,
              latestUserMessage: inboundTextForProcessing,
              toolInput: args,
              sendMessage: async (destinationPhoneNumber, text) => {
                if (!channel.evolutionInstanceName) {
                  throw new Error("La instancia de Evolution no esta disponible");
                }

                return sendEvolutionTextMessageWithReconnect({
                  instanceName: channel.evolutionInstanceName,
                  phoneNumber: destinationPhoneNumber,
                  text,
                  delayMs: 0,
                });
              },
            });

            if (result.ok && agentTraining?.actions.notify.pauseConversationAfterNotify) {
              await setConversationAutomationPaused({ conversationId: conversation.id, paused: true });
            }

            return result;
          },
          consultar_productos: async (args: Record<string, unknown>) => {
            const result = await executeConsultarProductosTool({
              agentId: agent.id,
              toolInput: args,
            });

            return result ?? { found: false, matches: [], bestMatch: null, recommendation: "No hay coincidencias suficientes." };
          },
          consultar_flujos: async (args: Record<string, unknown>) => {
            const currentActiveProductContext =
              (hardFlowResolution?.activeProductContext ?? (existingConversation?.activeProductContext as ActiveProductContext | null | undefined) ?? null);
            const result = await executeConsultarFlujosTool({
              workspaceId: channel.workspaceId,
              includeOfficialApi: true,
              toolInput: args,
              allowedFlowIds: agentTraining?.knowledgeFlowIds?.length ? agentTraining.knowledgeFlowIds : undefined,
              enabledChildFlowIds: currentActiveProductContext?.followUpFlowId?.trim()
                ? [currentActiveProductContext.followUpFlowId.trim()]
                : undefined,
            });

            return result ?? { found: false, matches: [], bestMatch: null, recommendation: "No hay coincidencias suficientes." };
          },
        } satisfies Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
        // Los toggles "Consultar productos/flujos" (Agente V2) deciden qué tools se
        // ofrecen. En V1/configs antiguas ambos flags son true => se ofrecen las tres.
        const agentTools = [
          NOTIFICAR_ASESOR_TOOL,
          ...(agentTraining?.enableProductLookup !== false ? [CONSULTAR_PRODUCTOS_TOOL] : []),
          ...(agentTraining?.enableFlowLookup !== false ? [CONSULTAR_FLUJOS_TOOL] : []),
        ];
        replyText = await generateAgentReply({
          model: agent.model,
          systemPrompt: effectiveSystemPrompt,
          fallbackMessage: agent.fallbackMessage,
          history: recentMessagesForModel,
          latestUserMessage: aiLatestUserMessageWithImageContext,
          tools: agentTools,
          toolHandlers,
        });

        if (shouldOverrideCommercialReply(replyText ?? "", commercialConversationContext)) {
          replyText = buildNegotiationAdvanceReply({
            latestUserMessage: inboundTextForProcessing,
            activeProductContext: (hardFlowResolution?.activeProductContext ?? (existingConversation?.activeProductContext as ActiveProductContext | null | undefined) ?? null),
          });
        }
      }

      if (shouldComposeWelcome) {
        replyText = composeAgentWelcomeReply({
          welcomeMessage: agent.welcomeMessage,
          reply: replyText,
          // Usamos el historial saliente real como señal de primer contacto.
          // Eso evita volver a anteponer el saludo si la conversación ya tuvo una respuesta del bot.
          hasConversationHistory: Boolean(existingOutbound),
        });
      }

      console.log("[EVOLUTION] auto_reply_mode", {
        conversationId: conversation.id,
        agentId: agent.id,
        mode: shouldHandoffToHuman ? "handoff" : quickResponseFlow ? "quick_flow" : !existingOutbound ? "first_turn_ai" : "ai",
        hardFlow: shouldHandoffToHuman ? null : quickResponseFlow?.scenarioTitle ?? hardFlowReply?.flowTitle ?? null,
        usedFallback:
          replyText?.trim() === (agent.fallbackMessage?.trim() || "").trim(),
        historyCount: recentMessages.length,
      });

      const knowledgeImageReply = shouldHandoffToHuman ? null : knowledgeBaseReply?.image ?? null;
      const imageReply = knowledgeImageReply;
      const contactMatchTasks: Array<Promise<unknown>> = [];
      if (quickResponseFlow?.scenarioTitle) {
        contactMatchTasks.push(
          recordContactMatch({
            workspaceId: channel.workspaceId,
            contactId: contact.id,
            conversationId: conversation.id,
            matchType: "FLOW",
            sourceType: "QUICK_RESPONSE",
            targetName: quickResponseFlow.scenarioTitle,
            targetId: null,
          }),
        );
      }
      if (hardFlowReply?.flowTitle) {
        contactMatchTasks.push(
          recordContactMatch({
            workspaceId: channel.workspaceId,
            contactId: contact.id,
            conversationId: conversation.id,
            matchType: "FLOW",
            sourceType: "FLOW",
            targetName: hardFlowReply.flowTitle,
            targetId: null,
          }),
        );
      }
      if (hardFlowReply?.productName) {
        contactMatchTasks.push(
          recordContactMatch({
            workspaceId: channel.workspaceId,
            contactId: contact.id,
            conversationId: conversation.id,
            matchType: "PRODUCT",
            sourceType: "FLOW",
            targetName: hardFlowReply.productName,
            targetId: null,
          }),
        );
      }
      if (knowledgeBaseReply?.productName) {
        contactMatchTasks.push(
          recordContactMatch({
            workspaceId: channel.workspaceId,
            contactId: contact.id,
            conversationId: conversation.id,
            matchType: "PRODUCT",
            sourceType: "KNOWLEDGE",
            targetName: knowledgeBaseReply.productName,
            targetId: null,
          }),
        );
      }

      if (contactMatchTasks.length > 0) {
        await Promise.allSettled(contactMatchTasks);
      }


      // Flow engine: execute quick/hard flow steps in exact order.
      const orderedFlowSteps = shouldHandoffToHuman ? [] : quickResponseFlow?.reply.steps ?? hardFlowReply?.steps ?? [];
      const orderedFlowMode = quickResponseFlow ? "quick_flow" : "hard_flow";
      if (orderedFlowSteps.length > 0) {
        try {
          console.log("[EVOLUTION] auto_reply_sending", {
            conversationId: conversation.id,
            agentId: agent.id,
            phoneNumber,
            instanceName: channel.evolutionInstanceName,
            mode: orderedFlowMode,
            steps: orderedFlowSteps.map((s) => s.kind),
          });

          try {
            await sendEvolutionPresence({
              instanceName: channel.evolutionInstanceName,
              phoneNumber,
              presence: "composing",
              delay: responseDelayMs,
            });
          } catch {
            // presence is best-effort
          }

          // La bienvenida (solo en el primer contacto) se envía como SU PROPIO mensaje
          // ANTES del flujo. Antes se anteponía al primer paso de TEXTO del flujo, lo que
          // la dejaba al final y desordenada cuando el flujo manda media (PDF/foto) antes
          // del texto. Ahora cualquier flujo se entrega ordenado: bienvenida → pasos del
          // flujo en su orden exacto.
          if (!existingOutbound && agent.welcomeMessage?.trim()) {
            const welcomeText = agent.welcomeMessage.trim();
            const welcomeOutbound = await sendEvolutionTextMessageWithReconnect({
              instanceName: channel.evolutionInstanceName,
              phoneNumber,
              text: welcomeText,
              delayMs: 0,
            });
            await persistEvolutionMessage({
              data: {
                workspaceId: channel.workspaceId,
                conversationId: conversation.id,
                channelId: channel.id,
                contactId: contact.id,
                agentId: agent.id,
                externalId: welcomeOutbound.externalId,
                direction: "OUTBOUND",
                type: "TEXT",
                status: "SENT",
                content: welcomeText,
                sentAt: new Date(),
                rawPayload: welcomeOutbound.raw as never,
              },
            });
          }

          for (const [flowStepIndex, step] of orderedFlowSteps.entries()) {
            // Respiro entre pasos: mandar medios pesados seguidos (p.ej. PDFs de 7-15MB) tumba
            // la WS de evogo y los siguientes archivos no salen. Damos una pausa GRANDE antes de
            // cada medio (para que la conexión se estabilice tras la subida anterior) y una
            // corta entre textos.
            if (flowStepIndex > 0) {
              const isMediaStep =
                step.kind === "document" ||
                step.kind === "image" ||
                step.kind === "video" ||
                step.kind === "audio";
              await sleep(isMediaStep ? 3000 : 700);
            }
            await sendAndPersistEvolutionFlowStepResilient({
              step,
              workspaceId: channel.workspaceId,
              conversationId: conversation.id,
              channelId: channel.id,
              contactId: contact.id,
              agentId: agent.id,
              instanceName: channel.evolutionInstanceName,
              phoneNumber,
            });
          }

          if (notifyHumanPromise) await notifyHumanPromise;
          const autoUnknownProductNotifyResult = autoUnknownProductNotifyPromise
            ? await autoUnknownProductNotifyPromise
            : null;
          if (autoUnknownProductNotifyResult?.ok && agentTraining?.actions.notify.pauseConversationAfterNotify) {
            await setConversationAutomationPaused({ conversationId: conversation.id, paused: true });
          }
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: new Date(), status: "OPEN" },
          });

          console.log("[EVOLUTION] auto_reply_sent", {
            conversationId: conversation.id,
            agentId: agent.id,
            phoneNumber,
            mode: orderedFlowMode,
            stepsCount: orderedFlowSteps.length,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? (error.stack || error.message) : JSON.stringify(error);
          if (errorMessage.toLowerCase().includes("connection closed")) {
            const recovery = await ensureEvolutionInstanceReady(channel.evolutionInstanceName);
            console.warn("[EVOLUTION] auto_reply_connection_closed", {
              conversationId: conversation.id,
              agentId: agent.id,
              instanceName: channel.evolutionInstanceName,
              recovered: recovery.recovered,
              state: recovery.state,
            });
          }
          console.error(`[EVOLUTION] auto_reply_failed conversationId=${conversation.id} agentId=${agent.id} phone=${phoneNumber} instance=${channel.evolutionInstanceName} error=${errorMessage}`);
          await persistEvolutionMessage({
            data: {
              workspaceId: channel.workspaceId,
              conversationId: conversation.id,
              channelId: channel.id,
              contactId: contact.id,
              agentId: agent.id,
              direction: "OUTBOUND",
              type: "TEXT",
              status: "FAILED",
              content: orderedFlowSteps.find((s) => s.kind === "text")?.content ?? null,
              failedAt: new Date(),
            },
          });
        }
      } else if (replyText || knowledgeImageReply) {
        try {
          console.log("[EVOLUTION] auto_reply_sending", {
            conversationId: conversation.id,
            agentId: agent.id,
            phoneNumber,
            instanceName: channel.evolutionInstanceName,
            preview: replyText?.slice(0, 80) ?? "",
            withImage: Boolean(knowledgeImageReply),
          });

            try {
              await sendEvolutionPresence({
                instanceName: channel.evolutionInstanceName,
                phoneNumber,
                presence: "composing",
                delay: responseDelayMs,
              });
            } catch (presenceError) {
              console.warn("[EVOLUTION] presence_failed", {
                conversationId: conversation.id,
                agentId: agent.id,
                phoneNumber,
                instanceName: channel.evolutionInstanceName,
                error: presenceError instanceof Error ? presenceError.message : String(presenceError),
              });
            }

            const sendText = async () => {
              if (!replyText || !channel.evolutionInstanceName) return;
              const outbound = await sendEvolutionTextMessageWithReconnect({
                instanceName: channel.evolutionInstanceName,
                phoneNumber,
                text: replyText,
                delayMs: 0,
              });
              await persistEvolutionMessage({
                data: {
                  workspaceId: channel.workspaceId,
                  conversationId: conversation.id,
                  channelId: channel.id,
                  contactId: contact.id,
                  agentId: agent.id,
                  externalId: outbound.externalId,
                  direction: "OUTBOUND",
                  type: "TEXT",
                  status: "SENT",
                  content: replyText,
                  sentAt: new Date(),
                  rawPayload: outbound.raw as never,
                },
              });
            };

            if (imageReply) {
              const imageOutbound = await sendEvolutionImageMessage({
                instanceName: channel.evolutionInstanceName,
                phoneNumber,
                imageUrl: imageReply.url,
                caption: imageReply.caption,
                delayMs: 0,
              });
              await persistEvolutionMessage({
                data: {
                  workspaceId: channel.workspaceId,
                  conversationId: conversation.id,
                  channelId: channel.id,
                  contactId: contact.id,
                  agentId: agent.id,
                  externalId: imageOutbound.externalId,
                  direction: "OUTBOUND",
                  type: "IMAGE",
                  status: "SENT",
                  content: imageReply.caption,
                  mediaUrl: imageReply.url,
                  sentAt: new Date(),
                  rawPayload: imageOutbound.raw as never,
                },
              });
              await sendText();
            } else {
              await sendText();
            }


            if (notifyHumanPromise) {
              await notifyHumanPromise;
            }
            const autoUnknownProductNotifyResult = autoUnknownProductNotifyPromise
              ? await autoUnknownProductNotifyPromise
              : null;
            if (autoUnknownProductNotifyResult?.ok && agentTraining?.actions.notify.pauseConversationAfterNotify) {
              await setConversationAutomationPaused({ conversationId: conversation.id, paused: true });
            }

            await prisma.conversation.update({
              where: { id: conversation.id },
              data: {
                lastMessageAt: new Date(),
                status: "OPEN",
              },
            });

          console.log("[EVOLUTION] auto_reply_sent", {
            conversationId: conversation.id,
            agentId: agent.id,
            phoneNumber,
            sentText: Boolean(replyText),
            sentImage: Boolean(knowledgeImageReply),
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? (error.stack || error.message) : JSON.stringify(error);

          if (errorMessage.toLowerCase().includes("connection closed")) {
            const recovery = await ensureEvolutionInstanceReady(channel.evolutionInstanceName);

            console.warn("[EVOLUTION] auto_reply_connection_closed", {
              conversationId: conversation.id,
              agentId: agent.id,
              instanceName: channel.evolutionInstanceName,
              recovered: recovery.recovered,
              state: recovery.state,
              hasQrCode: Boolean(recovery.qrCode),
              hasPairingCode: Boolean(recovery.pairingCode),
            });
          }

          console.error(
            `[EVOLUTION] auto_reply_failed conversationId=${conversation.id} agentId=${agent.id} phone=${phoneNumber} instance=${channel.evolutionInstanceName} error=${errorMessage}`,
          );

          await persistEvolutionMessage({
            data: {
              workspaceId: channel.workspaceId,
              conversationId: conversation.id,
              channelId: channel.id,
              contactId: contact.id,
              agentId: agent.id,
              direction: "OUTBOUND",
              type: knowledgeImageReply ? "IMAGE" : "TEXT",
              status: "FAILED",
              content: replyText || knowledgeImageReply?.caption || null,
              mediaUrl: knowledgeImageReply?.url ?? null,
              failedAt: new Date(),
            },
          });
        }
        } else {
        // noop: no reply generated
      }
    } else {
      // noop: auto-reply intentionally skipped
    }

    // Resumen IA del historial del cliente para el CRM (best-effort, no bloquea la respuesta).
    try {
      await summarizeContactHistory({
        workspaceId: channel.workspaceId,
        contactId: contact.id,
      });
    } catch (summaryError) {
      console.error("[EVOLUTION] contact_summary_failed", {
        conversationId: conversation.id,
        contactId: contact.id,
        error: summaryError instanceof Error ? summaryError.message : String(summaryError),
      });
    }
  } else {
    // noop: channel without agent
  }

    } catch (error) {
      console.error("[EVOLUTION] post_response_processing_failed", {
        conversationId: conversation.id,
        contactId: contact.id,
        phoneNumber,
        error: error instanceof Error ? error.stack || error.message : String(error),
      });
    }
  });

  return response;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Evolution webhook endpoint is ready",
  });
}


