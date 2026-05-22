import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { after } from "next/server";
import { NextResponse } from "next/server";
import { analyzeImageForAgent, generateAgentReply, transcribeAudioForAgent } from "@/lib/agent-ai";
import {
  buildActiveProductContextNote,
  resolveAgentProductFlowReply,
  type ActiveProductContext,
} from "@/lib/agent-product-flow";
import { composeAgentWelcomeReply } from "@/lib/agent-reply-composer";
import { getConversationAutomationPaused, setConversationAutomationPaused } from "@/lib/conversation-automation";
import { prisma } from "@/lib/prisma";
import { resolveEvolutionQuickResponseFlow } from "@/features/flows/services/resolveEvolutionQuickResponseFlow";
import {
  extractEvolutionConnectionState,
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
  extractEvolutionQrCode,
  extractEvolutionRemoteJid,
  hasEvolutionCallPayload,
  hasEvolutionDeletedMessagePayload,
  hasEvolutionEditedMessagePayload,
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

function mapChannelStatus(eventName: string | null, rawState: string | null) {
  const state = rawState?.toLowerCase() ?? "";

  if (eventName === "QRCODE_UPDATED") {
    return "QRCODE" as const;
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);

  if (!payload) {
    return NextResponse.json({ ok: false, message: "Invalid JSON payload" }, { status: 400 });
  }

  const settings = await getEvolutionSettings();
  const providedSecret =
    request.headers.get("x-webhook-secret") ||
    request.headers.get("x-evolution-secret") ||
    request.headers.get("authorization");

  if (settings.webhookSecret) {
    const normalizedSecret = providedSecret?.replace(/^Bearer\s+/i, "").trim();
    if (normalizedSecret !== settings.webhookSecret) {
      return NextResponse.json({ ok: false, message: "Unauthorized webhook" }, { status: 401 });
    }
  }

  const eventName = extractEvolutionEventName(payload);
  const instanceName = extractEvolutionInstanceName(payload);
  const channelPhoneNumber = normalizePhoneFromJid(extractEvolutionPhoneNumber(payload));
  const isConnectionEvent = eventName === "QRCODE_UPDATED" || eventName === "CONNECTION_UPDATE";
  const isCallEvent = hasEvolutionCallPayload(payload);

  let channel = instanceName
    ? await prisma.whatsAppChannel.findUnique({
        where: { evolutionInstanceName: instanceName },
        select: {
          id: true,
          workspaceId: true,
          agentId: true,
          name: true,
          isActive: true,
          evolutionInstanceName: true,
          status: true,
          phoneNumber: true,
          qrCode: true,
        },
      })
    : null;

  if (!channel && channelPhoneNumber) {
    channel = await prisma.whatsAppChannel.findFirst({
      where: {
        provider: "EVOLUTION",
        phoneNumber: channelPhoneNumber,
      },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        workspaceId: true,
        agentId: true,
        name: true,
        isActive: true,
        evolutionInstanceName: true,
        status: true,
        phoneNumber: true,
        qrCode: true,
      },
    });
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
    const qrCode = extractEvolutionQrCode(payload);
    const pairingCode = extractEvolutionPairingCode(payload);
    const phoneNumber = normalizePhoneFromJid(extractEvolutionPhoneNumber(payload));
    const nextStatus = mapChannelStatus(eventName, extractEvolutionConnectionState(payload));

    await prisma.whatsAppChannel.update({
      where: { id: channel.id },
      data: {
        ...(qrCode ? { qrCode, status: "QRCODE" } : {}),
        ...(phoneNumber ? { phoneNumber } : {}),
        ...(pairingCode ? { metadata: { pairingCode } } : {}),
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

    return NextResponse.json({
      ok: true,
      message: "Channel state updated",
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
  let phoneNumber = normalizePhoneFromJid(remoteJid);
  const callDirection = isCallEvent ? extractEvolutionCallDirection(payload) : null;
  const fromMe = extractEvolutionFromMe(payload);
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
      ...(direction === "OUTBOUND" ? { sentAt: new Date() } : {}),
    };

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
        await persistEvolutionMessage({
          data: {
            ...messageData,
            content: messageText,
            deletedAt: new Date(),
          },
        });
        shouldTouchConversation = true;
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

  const response = NextResponse.json({
    ok: true,
    message: "Inbound message processed",
    instanceName,
    event: eventName,
  });

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

      if (fromMe && channel.agentId && channel.isActive && channel.evolutionInstanceName && messageText) {
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

      try {
        await sendEvolutionPresence({
          instanceName: channel.evolutionInstanceName,
          phoneNumber,
          presence: "composing",
          delay: 800,
        }).catch(() => null);

        if (ownerTriggeredFlow.reply.image) {
          const imageOutbound = await sendEvolutionImageMessage({
            instanceName: channel.evolutionInstanceName,
            phoneNumber,
            imageUrl: ownerTriggeredFlow.reply.image.url,
            caption: ownerTriggeredFlow.reply.image.caption,
            delayMs: 0,
          });
          await persistEvolutionMessage({
            data: {
              workspaceId: channel.workspaceId,
              conversationId: conversation.id,
              channelId: channel.id,
              contactId: contact.id,
              agentId: channel.agentId,
              externalId: imageOutbound.externalId,
              direction: "OUTBOUND",
              type: "IMAGE",
              status: "SENT",
              content: ownerTriggeredFlow.reply.image.caption,
              mediaUrl: ownerTriggeredFlow.reply.image.url,
              sentAt: new Date(),
              rawPayload: imageOutbound.raw as never,
            },
              });
            }

        if (ownerTriggeredFlow.reply.audio) {
          const audioOutbound = await sendEvolutionAudioMessage({
            instanceName: channel.evolutionInstanceName,
            phoneNumber,
            audioUrl: ownerTriggeredFlow.reply.audio.url,
            caption: ownerTriggeredFlow.reply.audio.caption,
            delayMs: 0,
          });
          await persistEvolutionMessage({
            data: {
              workspaceId: channel.workspaceId,
              conversationId: conversation.id,
              channelId: channel.id,
              contactId: contact.id,
              agentId: channel.agentId,
              externalId: audioOutbound.externalId,
              direction: "OUTBOUND",
              type: "AUDIO",
              status: "SENT",
              content: ownerTriggeredFlow.reply.audio.caption,
              mediaUrl: ownerTriggeredFlow.reply.audio.url,
              sentAt: new Date(),
              rawPayload: audioOutbound.raw as never,
            },
          });
        }

        if (ownerTriggeredFlow.reply.video) {
          const videoOutbound = await sendEvolutionVideoMessage({
            instanceName: channel.evolutionInstanceName,
            phoneNumber,
            videoUrl: ownerTriggeredFlow.reply.video.url,
            caption: ownerTriggeredFlow.reply.video.caption,
            delayMs: 0,
          });
          await persistEvolutionMessage({
            data: {
              workspaceId: channel.workspaceId,
              conversationId: conversation.id,
              channelId: channel.id,
              contactId: contact.id,
              agentId: channel.agentId,
              externalId: videoOutbound.externalId,
              direction: "OUTBOUND",
              type: "VIDEO",
              status: "SENT",
              content: ownerTriggeredFlow.reply.video.caption,
              mediaUrl: ownerTriggeredFlow.reply.video.url,
              sentAt: new Date(),
              rawPayload: videoOutbound.raw as never,
            },
          });
        }

        for (const doc of ownerTriggeredFlow.reply.documents ?? []) {
          const docOutbound = await sendEvolutionDocumentMessage({
            instanceName: channel.evolutionInstanceName,
            phoneNumber,
            documentUrl: doc.url,
            caption: doc.caption,
            fileName: doc.fileName,
            delayMs: 0,
          });
          await persistEvolutionMessage({
            data: {
              workspaceId: channel.workspaceId,
              conversationId: conversation.id,
              channelId: channel.id,
              contactId: contact.id,
              agentId: channel.agentId,
              externalId: docOutbound.externalId,
              direction: "OUTBOUND",
              type: "DOCUMENT",
              status: "SENT",
              content: doc.caption,
              mediaUrl: doc.url,
              sentAt: new Date(),
              rawPayload: docOutbound.raw as never,
            },
          });
        }

        if (ownerTriggeredFlow.reply.text) {
          const textOutbound = await sendEvolutionTextMessageWithReconnect({
            instanceName: channel.evolutionInstanceName,
            phoneNumber,
            text: ownerTriggeredFlow.reply.text,
            delayMs: 0,
          });
          await persistEvolutionMessage({
            data: {
              workspaceId: channel.workspaceId,
              conversationId: conversation.id,
              channelId: channel.id,
              contactId: contact.id,
              agentId: channel.agentId,
              externalId: textOutbound.externalId,
              direction: "OUTBOUND",
              type: "TEXT",
              status: "SENT",
              content: ownerTriggeredFlow.reply.text,
              sentAt: new Date(),
              rawPayload: textOutbound.raw as never,
            },
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

    let latestIncomingImageAnalysis: string | null = null;
    latestIncomingImageAnalysis =
      resolvedCurrentMediaUrl && (messageType === "IMAGE" || messageType === "STICKER")
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
    } else if (resolvedCurrentMediaUrl && (messageType === "IMAGE" || messageType === "STICKER")) {
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

      const previousCommercialContext = parseCommercialConversationContext(conversation.commercialContext);

      const hardFlowResolution = shouldHandoffToHuman || quickResponseFlow
        ? null
        : await resolveAgentProductFlowReply({
            agentId: agent.id,
            workspaceId: channel.workspaceId,
            latestUserMessage: inboundTextForProcessing,
            history: recentMessagesForModel,
            includeOfficialApi: true,
            commercialContext: previousCommercialContext,
          });
      let hardFlowReply = hardFlowResolution?.steps
        ? hardFlowResolution
        : null;

      const previousCommercialStage = previousCommercialContext?.currentStage ?? null;
      const commercialStageResolution = classifyCommercialStage({
        latestUserMessage: inboundTextForProcessing,
        history: recentMessagesForModel,
        activeProductContext: hardFlowResolution?.activeProductContext ?? (existingConversation?.activeProductContext as ActiveProductContext | null | undefined) ?? null,
        previousStage: previousCommercialStage,
        commercialContext: previousCommercialContext,
      });
      const commercialConversationContext = buildCommercialConversationContext({
        stage: commercialStageResolution,
        latestUserMessage: inboundTextForProcessing,
        history: recentMessagesForModel,
        activeProductContext: hardFlowResolution?.activeProductContext ?? (existingConversation?.activeProductContext as ActiveProductContext | null | undefined) ?? null,
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

      if (hardFlowResolution?.activeProductContext) {
        const activeProductContextNote = buildActiveProductContextNote(hardFlowResolution.activeProductContext);
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
        replyText = buildHandoffMessage();
        shouldComposeWelcome = false;
      } else if (quickResponseFlow) {
        replyText = quickResponseFlow.reply.text ?? "";
        shouldComposeWelcome = Boolean(replyText);
      } else if (hardFlowReply) {
        // steps executed directly in the flow engine block below
        replyText = null;
        shouldComposeWelcome = false;
      } else if (autoUnknownProductNotifyAction) {
        replyText = "Ya en un momento te atenderá un asesor para ayudarte con esa solicitud.";
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
            const result = await executeConsultarFlujosTool({
              workspaceId: channel.workspaceId,
              includeOfficialApi: true,
              toolInput: args,
              allowedFlowIds: agentTraining?.knowledgeFlowIds?.length ? agentTraining.knowledgeFlowIds : undefined,
            });

            return result ?? { found: false, matches: [], bestMatch: null, recommendation: "No hay coincidencias suficientes." };
          },
        } satisfies Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
        replyText = await generateAgentReply({
          model: agent.model,
          systemPrompt: effectiveSystemPrompt,
          fallbackMessage: agent.fallbackMessage,
          history: recentMessagesForModel,
          latestUserMessage: aiLatestUserMessageWithImageContext,
          tools: [NOTIFICAR_ASESOR_TOOL, CONSULTAR_PRODUCTOS_TOOL, CONSULTAR_FLUJOS_TOOL],
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

      const quickResponseImageReply = shouldHandoffToHuman ? null : quickResponseFlow?.reply.image ?? null;
      const quickResponseAudioReply = shouldHandoffToHuman ? null : quickResponseFlow?.reply.audio ?? null;
      const quickResponseVideoReply = shouldHandoffToHuman ? null : quickResponseFlow?.reply.video ?? null;
      const knowledgeImageReply = shouldHandoffToHuman ? null : knowledgeBaseReply?.image ?? null;
      const imageReply = quickResponseImageReply ?? knowledgeImageReply;
      const documentReplies = shouldHandoffToHuman ? [] : (quickResponseFlow?.reply.documents ?? []);
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


      // ── Flow engine: execute hardFlowReply steps in exact order ──────────────
      const hardFlowSteps = hardFlowReply?.steps ?? [];
      if (hardFlowReply && hardFlowSteps.length > 0) {
        try {
          console.log("[EVOLUTION] auto_reply_sending", {
            conversationId: conversation.id,
            agentId: agent.id,
            phoneNumber,
            instanceName: channel.evolutionInstanceName,
            mode: "hard_flow",
            steps: hardFlowSteps.map((s) => s.kind),
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

          let welcomeApplied = false;
          for (const step of hardFlowSteps) {
            if (step.kind === "text") {
              let content = step.content;
              if (!welcomeApplied) {
                content = composeAgentWelcomeReply({
                  welcomeMessage: agent.welcomeMessage,
                  reply: content,
                  hasConversationHistory: Boolean(existingOutbound),
                });
                welcomeApplied = true;
              }
              const outbound = await sendEvolutionTextMessageWithReconnect({
                instanceName: channel.evolutionInstanceName,
                phoneNumber,
                text: content,
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
                  content,
                  sentAt: new Date(),
                  rawPayload: outbound.raw as never,
                },
              });
            } else if (step.kind === "image") {
              const imageOutbound = await sendEvolutionImageMessage({
                instanceName: channel.evolutionInstanceName,
                phoneNumber,
                imageUrl: step.url,
                caption: step.caption,
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
                  content: step.caption,
                  mediaUrl: step.url,
                  sentAt: new Date(),
                  rawPayload: imageOutbound.raw as never,
                },
              });
            } else if (step.kind === "audio") {
              const audioOutbound = await sendEvolutionAudioMessage({
                instanceName: channel.evolutionInstanceName,
                phoneNumber,
                audioUrl: step.url,
                caption: step.caption,
                delayMs: 0,
              });
              await persistEvolutionMessage({
                data: {
                  workspaceId: channel.workspaceId,
                  conversationId: conversation.id,
                  channelId: channel.id,
                  contactId: contact.id,
                  agentId: agent.id,
                  externalId: audioOutbound.externalId,
                  direction: "OUTBOUND",
                  type: "AUDIO",
                  status: "SENT",
                  content: step.caption,
                  mediaUrl: step.url,
                  sentAt: new Date(),
                  rawPayload: audioOutbound.raw as never,
                },
              });
            } else if (step.kind === "video") {
              const videoOutbound = await sendEvolutionVideoMessage({
                instanceName: channel.evolutionInstanceName,
                phoneNumber,
                videoUrl: step.url,
                caption: step.caption,
                delayMs: 0,
              });
              await persistEvolutionMessage({
                data: {
                  workspaceId: channel.workspaceId,
                  conversationId: conversation.id,
                  channelId: channel.id,
                  contactId: contact.id,
                  agentId: agent.id,
                  externalId: videoOutbound.externalId,
                  direction: "OUTBOUND",
                  type: "VIDEO",
                  status: "SENT",
                  content: step.caption,
                  mediaUrl: step.url,
                  sentAt: new Date(),
                  rawPayload: videoOutbound.raw as never,
                },
              });
            } else if (step.kind === "document") {
              const docOutbound = await sendEvolutionDocumentMessage({
                instanceName: channel.evolutionInstanceName,
                phoneNumber,
                documentUrl: step.url,
                caption: step.caption,
                fileName: step.fileName,
                delayMs: 0,
              });
              await persistEvolutionMessage({
                data: {
                  workspaceId: channel.workspaceId,
                  conversationId: conversation.id,
                  channelId: channel.id,
                  contactId: contact.id,
                  agentId: agent.id,
                  externalId: docOutbound.externalId,
                  direction: "OUTBOUND",
                  type: "DOCUMENT",
                  status: "SENT",
                  content: step.caption,
                  mediaUrl: step.url,
                  sentAt: new Date(),
                  rawPayload: docOutbound.raw as never,
                },
              });
            }
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
            mode: "hard_flow",
            stepsCount: hardFlowSteps.length,
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
              content: hardFlowSteps.find((s) => s.kind === "text")?.content ?? null,
              failedAt: new Date(),
            },
          });
        }
      } else if (replyText || quickResponseImageReply || quickResponseAudioReply || quickResponseVideoReply || knowledgeImageReply || documentReplies.length > 0) {
        try {
          console.log("[EVOLUTION] auto_reply_sending", {
            conversationId: conversation.id,
            agentId: agent.id,
            phoneNumber,
            instanceName: channel.evolutionInstanceName,
            preview: replyText?.slice(0, 80) ?? "",
            withImage: Boolean(quickResponseImageReply || knowledgeImageReply),
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

            const sendVideo = async (videoUrl: string, caption: string | null) => {
              if (!channel.evolutionInstanceName) return;
              const outbound = await sendEvolutionVideoMessage({
                instanceName: channel.evolutionInstanceName,
                phoneNumber,
                videoUrl,
                caption,
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
                  type: "VIDEO",
                  status: "SENT",
                  content: caption,
                  mediaUrl: videoUrl,
                  sentAt: new Date(),
                  rawPayload: outbound.raw as never,
                },
              });
            };

            const sendAudio = async (audioUrl: string, caption: string | null) => {
              if (!channel.evolutionInstanceName) return;
              const outbound = await sendEvolutionAudioMessage({
                instanceName: channel.evolutionInstanceName,
                phoneNumber,
                audioUrl,
                caption,
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
                  type: "AUDIO",
                  status: "SENT",
                  content: caption,
                  mediaUrl: audioUrl,
                  sentAt: new Date(),
                  rawPayload: outbound.raw as never,
                },
              });
            };

            for (const doc of documentReplies) {
              const docOutbound = await sendEvolutionDocumentMessage({
                instanceName: channel.evolutionInstanceName,
                phoneNumber,
                documentUrl: doc.url,
                caption: doc.caption,
                fileName: doc.fileName,
                delayMs: 0,
              });
              await persistEvolutionMessage({
                data: {
                  workspaceId: channel.workspaceId,
                  conversationId: conversation.id,
                  channelId: channel.id,
                  contactId: contact.id,
                  agentId: agent.id,
                  externalId: docOutbound.externalId,
                  direction: "OUTBOUND",
                  type: "DOCUMENT",
                  status: "SENT",
                  content: doc.caption,
                  mediaUrl: doc.url,
                  sentAt: new Date(),
                  rawPayload: docOutbound.raw as never,
                },
              });
            }

            const quickResponseVideo = quickResponseVideoReply;
            if (quickResponseVideo?.url) {
              await sendVideo(quickResponseVideo.url, quickResponseVideo.caption);
            }

            if (quickResponseAudioReply?.url) {
              await sendAudio(quickResponseAudioReply.url, quickResponseAudioReply.caption);
            }

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
            sentImage: Boolean(knowledgeImageReply || quickResponseImageReply),
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


