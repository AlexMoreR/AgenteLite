import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  extractEvolutionEventName,
  extractEvolutionInstanceName,
  extractEvolutionMessageText,
  extractEvolutionRemoteJid,
  isInboundMessageEvent,
  normalizePhoneFromJid,
} from "@/lib/evolution-webhook";
import { getEvolutionSettings } from "@/lib/system-settings";

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

  if (!phoneNumber) {
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
      externalId: remoteJid ? `${remoteJid}-${Date.now()}` : null,
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
