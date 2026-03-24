import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { generateAgentReply } from "@/lib/agent-ai";
import { prisma } from "@/lib/prisma";
import {
  extractEvolutionConnectionState,
  extractEvolutionEventName,
  extractEvolutionFromMe,
  extractEvolutionInstanceName,
  extractEvolutionMessageId,
  extractEvolutionMessageText,
  extractEvolutionPairingCode,
  extractEvolutionPhoneNumber,
  extractEvolutionQrCode,
  extractEvolutionRemoteJid,
  isInboundMessageEvent,
  normalizePhoneFromJid,
} from "@/lib/evolution-webhook";
import {
  ensureEvolutionInstanceReady,
  sendEvolutionPresence,
  sendEvolutionTextMessageWithReconnect,
} from "@/lib/evolution";
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
    messageExternalId: inboundExternalId,
  });

  if (fromMe || !phoneNumber) {
    console.log("[EVOLUTION] inbound_skipped", {
      reason: fromMe ? "from_me" : "missing_phone",
      eventName,
      instanceName,
    });
    return NextResponse.json({
      ok: true,
      message: fromMe
        ? "Outbound/self message ignored"
        : "Inbound event logged without identifiable phone number",
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
      status: {
        in: ["OPEN", "PENDING"],
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
    select: { id: true },
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

  try {
    await prisma.message.create({
      data: {
        workspaceId: channel.workspaceId,
        conversationId: conversation.id,
        channelId: channel.id,
        contactId: contact.id,
        agentId: channel.agentId ?? null,
        externalId: inboundExternalId,
        direction: "INBOUND",
        type: "TEXT",
        status: "RECEIVED",
        content: messageText,
        rawPayload: payload as never,
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
        message: "Duplicate inbound event ignored",
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

  console.log("[EVOLUTION] inbound_saved", {
    conversationId: conversation.id,
    contactId: contact.id,
    agentId: channel.agentId,
    phoneNumber,
  });

  if (channel.agentId) {
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
      },
    });

    console.log("[EVOLUTION] agent_loaded", {
      agentId: channel.agentId,
      exists: Boolean(agent),
      status: agent?.status,
      isActive: agent?.isActive,
      hasWelcomeMessage: Boolean(agent?.welcomeMessage),
      hasFallbackMessage: Boolean(agent?.fallbackMessage),
      hasSystemPrompt: Boolean(agent?.systemPrompt),
      model: agent?.model ?? null,
    });

    if (agent?.isActive && agent.status === "ACTIVE" && channel.evolutionInstanceName && messageText) {
      const existingOutbound = await prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          direction: "OUTBOUND",
        },
        select: { id: true },
      });

      let replyText: string | null = null;

      if (!existingOutbound) {
        replyText = agent.welcomeMessage?.trim() || agent.fallbackMessage?.trim() || null;
        console.log("[EVOLUTION] auto_reply_mode", {
          conversationId: conversation.id,
          agentId: agent.id,
          mode: "welcome",
          usedFallback: !agent.welcomeMessage?.trim(),
        });
      } else {
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

        replyText = await generateAgentReply({
          model: agent.model,
          systemPrompt: agent.systemPrompt,
          fallbackMessage: agent.fallbackMessage,
          history: recentMessages,
          latestUserMessage: messageText,
        });

        console.log("[EVOLUTION] auto_reply_mode", {
          conversationId: conversation.id,
          agentId: agent.id,
          mode: "ai",
          usedFallback:
            replyText?.trim() === (agent.fallbackMessage?.trim() || "").trim(),
          historyCount: recentMessages.length,
        });
      }

      if (replyText) {
        try {
          console.log("[EVOLUTION] auto_reply_sending", {
            conversationId: conversation.id,
            agentId: agent.id,
            phoneNumber,
            instanceName: channel.evolutionInstanceName,
            preview: replyText.slice(0, 80),
          });

          try {
            await sendEvolutionPresence({
              instanceName: channel.evolutionInstanceName,
              phoneNumber,
              presence: "composing",
              delay: 1200,
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

          const outbound = await sendEvolutionTextMessageWithReconnect({
            instanceName: channel.evolutionInstanceName,
            phoneNumber,
            text: replyText,
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
            externalId: outbound.externalId,
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
              type: "TEXT",
              status: "FAILED",
              content: replyText,
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
