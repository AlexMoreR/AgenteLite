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
import { sendEvolutionTextMessage } from "@/lib/evolution";
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

  const channel = instanceName
    ? await prisma.whatsAppChannel.findUnique({
        where: { evolutionInstanceName: instanceName },
      select: {
        id: true,
        workspaceId: true,
        agentId: true,
        name: true,
        evolutionInstanceName: true,
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
    return NextResponse.json({
      ok: true,
      message: "Webhook received but no matching channel was found",
      instanceName,
      event: eventName,
    });
  }

  if (eventName === "QRCODE_UPDATED" || eventName === "CONNECTION_UPDATE") {
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
  const fromMe = extractEvolutionFromMe(payload);

  if (fromMe || !phoneNumber) {
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

  await prisma.message.create({
    data: {
      workspaceId: channel.workspaceId,
      conversationId: conversation.id,
      channelId: channel.id,
      contactId: contact.id,
      agentId: channel.agentId ?? null,
      externalId: messageExternalId || (remoteJid ? `${remoteJid}-${Date.now()}` : null),
      direction: "INBOUND",
      type: "TEXT",
      status: "RECEIVED",
      content: messageText,
      rawPayload: payload as never,
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: new Date(),
      status: "OPEN",
    },
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
      }

      if (replyText) {
        try {
          const outbound = await sendEvolutionTextMessage({
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
        } catch {
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
      }
    }
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
