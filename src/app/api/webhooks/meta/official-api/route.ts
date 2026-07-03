import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { resolveAgentProductFlowReply, type ActiveProductContext } from "@/lib/agent-product-flow";
import { composeAgentWelcomeReply } from "@/lib/agent-reply-composer";
import { resolveOfficialApiAutomationReply } from "@/lib/official-api-chatbot";
import {
  sendOfficialApiAudioMessage,
  sendOfficialApiDirectTextMessage,
  sendOfficialApiImageMessage,
  sendOfficialApiTextMessage,
  sendOfficialApiTypingIndicator,
  sendOfficialApiVideoMessage,
} from "@/lib/official-api-messaging";
import { setConversationAutomationPaused } from "@/lib/conversation-automation";
import { resolveAgentKnowledgeBaseReply } from "@/lib/agent-knowledge-media";
import { recordContactMatch } from "@/lib/contact-matches";
import { prisma } from "@/lib/prisma";
import { ensureOfficialApiConfigTable } from "@/lib/official-api-config";
import { normalizeMetaAppSecret } from "@/lib/official-api-graph";
import { getOfficialApiProviderSettings } from "@/lib/system-settings";
import { buildHandoffMessage, parseAgentTrainingConfig } from "@/lib/agent-training";
import {
  resolveNotifyHumanAction,
  resolveUnknownProductNotifyAction,
} from "@/features/agent-actions";

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

async function isProviderVerifyToken(verifyToken: string) {
  const settings = await getOfficialApiProviderSettings();
  const expectedToken = settings.verifyToken.trim();

  if (!expectedToken) {
    return false;
  }

  return safeCompare(verifyToken, expectedToken);
}

async function getProviderAppSecret() {
  const settings = await getOfficialApiProviderSettings();
  // Solo devolvemos el secret si tiene formato valido (32 hex). Un placeholder invalido
  // activaria la validacion HMAC y rechazaria todos los entrantes con 401.
  return normalizeMetaAppSecret(settings.appSecret);
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
            name: true,
            welcomeMessage: true,
            trainingConfig: true,
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
    contactName: string | null;
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

    const conversationRows = await prisma.$queryRaw<Array<{ id: string; activeProductContext: unknown }>>`
      SELECT "id"
      , "activeProductContext"
      FROM "OfficialApiConversation"
      WHERE "configId" = ${configId}
        AND "externalThreadId" = ${message.waId}
      LIMIT 1
    `;
    const conversation = conversationRows[0];
    if (!conversation) {
      continue;
    }
    const activeProductContext = conversation.activeProductContext as ActiveProductContext | null | undefined;
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
      contactName: message.contactName,
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

  if (!matchingConfig && !(await isProviderVerifyToken(verifyToken))) {
    return NextResponse.json({ ok: false, error: "Verify token invalido." }, { status: 403 });
  }

  if (matchingConfig) {
    await markWebhookVerified(matchingConfig.id);
  }

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
  const signature = request.headers.get("x-hub-signature-256")?.trim() || "";
  const providerAppSecret = await getProviderAppSecret();
  // Ignoramos un config.appSecret con formato invalido y caemos al del proveedor; si ninguno
  // es valido, expectedAppSecret queda vacio y se omite la verificacion de firma (en vez de
  // rechazar todos los entrantes por firmar contra un secret incorrecto).
  const expectedAppSecret = normalizeMetaAppSecret(config?.appSecret) || providerAppSecret;

  if (expectedAppSecret) {
    if (!signature) {
      return NextResponse.json({ ok: false, error: "Missing webhook signature." }, { status: 401 });
    }

    const expectedSignature = buildExpectedSignature(rawBody, expectedAppSecret);
    if (!safeCompare(signature, expectedSignature)) {
      return NextResponse.json({ ok: false, error: "Invalid webhook signature." }, { status: 401 });
    }
  }

  if (!config) {
    return NextResponse.json({ ok: true, matched: false }, { status: 200 });
  }

  const deliveryId = extractDeliveryId(payload);
  const eventType = extractEventType(payload);

  try {
    const insertedMessages = await syncInboundMessages(config.id, payload);
    await syncMessageStatuses(config.id, payload);
    const linkedAgentChannel = await findOfficialApiLinkedAgent(config.workspaceId);

    for (const message of insertedMessages) {
      const recentMessages = linkedAgentChannel?.agent?.id
        ? await prisma.$queryRaw<Array<{ direction: "INBOUND" | "OUTBOUND"; content: string | null }>>`
            SELECT "direction"::text AS "direction", "content"
            FROM "OfficialApiMessage"
            WHERE "conversationId" = ${message.conversationId}
            ORDER BY "createdAt" ASC
            LIMIT 8
          `
        : [];

      const agentTraining = linkedAgentChannel?.agent?.id
        ? parseAgentTrainingConfig(linkedAgentChannel.agent.trainingConfig)
        : null;

      const notifyHumanAction = linkedAgentChannel?.agent?.id
        ? resolveNotifyHumanAction({
            trainingConfig: linkedAgentChannel.agent.trainingConfig,
            agentName: linkedAgentChannel.agent.name,
            customerPhoneNumber: message.waId,
            customerName: message.contactName,
            latestUserMessage: message.content,
            history: recentMessages,
          })
        : null;
      const notifyHumanPromise = notifyHumanAction
        ? sendOfficialApiDirectTextMessage({
            config,
            to: notifyHumanAction.destinationPhoneNumber,
            message: notifyHumanAction.message,
          }).catch((error) => {
            console.warn("[official-api] human_notification_failed", {
              configId: config.id,
              conversationId: message.conversationId,
              contactId: message.contactId,
              destinationPhoneNumber: notifyHumanAction.destinationPhoneNumber,
              error: error instanceof Error ? error.message : String(error),
            });
            return null;
          })
        : null;
      const shouldHandoffToHuman = Boolean(notifyHumanAction);
      const agentKnowledgeBaseReply = shouldHandoffToHuman || !linkedAgentChannel?.agent?.id
        ? null
        : await resolveAgentKnowledgeBaseReply({
            agentId: linkedAgentChannel.agent.id,
            workspaceId: config.workspaceId,
            conversationId: message.conversationId,
            latestUserMessage: message.content,
            history: recentMessages,
          });
      const conversationForProductFlow = await prisma.officialApiConversation.findUnique({
        where: { id: message.conversationId },
        select: { activeProductContext: true },
      });
      const activeProductContext = conversationForProductFlow?.activeProductContext as ActiveProductContext | null | undefined;
      const agentProductFlowResolution = shouldHandoffToHuman || !linkedAgentChannel?.agent?.id
        ? null
        : await resolveAgentProductFlowReply({
            agentId: linkedAgentChannel.agent.id,
            workspaceId: config.workspaceId,
            latestUserMessage: message.content,
            history: recentMessages,
            includeOfficialApi: true,
            activeProductContext: activeProductContext ?? null,
          });
      const agentProductFlowReply = agentProductFlowResolution?.steps
        ? agentProductFlowResolution
        : null;

      if (agentProductFlowResolution?.activeProductContext) {
        await prisma.$executeRaw`
          UPDATE "OfficialApiConversation"
          SET "activeProductContext" = ${agentProductFlowResolution.activeProductContext as Prisma.InputJsonValue},
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${message.conversationId}
        `;
      }

      const hasActiveProductContext = Boolean(agentProductFlowResolution?.activeProductContext);
      const autoUnknownProductNotifyAction =
        linkedAgentChannel?.agent?.id &&
        !shouldHandoffToHuman &&
        !hasActiveProductContext &&
        !agentProductFlowReply &&
        !agentKnowledgeBaseReply &&
        agentTraining?.actions.notify.autoNotifyOnUnknownProduct
          ? resolveUnknownProductNotifyAction({
              trainingConfig: linkedAgentChannel.agent.trainingConfig,
              agentName: linkedAgentChannel.agent.name,
              customerPhoneNumber: message.waId,
              customerName: message.contactName,
              latestUserMessage: message.content,
            })
          : null;
      const autoUnknownProductNotifyPromise = autoUnknownProductNotifyAction
        ? sendOfficialApiDirectTextMessage({
            config,
            to: autoUnknownProductNotifyAction.destinationPhoneNumber,
            message: autoUnknownProductNotifyAction.message,
          }).catch((error) => {
            console.warn("[official-api] auto_unknown_product_notification_failed", {
              configId: config.id,
              conversationId: message.conversationId,
              contactId: message.contactId,
              destinationPhoneNumber: autoUnknownProductNotifyAction.destinationPhoneNumber,
              error: error instanceof Error ? error.message : String(error),
            });
            return null;
          })
        : null;

      const chatbotReply = shouldHandoffToHuman || Boolean(autoUnknownProductNotifyAction)
        ? null
        : await resolveOfficialApiAutomationReply({
            configId: config.id,
            conversationId: message.conversationId,
            inboundText: message.content,
          });
      const agentProductFlowSteps = agentProductFlowReply?.steps ?? [];
      const reply = agentProductFlowReply
        ? {
            text: agentProductFlowSteps.find((s) => s.kind === "text")?.content?.trim() || null,
            image: agentProductFlowSteps.find((s): s is Extract<(typeof agentProductFlowSteps)[number], { kind: "image" }> => s.kind === "image") ?? null,
            images: agentProductFlowSteps.filter((s): s is Extract<(typeof agentProductFlowSteps)[number], { kind: "image" }> => s.kind === "image"),
            audio: agentProductFlowSteps.find((s): s is Extract<(typeof agentProductFlowSteps)[number], { kind: "audio" }> => s.kind === "audio") ?? null,
            audios: agentProductFlowSteps.filter((s): s is Extract<(typeof agentProductFlowSteps)[number], { kind: "audio" }> => s.kind === "audio"),
            video: agentProductFlowSteps.find((s): s is Extract<(typeof agentProductFlowSteps)[number], { kind: "video" }> => s.kind === "video") ?? null,
            videos: agentProductFlowSteps.filter((s): s is Extract<(typeof agentProductFlowSteps)[number], { kind: "video" }> => s.kind === "video"),
          }
        : agentKnowledgeBaseReply
          ? agentKnowledgeBaseReply
          : autoUnknownProductNotifyAction
            ? {
                text: composeAgentWelcomeReply({
                  welcomeMessage: linkedAgentChannel?.agent?.welcomeMessage ?? null,
                  reply: "Ya en un momento te atendera un asesor para ayudarte con esa solicitud.",
                  hasConversationHistory: recentMessages.length > 1,
                }),
                image: null,
                video: null,
              }
            : shouldHandoffToHuman
              ? {
                  text: buildHandoffMessage(),
                  image: null,
                  video: null,
                }
              : chatbotReply
                ? {
                    text: chatbotReply.text?.trim() || null,
                    image: chatbotReply.image,
                    video: null,
                  }
                : null;

      const contactMatchTasks: Array<Promise<unknown>> = [];
      if (agentProductFlowReply?.flowTitle) {
        contactMatchTasks.push(
          recordContactMatch({
            workspaceId: config.workspaceId,
            contactId: message.contactId,
            conversationId: message.conversationId,
            matchType: "FLOW",
            sourceType: "FLOW",
            targetName: agentProductFlowReply.flowTitle,
            targetId: null,
          }),
        );
      }
      if (agentProductFlowReply?.productName) {
        contactMatchTasks.push(
          recordContactMatch({
            workspaceId: config.workspaceId,
            contactId: message.contactId,
            conversationId: message.conversationId,
            matchType: "PRODUCT",
            sourceType: "FLOW",
            targetName: agentProductFlowReply.productName,
            targetId: null,
          }),
        );
      }
      if (agentKnowledgeBaseReply?.productName) {
        contactMatchTasks.push(
          recordContactMatch({
            workspaceId: config.workspaceId,
            contactId: message.contactId,
            conversationId: message.conversationId,
            matchType: "PRODUCT",
            sourceType: "KNOWLEDGE",
            targetName: agentKnowledgeBaseReply.productName,
            targetId: null,
          }),
        );
      }

      if (contactMatchTasks.length > 0) {
        await Promise.allSettled(contactMatchTasks);
      }

      if (autoUnknownProductNotifyPromise) {
        await autoUnknownProductNotifyPromise;
        if (agentTraining?.actions.notify.pauseConversationAfterNotify) {
          await setConversationAutomationPaused({
            conversationId: message.conversationId,
            paused: true,
          });
        }
      }

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

      const audiosToSend = (reply as { audio?: { url: string; caption: string | null } | null; audios?: Array<{ url: string; caption: string | null }> }).audios ?? ((reply as { audio?: { url: string; caption: string | null } | null }).audio ? [(reply as { audio?: { url: string; caption: string | null } | null }).audio!] : []);
      for (const audio of audiosToSend) {
        if (!audio?.url) continue;
        try {
          const audioResult = await sendOfficialApiAudioMessage({
            config,
            conversationId: message.conversationId,
            contactId: message.contactId,
            to: message.waId,
            audioUrl: audio.url,
            caption: audio.caption,
            source: "automation",
          });
          if (!audioResult.ok) {
            console.warn("[official-api] audio node failed, continuing flow", {
              configId: config.id,
              conversationId: message.conversationId,
              contactId: message.contactId,
              error: audioResult.error,
            });
          }
        } catch {
          console.warn("[official-api] audio node threw error, continuing flow", {
            configId: config.id,
            conversationId: message.conversationId,
            contactId: message.contactId,
          });
        }
      }

      const videosToSend = (reply as { video?: { url: string; caption: string | null } | null; videos?: Array<{ url: string; caption: string | null }> }).videos ?? ((reply as { video?: { url: string; caption: string | null } | null }).video ? [(reply as { video?: { url: string; caption: string | null } | null }).video!] : []);
      for (const video of videosToSend) {
        if (!video?.url) continue;
        try {
          const videoResult = await sendOfficialApiVideoMessage({
            config,
            conversationId: message.conversationId,
            contactId: message.contactId,
            to: message.waId,
            videoUrl: video.url,
            caption: video.caption,
            source: "automation",
          });
          if (!videoResult.ok) {
            console.warn("[official-api] video node failed, continuing flow", {
              configId: config.id,
              conversationId: message.conversationId,
              contactId: message.contactId,
              error: videoResult.error,
            });
          }
        } catch {
          console.warn("[official-api] video node threw error, continuing flow", {
            configId: config.id,
            conversationId: message.conversationId,
            contactId: message.contactId,
          });
        }
      }

      let imageSent = false;
      const imagesToSend = (reply as { images?: Array<{ url: string; caption: string | null }> }).images ?? (reply.image ? [reply.image] : []);
      for (const img of imagesToSend) {
        if (!img?.url) continue;
        try {
          const imageResult = await sendOfficialApiImageMessage({
            config,
            conversationId: message.conversationId,
            contactId: message.contactId,
            to: message.waId,
            imageUrl: img.url,
            caption: img.caption,
            source: "automation",
          });
          if (imageResult.ok) {
            imageSent = true;
          } else {
            console.warn("[official-api] image node failed, continuing flow", {
              configId: config.id,
              conversationId: message.conversationId,
              contactId: message.contactId,
              error: imageResult.error,
            });
          }
        } catch {
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

      if (notifyHumanPromise) {
        await notifyHumanPromise;
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

