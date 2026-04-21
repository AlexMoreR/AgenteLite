import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { resolveOfficialApiAutomationReply } from "@/lib/official-api-chatbot";
import {
  sendOfficialApiImageMessage,
  sendOfficialApiTextMessage,
  sendOfficialApiTypingIndicator,
} from "@/lib/official-api-messaging";
import { buildKnowledgeImageReplyText, resolveAgentKnowledgeImageReply } from "@/lib/agent-knowledge-media";
import { prisma } from "@/lib/prisma";
import { ensureOfficialApiConfigTable } from "@/lib/official-api-config";

type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: {
          phone_number_id?: string;
          display_phone_number?: string;
        };
        contacts?: Array<{
          wa_id?: string;
          profile?: {
            name?: string;
          };
        }>;
        statuses?: Array<{
          id?: string;
          status?: string;
          timestamp?: string;
        }>;
        messages?: Array<{
          id?: string;
          type?: string;
          from?: string;
          timestamp?: string;
          text?: {
            body?: string;
          };
        }>;
      };
    }>;
  }>;
};

type OfficialApiWebhookConfigRow = {
  id: string;
  workspaceId: string;
  appSecret: string | null;
  accessToken: string | null;
  phoneNumberId: string | null;
};

type ExtractedInboundMessage = {
  id: string;
  waId: string;
  contactName: string | null;
  content: string | null;
  type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "TEMPLATE" | "INTERACTIVE" | "SYSTEM";
  createdAt: Date;
  rawPayload: MetaWebhookPayload;
};

async function findConfigByVerifyToken(verifyToken: string) {
  const query = async () =>
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "OfficialApiClientConfig"
      WHERE "webhookVerifyToken" = ${verifyToken}
      LIMIT 1
    `;

  try {
    const rows = await query();
    return rows[0] ?? null;
  } catch {
    await ensureOfficialApiConfigTable();
    const rows = await query();
    return rows[0] ?? null;
  }
}

async function markWebhookVerified(configId: string) {
  const execute = async () =>
    prisma.$executeRaw`
      UPDATE "OfficialApiClientConfig"
      SET
        "status" = 'CONNECTED'::"OfficialApiConnectionStatus",
        "lastValidatedAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${configId}
    `;

  try {
    await execute();
  } catch {
    await ensureOfficialApiConfigTable();
    await execute();
  }
}

async function findConfigByWebhookTarget(input: {
  phoneNumberId: string | null;
  wabaId: string | null;
}) {
  if (!input.phoneNumberId && !input.wabaId) {
    return null;
  }

  const query = async () => {
    if (input.phoneNumberId && input.wabaId) {
      return prisma.$queryRaw<OfficialApiWebhookConfigRow[]>`
        SELECT "id", "workspaceId", "appSecret", "accessToken", "phoneNumberId"
        FROM "OfficialApiClientConfig"
        WHERE "phoneNumberId" = ${input.phoneNumberId}
           OR "wabaId" = ${input.wabaId}
        LIMIT 1
      `;
    }

    if (input.phoneNumberId) {
      return prisma.$queryRaw<OfficialApiWebhookConfigRow[]>`
        SELECT "id", "workspaceId", "appSecret", "accessToken", "phoneNumberId"
        FROM "OfficialApiClientConfig"
        WHERE "phoneNumberId" = ${input.phoneNumberId}
        LIMIT 1
      `;
    }

    return prisma.$queryRaw<OfficialApiWebhookConfigRow[]>`
      SELECT "id", "workspaceId", "appSecret", "accessToken", "phoneNumberId"
      FROM "OfficialApiClientConfig"
      WHERE "wabaId" = ${input.wabaId}
      LIMIT 1
    `;
  };

  try {
    const rows = await query();
    return rows[0] ?? null;
  } catch {
    await ensureOfficialApiConfigTable();
    const rows = await query();
    return rows[0] ?? null;
  }
}

async function findOfficialApiLinkedAgent(workspaceId: string) {
  return prisma.whatsAppChannel.findFirst({
    where: {
      workspaceId,
      provider: "OFFICIAL_API",
      isActive: true,
      agentId: {
        not: null,
      },
      agent: {
        is: {
          isActive: true,
          status: "ACTIVE",
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      agent: {
        select: {
          id: true,
        },
      },
    },
  });
}

async function storeWebhookEvent(input: {
  configId: string;
  eventType: string;
  deliveryId: string | null;
  payload: MetaWebhookPayload;
  status: "PROCESSED" | "FAILED";
  errorMessage?: string | null;
  processedAt?: Date | null;
}) {
  await prisma.$executeRaw`
    INSERT INTO "OfficialApiWebhookEvent" (
      "id",
      "configId",
      "eventType",
      "deliveryId",
      "payload",
      "status",
      "processedAt",
      "errorMessage",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${input.configId},
      ${input.eventType},
      ${input.deliveryId},
      ${JSON.stringify(input.payload)},
      ${input.status}::"OfficialApiWebhookStatus",
      ${input.processedAt ?? null},
      ${input.errorMessage ?? null},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `;
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function buildExpectedSignature(rawBody: string, appSecret: string) {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

function extractPhoneNumberId(payload: MetaWebhookPayload) {
  return (
    payload.entry?.flatMap((entry) => entry.changes ?? []).find(
      (change) => change.value?.metadata?.phone_number_id,
    )?.value?.metadata?.phone_number_id ?? null
  );
}

function extractDeliveryId(payload: MetaWebhookPayload) {
  const change = payload.entry?.flatMap((entry) => entry.changes ?? [])[0];

  return (
    change?.value?.statuses?.[0]?.id ??
    change?.value?.messages?.[0]?.id ??
    null
  );
}

function extractEventType(payload: MetaWebhookPayload) {
  const change = payload.entry?.flatMap((entry) => entry.changes ?? [])[0];

  if (change?.field) {
    return change.field;
  }

  return payload.object || "unknown";
}

function mapMessageType(value: string | undefined): ExtractedInboundMessage["type"] {
  switch (value) {
    case "image":
      return "IMAGE";
    case "audio":
      return "AUDIO";
    case "video":
      return "VIDEO";
    case "document":
      return "DOCUMENT";
    case "template":
      return "TEMPLATE";
    case "interactive":
      return "INTERACTIVE";
    case "system":
      return "SYSTEM";
    default:
      return "TEXT";
  }
}

function parseMetaTimestamp(value: string | undefined) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return new Date();
  }

  return new Date(seconds * 1000);
}

function extractInboundMessages(payload: MetaWebhookPayload): ExtractedInboundMessage[] {
  const changes = payload.entry?.flatMap((entry) => entry.changes ?? []) ?? [];

  return changes.flatMap((change) => {
    const contacts = change.value?.contacts ?? [];
    const contactNames = new Map(
      contacts.map((contact) => [contact.wa_id ?? "", contact.profile?.name?.trim() || null]),
    );

    return (change.value?.messages ?? [])
      .map((message) => {
        const waId = message.from?.trim() || "";
        const messageId = message.id?.trim() || "";

        if (!waId || !messageId) {
          return null;
        }

        return {
          id: messageId,
          waId,
          contactName: contactNames.get(waId) ?? null,
          content: message.text?.body?.trim() || null,
          type: mapMessageType(message.type),
          createdAt: parseMetaTimestamp(message.timestamp),
          rawPayload: payload,
        } satisfies ExtractedInboundMessage;
      })
      .filter((message): message is ExtractedInboundMessage => Boolean(message));
  });
}

function mapMessageStatus(status: string | undefined) {
  switch (status?.trim().toLowerCase()) {
    case "sent":
      return "SENT" as const;
    case "delivered":
      return "DELIVERED" as const;
    case "read":
      return "READ" as const;
    case "failed":
      return "FAILED" as const;
    default:
      return "RECEIVED" as const;
  }
}

async function syncInboundMessages(configId: string, payload: MetaWebhookPayload) {
  const inboundMessages = extractInboundMessages(payload);
  const insertedMessages: Array<{
    conversationId: string;
    contactId: string;
    waId: string;
    content: string | null;
    inboundExternalMessageId: string;
  }> = [];

  for (const message of inboundMessages) {
    const existingMessageRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "OfficialApiMessage"
      WHERE "configId" = ${configId}
        AND "externalMessageId" = ${message.id}
      LIMIT 1
    `;
    if (existingMessageRows[0]) {
      continue;
    }

    const contactId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "OfficialApiContact" (
        "id",
        "configId",
        "externalUserId",
        "waId",
        "name",
        "phoneNumber",
        "metadata",
        "lastMessageAt",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${contactId},
        ${configId},
        ${message.waId},
        ${message.waId},
        ${message.contactName},
        ${message.waId},
        ${JSON.stringify(payload)},
        ${message.createdAt},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("configId", "waId")
      DO UPDATE SET
        "name" = COALESCE(EXCLUDED."name", "OfficialApiContact"."name"),
        "phoneNumber" = EXCLUDED."phoneNumber",
        "externalUserId" = EXCLUDED."externalUserId",
        "metadata" = EXCLUDED."metadata",
        "lastMessageAt" = EXCLUDED."lastMessageAt",
        "updatedAt" = CURRENT_TIMESTAMP
    `;

    const contactRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "OfficialApiContact"
      WHERE "configId" = ${configId}
        AND "waId" = ${message.waId}
      LIMIT 1
    `;
    const contact = contactRows[0];
    if (!contact) {
      continue;
    }

    const conversationId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "OfficialApiConversation" (
        "id",
        "configId",
        "contactId",
        "externalThreadId",
        "status",
        "lastMessageAt",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${conversationId},
        ${configId},
        ${contact.id},
        ${message.waId},
        'OPEN'::"OfficialApiConversationStatus",
        ${message.createdAt},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("configId", "externalThreadId")
      DO UPDATE SET
        "contactId" = EXCLUDED."contactId",
        "status" = 'OPEN'::"OfficialApiConversationStatus",
        "lastMessageAt" = EXCLUDED."lastMessageAt",
        "updatedAt" = CURRENT_TIMESTAMP
    `;

    const conversationRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "OfficialApiConversation"
      WHERE "configId" = ${configId}
        AND "externalThreadId" = ${message.waId}
      LIMIT 1
    `;
    const conversation = conversationRows[0];
    if (!conversation) {
      continue;
    }

    await prisma.$executeRaw`
      INSERT INTO "OfficialApiMessage" (
        "id",
        "configId",
        "conversationId",
        "contactId",
        "externalMessageId",
        "direction",
        "type",
        "status",
        "content",
        "rawPayload",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${randomUUID()},
        ${configId},
        ${conversation.id},
        ${contact.id},
        ${message.id},
        'INBOUND'::"OfficialApiMessageDirection",
        ${message.type}::"OfficialApiMessageType",
        'RECEIVED'::"OfficialApiMessageStatus",
        ${message.content},
        ${JSON.stringify(message.rawPayload)},
        ${message.createdAt},
        CURRENT_TIMESTAMP
      )
    `;

    insertedMessages.push({
      conversationId: conversation.id,
      contactId: contact.id,
      waId: message.waId,
      content: message.content,
      inboundExternalMessageId: message.id,
    });
  }

  return insertedMessages;
}

async function syncMessageStatuses(configId: string, payload: MetaWebhookPayload) {
  const statuses =
    payload.entry?.flatMap((entry) => entry.changes ?? []).flatMap((change) => change.value?.statuses ?? []) ?? [];

  for (const statusItem of statuses) {
    const externalMessageId = statusItem.id?.trim();
    if (!externalMessageId) {
      continue;
    }

    const nextStatus = mapMessageStatus(statusItem.status);
    const statusDate = parseMetaTimestamp(statusItem.timestamp);

    await prisma.$executeRaw`
      UPDATE "OfficialApiMessage"
      SET
        "status" = ${nextStatus}::"OfficialApiMessageStatus",
        "sentAt" = CASE WHEN ${nextStatus} = 'SENT' THEN ${statusDate} ELSE "sentAt" END,
        "deliveredAt" = CASE WHEN ${nextStatus} = 'DELIVERED' THEN ${statusDate} ELSE "deliveredAt" END,
        "readAt" = CASE WHEN ${nextStatus} = 'READ' THEN ${statusDate} ELSE "readAt" END,
        "failedAt" = CASE WHEN ${nextStatus} = 'FAILED' THEN ${statusDate} ELSE "failedAt" END,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "configId" = ${configId}
        AND "externalMessageId" = ${externalMessageId}
    `;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const challenge = searchParams.get("hub.challenge");
  const verifyToken = searchParams.get("hub.verify_token")?.trim() || "";

  if (mode !== "subscribe" || !challenge || !verifyToken) {
    return NextResponse.json({ ok: false, error: "Invalid webhook verification request." }, { status: 400 });
  }

  const matchingConfig = await findConfigByVerifyToken(verifyToken);

  if (!matchingConfig) {
    return NextResponse.json({ ok: false, error: "Verify token invalido." }, { status: 403 });
  }

  await markWebhookVerified(matchingConfig.id);

  return new NextResponse(challenge, {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
    },
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  let payload: MetaWebhookPayload | null = null;

  try {
    payload = (JSON.parse(rawBody) as MetaWebhookPayload | null) ?? null;
  } catch {
    payload = null;
  }

  if (!payload) {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload." }, { status: 400 });
  }

  const phoneNumberId = extractPhoneNumberId(payload);
  const wabaId = payload.entry?.[0]?.id ?? null;
  if (!phoneNumberId && !wabaId) {
    return NextResponse.json({ ok: true, matched: false }, { status: 200 });
  }

  const config = await findConfigByWebhookTarget({ phoneNumberId, wabaId });

  if (!config) {
    return NextResponse.json({ ok: true, matched: false }, { status: 200 });
  }

  const signature = request.headers.get("x-hub-signature-256")?.trim() || "";
  if (config.appSecret?.trim()) {
    if (!signature) {
      return NextResponse.json({ ok: false, error: "Missing webhook signature." }, { status: 401 });
    }

    const expectedSignature = buildExpectedSignature(rawBody, config.appSecret.trim());
    if (!safeCompare(signature, expectedSignature)) {
      return NextResponse.json({ ok: false, error: "Invalid webhook signature." }, { status: 401 });
    }
  }

  const deliveryId = extractDeliveryId(payload);
  const eventType = extractEventType(payload);

  try {
    const insertedMessages = await syncInboundMessages(config.id, payload);
    await syncMessageStatuses(config.id, payload);
    const linkedAgentChannel = await findOfficialApiLinkedAgent(config.workspaceId);

    for (const message of insertedMessages) {
      const agentKnowledgeImageReply = linkedAgentChannel?.agent?.id
        ? await resolveAgentKnowledgeImageReply({
            agentId: linkedAgentChannel.agent.id,
            latestUserMessage: message.content,
          })
        : null;

      const chatbotReply = await resolveOfficialApiAutomationReply({
        configId: config.id,
        conversationId: message.conversationId,
        inboundText: message.content,
      });
      const reply =
        chatbotReply || agentKnowledgeImageReply
          ? {
              text: agentKnowledgeImageReply ? buildKnowledgeImageReplyText(agentKnowledgeImageReply.productName) : chatbotReply?.text?.trim() || null,
              image:
                chatbotReply?.image ||
                (agentKnowledgeImageReply
                  ? {
                      url: agentKnowledgeImageReply.url,
                      caption: chatbotReply?.text?.trim()
                        ? null
                        : `Te comparto la foto de ${agentKnowledgeImageReply.productName}.`,
                    }
                  : null),
            }
          : null;

      if (!reply || (!reply.image && !reply.text?.trim())) {
        continue;
      }

      try {
        const typingResult = await sendOfficialApiTypingIndicator({
          config,
          to: message.waId,
          inboundMessageId: message.inboundExternalMessageId,
          delayMs: 900,
        });
        if (!typingResult.ok) {
          console.warn("[official-api] typing indicator failed, continuing flow", {
            configId: config.id,
            conversationId: message.conversationId,
            contactId: message.contactId,
            error: typingResult.error,
          });
        }
      } catch {
        console.warn("[official-api] typing indicator threw error, continuing flow", {
          configId: config.id,
          conversationId: message.conversationId,
          contactId: message.contactId,
        });
      }

      const primaryText = reply.text?.trim() || "";
      if (primaryText) {
        await sendOfficialApiTextMessage({
          config,
          conversationId: message.conversationId,
          contactId: message.contactId,
          to: message.waId,
          message: primaryText,
          source: "automation",
        });
      }

      let imageSent = false;
      if (reply.image?.url) {
        try {
          const imageResult = await sendOfficialApiImageMessage({
            config,
            conversationId: message.conversationId,
            contactId: message.contactId,
            to: message.waId,
            imageUrl: reply.image.url,
            caption: reply.image.caption,
            source: "automation",
          });
          imageSent = imageResult.ok;
          if (!imageResult.ok) {
            console.warn("[official-api] image node failed, continuing flow", {
              configId: config.id,
              conversationId: message.conversationId,
              contactId: message.contactId,
              error: imageResult.error,
            });
          }
        } catch {
          imageSent = false;
          console.warn("[official-api] image node threw error, continuing flow", {
            configId: config.id,
            conversationId: message.conversationId,
            contactId: message.contactId,
          });
        }
      }

      if (!primaryText && !imageSent) {
        const fallbackCaptionText = reply.image?.caption?.trim() || "";
        if (fallbackCaptionText) {
          await sendOfficialApiTextMessage({
            config,
            conversationId: message.conversationId,
            contactId: message.contactId,
            to: message.waId,
            message: fallbackCaptionText,
            source: "automation",
          });
        }
      }
    }

    await storeWebhookEvent({
      configId: config.id,
      eventType,
      deliveryId,
      payload,
      status: "PROCESSED",
      processedAt: new Date(),
    });

    return NextResponse.json({ ok: true, matched: true }, { status: 200 });
  } catch (error) {
    await storeWebhookEvent({
      configId: config.id,
      eventType,
      deliveryId,
      payload,
      status: "FAILED",
      errorMessage: error instanceof Error ? error.message : "Unknown webhook processing error.",
    });

    return NextResponse.json({ ok: true, matched: true, stored: false }, { status: 200 });
  }
}
