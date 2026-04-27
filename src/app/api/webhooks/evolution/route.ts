import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { generateAgentReply } from "@/lib/agent-ai";
import { resolveAgentProductFlowReply } from "@/lib/agent-product-flow";
import { composeAgentWelcomeReply } from "@/lib/agent-reply-composer";
import { getConversationAutomationPaused } from "@/lib/conversation-automation";
import { prisma } from "@/lib/prisma";
import {
  extractEvolutionConnectionState,
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
  isInboundMessageEvent,
  normalizePhoneFromJid,
} from "@/lib/evolution-webhook";
import {
  ensureEvolutionInstanceReady,
  sendEvolutionImageMessage,
  sendEvolutionPresence,
  sendEvolutionTextMessageWithReconnect,
} from "@/lib/evolution";
import { resolveAgentKnowledgeBaseReply } from "@/lib/agent-knowledge-media";
import { enforceWorkspacePlanAccess } from "@/lib/workspace-plan-access";
import { getEvolutionSettings } from "@/lib/system-settings";

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
  const isConnectionEvent = eventName === "QRCODE_UPDATED" || eventName === "CONNECTION_UPDATE";

  const channel = instanceName
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

  if (!isInboundMessageEvent(eventName)) {
    return NextResponse.json({
      ok: true,
      message: "Event logged",
      instanceName,
      event: eventName,
    });
  }

  const remoteJid = extractEvolutionRemoteJid(payload);
  const phoneNumber = normalizePhoneFromJid(remoteJid);
  const messageText = extractEvolutionMessageText(payload);
  const messageType = extractEvolutionMessageType(payload);
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
  const fromMe = extractEvolutionFromMe(payload);

  console.log("[EVOLUTION] inbound_candidate", {
    eventName,
    instanceName,
    channelId: channel.id,
    fromMe,
    phoneNumber,
    hasMessageText: Boolean(messageText?.trim()),
    messageType,
    hasMediaUrl: Boolean(mediaUrl),
    messageExternalId: inboundExternalId,
  });

  if (!phoneNumber) {
    console.log("[EVOLUTION] inbound_skipped", {
      reason: "missing_phone",
      eventName,
      instanceName,
    });
    return NextResponse.json({
      ok: true,
      message: "Inbound event logged without identifiable phone number",
      instanceName,
      event: eventName,
    });
  }

  const contact = await prisma.contact.upsert({
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
    select: { id: true },
  });

  const existingConversation = await prisma.conversation.findFirst({
    where: {
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      contactId: contact.id,
    },
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      id: true,
      status: true,
    },
  });

  const conversation = existingConversation
    ? { id: existingConversation.id }
    : await prisma.conversation.create({
        data: {
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          agentId: channel.agentId ?? null,
          contactId: contact.id,
          status: "OPEN",
          lastMessageAt: new Date(),
        },
        select: { id: true },
      });

  if (existingConversation && !["OPEN", "PENDING"].includes(existingConversation.status)) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: "OPEN",
        lastMessageAt: new Date(),
      },
    });
  }
  const conversationAutomationPaused = await getConversationAutomationPaused({
    conversationId: conversation.id,
    workspaceId: channel.workspaceId,
  });

  try {
    await prisma.message.create({
      data: {
        workspaceId: channel.workspaceId,
        conversationId: conversation.id,
        channelId: channel.id,
        contactId: contact.id,
        agentId: channel.agentId ?? null,
        externalId: inboundExternalId,
        direction: fromMe ? "OUTBOUND" : "INBOUND",
        type: messageType,
        status: fromMe ? "SENT" : "RECEIVED",
        content: messageText,
        mediaUrl,
        rawPayload: {
          source: fromMe ? "instance" : "webhook",
          evolution: payload,
        } as never,
        ...(fromMe ? { sentAt: new Date() } : {}),
      },
    });
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

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: new Date(),
      status: "OPEN",
    },
  });

  const inboundMessageCountRows = await prisma.$queryRaw<Array<{ total: bigint | number }>>`
    SELECT COUNT(*)::bigint AS "total"
    FROM "Message"
    WHERE "conversationId" = ${conversation.id}
      AND "direction" = 'INBOUND'::"MessageDirection"
  `;
  const inboundMessageCount = Number(inboundMessageCountRows[0]?.total ?? 0);

  console.log("[EVOLUTION] inbound_saved", {
    conversationId: conversation.id,
    contactId: contact.id,
    agentId: channel.agentId,
    phoneNumber,
    direction: fromMe ? "OUTBOUND" : "INBOUND",
  });

  if (!fromMe && channel.agentId) {
    const workspaceAccess = await enforceWorkspacePlanAccess(channel.workspaceId);

    if (workspaceAccess.planState.blockClientArea) {
      console.log("[EVOLUTION] auto_reply_skipped", {
        reason: "workspace_plan_expired",
        conversationId: conversation.id,
        agentId: channel.agentId,
        pausedAgents: workspaceAccess.pausedAgents,
      });

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
        status: true,
        isActive: true,
        model: true,
        systemPrompt: true,
        welcomeMessage: true,
        fallbackMessage: true,
        trainingConfig: true,
      },
    });

    const responseDelaySeconds =
      agent?.trainingConfig &&
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
      exists: Boolean(agent),
      status: agent?.status,
      isActive: agent?.isActive,
      hasWelcomeMessage: Boolean(agent?.welcomeMessage),
      hasFallbackMessage: Boolean(agent?.fallbackMessage),
      hasSystemPrompt: Boolean(agent?.systemPrompt),
      model: agent?.model ?? null,
      responseDelaySeconds,
    });

      if (
        channel.isActive &&
        agent?.isActive &&
      agent.status === "ACTIVE" &&
      !conversationAutomationPaused &&
      channel.evolutionInstanceName &&
      messageText
      ) {
      const existingOutbound = await prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          direction: "OUTBOUND",
        },
        select: { id: true },
      });

        let replyText: string | null = null;

      const recentMessages = await prisma.message.findMany({
        where: {
          conversationId: conversation.id,
        },
        orderBy: {
          createdAt: "asc",
        },
        take: 8,
        select: {
          direction: true,
          content: true,
        },
      });

      const hardFlowReply = await resolveAgentProductFlowReply({
        agentId: agent.id,
        workspaceId: channel.workspaceId,
        latestUserMessage: messageText,
        history: recentMessages,
        includeOfficialApi: false,
      });

      const knowledgeBaseReply = hardFlowReply
        ? null
        : await resolveAgentKnowledgeBaseReply({
            agentId: agent.id,
            latestUserMessage: messageText,
            history: recentMessages,
          });

      let shouldComposeWelcome = true;

      if (hardFlowReply) {
        replyText = hardFlowReply.reply ?? "";
      } else if (knowledgeBaseReply) {
        replyText = knowledgeBaseReply.text ?? null;
        shouldComposeWelcome = Boolean(replyText);
      } else {
        replyText = await generateAgentReply({
          model: agent.model,
          systemPrompt: agent.systemPrompt,
          fallbackMessage: agent.fallbackMessage,
          history: recentMessages,
          latestUserMessage: messageText,
        });
      }

      if (shouldComposeWelcome) {
        replyText = composeAgentWelcomeReply({
          welcomeMessage: agent.welcomeMessage,
          reply: replyText,
          // Usamos el historial saliente real como señal de primer contacto.
          // Eso evita volver a anteponer el saludo si la conversación ya tuvo una respuesta del bot.
          hasConversationHistory: inboundMessageCount > 1,
        });
      }

      console.log("[EVOLUTION] auto_reply_mode", {
        conversationId: conversation.id,
        agentId: agent.id,
        mode: !existingOutbound ? "first_turn_ai" : "ai",
        hardFlow: hardFlowReply?.flowTitle ?? null,
        usedFallback:
          replyText?.trim() === (agent.fallbackMessage?.trim() || "").trim(),
        historyCount: recentMessages.length,
      });

      const hardFlowImageReply = hardFlowReply?.image ?? null;
      const knowledgeImageReply = knowledgeBaseReply?.image ?? null;

      if (replyText || knowledgeImageReply || hardFlowImageReply) {
        try {
          console.log("[EVOLUTION] auto_reply_sending", {
            conversationId: conversation.id,
            agentId: agent.id,
            phoneNumber,
            instanceName: channel.evolutionInstanceName,
            preview: replyText?.slice(0, 80) ?? "",
            withImage: Boolean(knowledgeImageReply || hardFlowImageReply),
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
              await prisma.message.create({
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

            const imageFirst = hardFlowReply?.imageFirst ?? false;
            if (imageFirst) {
              // imagen primero (orden del flujo builder)
            } else {
              await sendText();
            }

            if (knowledgeImageReply || hardFlowImageReply) {
              const imageUrl = hardFlowImageReply?.url ?? knowledgeImageReply?.url ?? "";
              const imageCaption = hardFlowImageReply
                ? hardFlowImageReply.caption
                : knowledgeImageReply?.caption ?? null;
              const imageOutbound = await sendEvolutionImageMessage({
                instanceName: channel.evolutionInstanceName,
                phoneNumber,
                imageUrl,
                caption: imageCaption,
                delayMs: 0,
              });

              await prisma.message.create({
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
                  content: imageCaption,
                  mediaUrl: imageUrl,
                  sentAt: new Date(),
                  rawPayload: imageOutbound.raw as never,
                },
              });
            }

            if (imageFirst) {
              await sendText();
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
            sentImage: Boolean(knowledgeImageReply || hardFlowImageReply),
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

          await prisma.message.create({
            data: {
              workspaceId: channel.workspaceId,
              conversationId: conversation.id,
              channelId: channel.id,
              contactId: contact.id,
              agentId: agent.id,
              direction: "OUTBOUND",
              type: knowledgeImageReply || hardFlowImageReply ? "IMAGE" : "TEXT",
              status: "FAILED",
              content:
                replyText ||
                knowledgeImageReply?.caption ||
                hardFlowImageReply?.caption ||
                null,
              mediaUrl: knowledgeImageReply?.url ?? hardFlowImageReply?.url ?? null,
              failedAt: new Date(),
            },
          });
        }
      } else {
        console.log("[EVOLUTION] auto_reply_skipped", {
          reason: "empty_reply",
          conversationId: conversation.id,
          agentId: agent.id,
        });
      }
    } else {
      console.log("[EVOLUTION] auto_reply_skipped", {
        reason: !agent
          ? "agent_not_found"
          : !channel.isActive
            ? "channel_inactive"
          : conversationAutomationPaused
            ? "conversation_paused_by_human"
          : !agent.isActive
            ? "agent_inactive"
            : agent.status !== "ACTIVE"
              ? `status_${agent.status}`
              : !channel.evolutionInstanceName
                ? "missing_instance"
                : !messageText
                  ? "missing_message_text"
                  : "unknown",
        conversationId: conversation.id,
        agentId: channel.agentId,
      });
    }
  } else {
    console.log("[EVOLUTION] auto_reply_skipped", {
      reason: "channel_without_agent",
      conversationId: conversation.id,
    });
  }

  return NextResponse.json({
    ok: true,
    message: "Inbound message processed",
    instanceName,
    event: eventName,
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Evolution webhook endpoint is ready",
  });
}
