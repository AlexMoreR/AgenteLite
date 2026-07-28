import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import { buildActiveProductContextNote, resolveAgentProductFlowReply, type ActiveProductContext } from "@/lib/agent-product-flow";
import { composeAgentWelcomeReply } from "@/lib/agent-reply-composer";
import { generateAgentReply } from "@/lib/agent-ai";
import {
  buildCommercialConversationContext,
  buildCommercialConversationContextPromptSection,
  buildCommercialStagePromptSection,
  buildNegotiationAdvanceReply,
  classifyCommercialStage,
  parseCommercialConversationContext,
  shouldOverrideCommercialReply,
} from "@/lib/commercial-stage";
import { resolveOfficialApiAutomationReply } from "@/lib/official-api-chatbot";
import {
  sendOfficialApiAudioMessage,
  sendOfficialApiDirectTextMessage,
  sendOfficialApiImageMessage,
  sendOfficialApiTextMessage,
  sendOfficialApiTypingIndicator,
  sendOfficialApiVideoMessage,
} from "@/lib/official-api-messaging";
import {
  ensureOfficialApiConfigTable,
  getOfficialApiConversationAutomationPaused,
  setOfficialApiConversationAutomationPaused,
} from "@/lib/official-api-config";
import { resolveAgentKnowledgeBaseReply } from "@/lib/agent-knowledge-media";
import { recordContactMatch } from "@/lib/contact-matches";
import { prisma } from "@/lib/prisma";
import { notifyRealtimeUpdate } from "@/lib/realtime-notify";
import { normalizeMetaAppSecret } from "@/lib/official-api-graph";
import { downloadOfficialApiMedia } from "@/lib/official-api-media";
import { ensureCrmContactForOfficialApi } from "@/lib/official-api-crm-bridge";
import { getOfficialApiProviderSettings } from "@/lib/system-settings";
import { buildHandoffMessage, parseAgentTrainingConfig } from "@/lib/agent-training";
import {
  CONSULTAR_FLUJOS_TOOL,
  CONSULTAR_PRODUCTOS_TOOL,
  NOTIFICAR_ASESOR_TOOL,
  executeConsultarFlujosTool,
  executeConsultarProductosTool,
  resolveNotifyHumanAction,
  resolveUnknownProductNotifyAction,
  sendNotificarAsesorNotification,
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
          // Media entrante: Cloud API NO manda el archivo, manda un `id` que hay que canjear
          // contra Graph (ver official-api-media.ts). El `caption` es el texto que el cliente
          // escribió junto a la foto/video/documento; sin leerlo se perdía.
          image?: { id?: string; mime_type?: string; caption?: string };
          audio?: { id?: string; mime_type?: string; voice?: boolean };
          video?: { id?: string; mime_type?: string; caption?: string };
          document?: { id?: string; mime_type?: string; caption?: string; filename?: string };
          sticker?: { id?: string; mime_type?: string };
          // Tipos que antes no se leían y quedaban como burbuja vacía "-" en el chat.
          location?: { latitude?: number; longitude?: number; name?: string; address?: string };
          contacts?: Array<{
            name?: { formatted_name?: string; first_name?: string };
            phones?: Array<{ phone?: string; wa_id?: string }>;
          }>;
          // Respuesta a un botón de plantilla y a botones/listas interactivas: el cliente aprieta
          // "Sí, quiero" y sin esto llegaba vacío (y la IA recibía texto en blanco).
          button?: { text?: string; payload?: string };
          interactive?: {
            type?: string;
            button_reply?: { id?: string; title?: string };
            list_reply?: { id?: string; title?: string; description?: string };
          };
          // Reacción (👍): NO es un mensaje nuevo, se pega al mensaje al que reaccionó.
          reaction?: { message_id?: string; emoji?: string };
          // Pedido armado desde el catálogo.
          order?: { catalog_id?: string; product_items?: Array<{ quantity?: number; item_price?: number }> };
          system?: { body?: string; wa_id?: string };
          errors?: Array<{ code?: number; title?: string; message?: string }>;
        }>;
        // Coexistencia: mensajes que la asesora manda desde la app de WhatsApp Business
        // (no via nuestra API). Meta los "refleja" con este campo para que el CRM se entere.
        message_echoes?: Array<{
          from?: string;
          to?: string;
          id?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          // Coexistencia: lo que la asesora manda desde SU celular. Antes solo se leía el texto,
          // así que las fotos y los PDF que ella enviaba llegaban al CRM en blanco.
          image?: { id?: string; mime_type?: string; caption?: string };
          audio?: { id?: string; mime_type?: string; voice?: boolean };
          video?: { id?: string; mime_type?: string; caption?: string };
          document?: { id?: string; mime_type?: string; caption?: string; filename?: string };
          sticker?: { id?: string; mime_type?: string };
          location?: { latitude?: number; longitude?: number; name?: string; address?: string };
          contacts?: Array<{
            name?: { formatted_name?: string; first_name?: string };
            phones?: Array<{ phone?: string }>;
          }>;
        }>;
        // Coexistencia: alta/edicion de contactos guardados en la app de WhatsApp Business.
        state_sync?: Array<{
          type?: string;
          action?: string;
          contact?: {
            full_name?: string;
            first_name?: string;
            phone_number?: string;
          };
        }>;
        // Coexistencia: backfill del historial previo (ventana de 24h tras el onboarding).
        history?: Array<{
          metadata?: { phase?: string; chunk_order?: string; progress?: string };
          errors?: Array<{ code?: number; title?: string; message?: string }>;
          threads?: Array<{
            id?: string;
            messages?: Array<{
              from?: string;
              to?: string;
              id?: string;
              timestamp?: string;
              type?: string;
              text?: { body?: string };
              history_context?: { status?: string };
            }>;
          }>;
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
  type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "TEMPLATE" | "INTERACTIVE" | "SYSTEM" | "LOCATION" | "CONTACTS";
  createdAt: Date;
  rawPayload: MetaWebhookPayload;
  // Id del archivo en Meta, para bajarlo despues del insert (el webhook responde primero).
  mediaId: string | null;
  // Tipo con el que se guarda el archivo. Los stickers se guardan como IMAGE porque el enum de
  // la API oficial no tiene STICKER, pero el archivo igual se baja y se ve.
  mediaKind: "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "STICKER" | null;
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
            model: true,
            systemPrompt: true,
            welcomeMessage: true,
            fallbackMessage: true,
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
    // El sticker se guarda como imagen: el enum no tiene STICKER y el archivo se ve igual.
    case "sticker":
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
    case "location":
      return "LOCATION";
    case "contacts":
      return "CONTACTS";
    default:
      // Todo lo que no conocemos (incluido lo que Meta agregue mañana) queda como texto, pero
      // con un contenido legible armado en extractInboundMessages: nunca una burbuja vacía.
      return "TEXT";
  }
}

/**
 * Texto legible para los mensajes que NO son texto plano.
 *
 * Sin esto, todo lo que no fuera texto llegaba con contenido vacío: la asesora veía una burbuja
 * con un guion "-" y, peor, el agente IA recibía un mensaje en blanco y contestaba cualquier cosa.
 */
function buildReadableContent(message: {
  type?: string;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: Array<{ name?: { formatted_name?: string; first_name?: string }; phones?: Array<{ phone?: string }> }>;
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string; description?: string } };
  order?: { product_items?: Array<{ quantity?: number }> };
  system?: { body?: string };
  errors?: Array<{ title?: string; message?: string }>;
}): string | null {
  switch (message.type) {
    case "location": {
      const place = message.location?.name?.trim() || message.location?.address?.trim() || "";
      const coords =
        typeof message.location?.latitude === "number" && typeof message.location?.longitude === "number"
          ? `${message.location.latitude}, ${message.location.longitude}`
          : "";
      return `📍 Ubicación${place ? `: ${place}` : ""}${coords ? ` (${coords})` : ""}`;
    }
    case "contacts": {
      const names = (message.contacts ?? [])
        .map((contact) => {
          const name = contact.name?.formatted_name?.trim() || contact.name?.first_name?.trim() || "";
          const phone = contact.phones?.[0]?.phone?.trim() || "";
          return [name, phone].filter(Boolean).join(" ");
        })
        .filter(Boolean);
      return `👤 Contacto compartido${names.length ? `: ${names.join(", ")}` : ""}`;
    }
    // Respuesta a un botón de plantilla o a un botón/lista interactiva: es lo que el cliente
    // "dijo", así que va como texto normal para que la IA y la asesora lo entiendan.
    case "button":
      return message.button?.text?.trim() || null;
    case "interactive":
      return (
        message.interactive?.button_reply?.title?.trim() ||
        message.interactive?.list_reply?.title?.trim() ||
        message.interactive?.list_reply?.description?.trim() ||
        null
      );
    case "order": {
      const count = message.order?.product_items?.length ?? 0;
      return `🛒 Pedido del catálogo${count ? ` (${count} producto${count === 1 ? "" : "s"})` : ""}`;
    }
    case "system":
      return message.system?.body?.trim() || null;
    case "unsupported":
      return `⚠️ Mensaje no soportado${message.errors?.[0]?.title ? `: ${message.errors[0].title}` : ""}`;
    default:
      return null;
  }
}

function parseMetaTimestamp(value: string | undefined) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return new Date();
  }

  return new Date(seconds * 1000);
}

/** Reacciones del cliente: a qué mensaje y con qué emoji ("" = la quitó). */
function extractInboundReactions(payload: MetaWebhookPayload) {
  const changes = payload.entry?.flatMap((entry) => entry.changes ?? []) ?? [];

  return changes.flatMap((change) =>
    (change.value?.messages ?? [])
      .filter((message) => message.type === "reaction" && message.reaction?.message_id?.trim())
      .map((message) => ({
        targetMessageId: message.reaction!.message_id!.trim(),
        emoji: message.reaction?.emoji?.trim() ?? "",
      })),
  );
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

        // Archivo adjunto (si lo hay) y el texto que lo acompaña. Antes solo se leía
        // `text.body`, así que una foto con comentario llegaba vacía y sin archivo.
        const attachment =
          message.image ?? message.video ?? message.document ?? message.audio ?? message.sticker ?? null;
        const mediaKind: ExtractedInboundMessage["mediaKind"] = message.image
          ? "IMAGE"
          : message.video
            ? "VIDEO"
            : message.document
              ? "DOCUMENT"
              : message.audio
                ? "AUDIO"
                : message.sticker
                  ? "STICKER"
                  : null;
        const caption =
          message.image?.caption?.trim() ||
          message.video?.caption?.trim() ||
          message.document?.caption?.trim() ||
          // Un documento sin comentario al menos muestra su nombre en vez de quedar en blanco.
          message.document?.filename?.trim() ||
          null;

        // Una REACCIÓN (👍) no es un mensaje: es un emoji sobre un mensaje que ya existe. Antes
        // creaba una burbuja vacía suelta Y despertaba al agente IA con un texto en blanco (el
        // bot le contestaba a un pulgar arriba). Se procesa aparte y no entra a la lista.
        if (message.type === "reaction") {
          return null;
        }

        return {
          id: messageId,
          waId,
          contactName: contactNames.get(waId) ?? null,
          content: message.text?.body?.trim() || caption || buildReadableContent(message),
          type: mapMessageType(message.type),
          createdAt: parseMetaTimestamp(message.timestamp),
          rawPayload: payload,
          mediaId: attachment?.id?.trim() || null,
          mediaKind,
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

async function syncInboundMessages(
  configId: string,
  payload: MetaWebhookPayload,
  accessToken?: string | null,
  workspaceId?: string | null,
) {
  // Reacciones (👍 ❤️): se pegan al mensaje al que reaccionó el cliente, igual que en el canal
  // por Evolution. Emoji vacío = quitó la reacción. No generan mensaje ni despiertan al agente.
  for (const reaction of extractInboundReactions(payload)) {
    await prisma.$executeRaw`
      UPDATE "OfficialApiMessage"
      SET "reactionEmoji" = ${reaction.emoji || null},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "configId" = ${configId}
        AND "externalMessageId" = ${reaction.targetMessageId}
    `.catch((error) => {
      console.error("[OFFICIAL_API] reaction_update_failed", error);
      return 0;
    });
  }

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
    // UNIFICACION CON EL CRM: quien escribe a este canal entra al embudo como cualquier otro
    // lead. Sin esto vivia en una tabla aparte y para el Kanban, "Mi dia", el informe y los
    // seguimientos simplemente no existia.
    if (contactRows[0] && workspaceId) {
      const officialContactId = contactRows[0].id;
      const crmContactId = await ensureCrmContactForOfficialApi({
        workspaceId,
        waId: message.waId,
        name: message.contactName,
      });

      if (crmContactId) {
        await prisma
          .$executeRaw`
            UPDATE "OfficialApiContact"
            SET "crmContactId" = ${crmContactId}, "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${officialContactId}
          `
          .catch(() => 0);
      }
    }

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
      -- Meta reintenta si tardamos (el LLM puede demorar) y el chequeo de duplicados es un SELECT
      -- aparte: sin esto, el reintento violaba el índice único, cortaba el bucle y se perdían los
      -- demás mensajes del mismo webhook.
      ON CONFLICT ("configId", "externalMessageId") DO NOTHING
    `;

    // El archivo se baja DESPUES de responderle a Meta (after): Cloud API espera un 200 rapido y
    // un video de varios MB tardaria demasiado. El mensaje ya quedo guardado; cuando el archivo
    // esta listo se le agrega el mediaUrl y aparece solo en el chat.
    if (message.mediaId && message.mediaKind && accessToken) {
      const mediaId = message.mediaId;
      const mediaKind = message.mediaKind;
      const externalMessageId = message.id;
      const mediaConversationId = conversation.id;

      after(async () => {
        const media = await downloadOfficialApiMedia({ mediaId, accessToken, mediaType: mediaKind });
        if (!media) {
          return;
        }

        await prisma.$executeRaw`
          UPDATE "OfficialApiMessage"
          SET "mediaUrl" = ${media.mediaUrl},
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE "configId" = ${configId}
            AND "externalMessageId" = ${externalMessageId}
        `;

        // El navegador ya pinto el mensaje sin archivo: se avisa de nuevo para que lo repinte.
        if (workspaceId) {
          await notifyRealtimeUpdate({ workspaceId, conversationId: mediaConversationId }).catch(
            () => undefined,
          );
        }
      });
    }

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

// --- Coexistencia: echoes, sync de contactos e historial -------------------------------
// Comparten el mismo upsert de contacto+conversacion que usa syncInboundMessages, pero NO
// disparan auto-respuesta del agente: son eventos que ya pasaron (mensaje ya enviado desde
// el celu, contacto ya guardado, historial ya viejo), no un mensaje nuevo que responder.

async function upsertOfficialApiContactAndConversation(input: {
  configId: string;
  waId: string;
  contactName: string | null;
  lastMessageAt: Date;
  rawPayload: MetaWebhookPayload;
  // Hace falta para crear/enlazar la ficha del cliente en el CRM (ver official-api-crm-bridge).
  workspaceId?: string | null;
}): Promise<{ contactId: string; conversationId: string } | null> {
  await prisma.$executeRaw`
    INSERT INTO "OfficialApiContact" (
      "id", "configId", "externalUserId", "waId", "name", "phoneNumber", "metadata", "lastMessageAt", "createdAt", "updatedAt"
    )
    VALUES (
      ${randomUUID()}, ${input.configId}, ${input.waId}, ${input.waId}, ${input.contactName}, ${input.waId},
      ${JSON.stringify(input.rawPayload)}, ${input.lastMessageAt}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("configId", "waId")
    DO UPDATE SET
      "name" = COALESCE(EXCLUDED."name", "OfficialApiContact"."name"),
      "phoneNumber" = EXCLUDED."phoneNumber",
      "externalUserId" = EXCLUDED."externalUserId",
      "lastMessageAt" = EXCLUDED."lastMessageAt",
      "updatedAt" = CURRENT_TIMESTAMP
  `;

  const contactRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "OfficialApiContact" WHERE "configId" = ${input.configId} AND "waId" = ${input.waId} LIMIT 1
  `;
  const contact = contactRows[0];
  if (!contact) {
    return null;
  }

  // UNIFICACION CON EL CRM: la persona es una sola aunque escriba por varios numeros. Se crea (o
  // se encuentra) su ficha del CRM y se deja enlazada, para que entre al embudo como cualquier
  // otro lead. Best-effort: si falla, el mensaje igual se guarda.
  if (input.workspaceId) {
    const crmContactId = await ensureCrmContactForOfficialApi({
      workspaceId: input.workspaceId,
      waId: input.waId,
      name: input.contactName,
    });

    if (crmContactId) {
      await prisma
        .$executeRaw`
          UPDATE "OfficialApiContact"
          SET "crmContactId" = ${crmContactId}, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${contact.id}
        `
        .catch(() => 0);
    }
  }

  await prisma.$executeRaw`
    INSERT INTO "OfficialApiConversation" (
      "id", "configId", "contactId", "externalThreadId", "status", "lastMessageAt", "createdAt", "updatedAt"
    )
    VALUES (
      ${randomUUID()}, ${input.configId}, ${contact.id}, ${input.waId},
      'OPEN'::"OfficialApiConversationStatus", ${input.lastMessageAt}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("configId", "externalThreadId")
    DO UPDATE SET
      "contactId" = EXCLUDED."contactId",
      "lastMessageAt" = EXCLUDED."lastMessageAt",
      "updatedAt" = CURRENT_TIMESTAMP
  `;

  const conversationRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "OfficialApiConversation" WHERE "configId" = ${input.configId} AND "externalThreadId" = ${input.waId} LIMIT 1
  `;
  const conversation = conversationRows[0];
  if (!conversation) {
    return null;
  }

  return { contactId: contact.id, conversationId: conversation.id };
}

function extractMessageEchoes(payload: MetaWebhookPayload) {
  const changes = payload.entry?.flatMap((entry) => entry.changes ?? []) ?? [];

  return changes.flatMap((change) => {
    if (change.field !== "smb_message_echoes") {
      return [];
    }

    return (change.value?.message_echoes ?? [])
      .map((echo) => {
        // "to" es el cliente (el negocio es "from"): la conversacion se guarda por el cliente.
        const waId = echo.to?.trim() || "";
        const messageId = echo.id?.trim() || "";
        if (!waId || !messageId) {
          return null;
        }

        // Mismo tratamiento que un mensaje entrante: archivo + texto que lo acompaña. Sin esto,
        // la foto que la asesora mandaba desde su celular llegaba al CRM como burbuja vacía.
        const attachment =
          echo.image ?? echo.video ?? echo.document ?? echo.audio ?? echo.sticker ?? null;
        const mediaKind: "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "STICKER" | null = echo.image
          ? "IMAGE"
          : echo.video
            ? "VIDEO"
            : echo.document
              ? "DOCUMENT"
              : echo.audio
                ? "AUDIO"
                : echo.sticker
                  ? "STICKER"
                  : null;
        const caption =
          echo.image?.caption?.trim() ||
          echo.video?.caption?.trim() ||
          echo.document?.caption?.trim() ||
          echo.document?.filename?.trim() ||
          null;

        return {
          id: messageId,
          waId,
          content: echo.text?.body?.trim() || caption || buildReadableContent(echo),
          type: mapMessageType(echo.type),
          createdAt: parseMetaTimestamp(echo.timestamp),
          mediaId: attachment?.id?.trim() || null,
          mediaKind,
        };
      })
      .filter((echo): echo is NonNullable<typeof echo> => Boolean(echo));
  });
}

// Registra (sin auto-responder) los mensajes que la asesora ya envio desde la app de
// WhatsApp Business, para que aparezcan en el historial del CRM (coexistencia real).
async function syncMessageEchoes(
  configId: string,
  payload: MetaWebhookPayload,
  accessToken?: string | null,
  workspaceId?: string | null,
) {
  const echoes = extractMessageEchoes(payload);

  for (const echo of echoes) {
    const existingRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "OfficialApiMessage" WHERE "configId" = ${configId} AND "externalMessageId" = ${echo.id} LIMIT 1
    `;
    if (existingRows[0]) {
      continue;
    }

    const resolved = await upsertOfficialApiContactAndConversation({
      configId,
      waId: echo.waId,
      contactName: null,
      lastMessageAt: echo.createdAt,
      rawPayload: payload,
      workspaceId,
    });
    if (!resolved) {
      continue;
    }

    await prisma.$executeRaw`
      INSERT INTO "OfficialApiMessage" (
        "id", "configId", "conversationId", "contactId", "externalMessageId", "direction", "type", "status", "content", "rawPayload", "createdAt", "updatedAt"
      ) VALUES (
        ${randomUUID()}, ${configId}, ${resolved.conversationId}, ${resolved.contactId}, ${echo.id},
        'OUTBOUND'::"OfficialApiMessageDirection", ${echo.type}::"OfficialApiMessageType", 'SENT'::"OfficialApiMessageStatus",
        ${echo.content}, ${JSON.stringify(payload)}, ${echo.createdAt}, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("configId", "externalMessageId") DO NOTHING
    `;

    // El archivo se baja después de responderle a Meta, igual que en los mensajes entrantes.
    if (echo.mediaId && echo.mediaKind && accessToken) {
      const mediaId = echo.mediaId;
      const mediaKind = echo.mediaKind;
      const externalMessageId = echo.id;
      const echoConversationId = resolved.conversationId;

      after(async () => {
        try {
          const media = await downloadOfficialApiMedia({ mediaId, accessToken, mediaType: mediaKind });
          if (!media) {
            return;
          }

          await prisma.$executeRaw`
            UPDATE "OfficialApiMessage"
            SET "mediaUrl" = ${media.mediaUrl}, "updatedAt" = CURRENT_TIMESTAMP
            WHERE "configId" = ${configId} AND "externalMessageId" = ${externalMessageId}
          `;

          if (workspaceId) {
            await notifyRealtimeUpdate({ workspaceId, conversationId: echoConversationId }).catch(
              () => undefined,
            );
          }
        } catch (error) {
          console.error("[OFFICIAL_API] echo_media_failed", error);
        }
      });
    }
  }
}

function extractStateSyncContacts(payload: MetaWebhookPayload) {
  const changes = payload.entry?.flatMap((entry) => entry.changes ?? []) ?? [];

  return changes.flatMap((change) => {
    if (change.field !== "smb_app_state_sync") {
      return [];
    }

    return (change.value?.state_sync ?? [])
      .filter((entry) => entry.type === "contact" && entry.action !== "remove")
      .map((entry) => {
        const waId = entry.contact?.phone_number?.replace(/\D/g, "") || "";
        const name = entry.contact?.full_name?.trim() || entry.contact?.first_name?.trim() || null;
        if (!waId || !name) {
          return null;
        }

        return { waId, name };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  });
}

// Solo ACTUALIZA el nombre de contactos que YA existen (tienen conversacion): no crea
// conversaciones fantasma a partir de un contacto sincronizado sin ningun mensaje.
async function syncContactStateSync(configId: string, payload: MetaWebhookPayload) {
  const contacts = extractStateSyncContacts(payload);

  for (const contact of contacts) {
    await prisma.$executeRaw`
      UPDATE "OfficialApiContact"
      SET "name" = ${contact.name}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "configId" = ${configId} AND "waId" = ${contact.waId}
    `;
  }
}

function extractHistoryMessages(payload: MetaWebhookPayload) {
  const changes = payload.entry?.flatMap((entry) => entry.changes ?? []) ?? [];

  return changes.flatMap((change) => {
    if (change.field !== "history") {
      return [];
    }

    const displayPhoneNumber = change.value?.metadata?.display_phone_number?.replace(/\D/g, "") || "";

    return (change.value?.history ?? []).flatMap((entry) => {
      if (entry.errors?.length) {
        // El cliente no acepto compartir el historial (o Meta no pudo entregarlo): no hay
        // nada que sincronizar para este chunk, solo lo dejamos anotado en el log.
        console.warn("[official-api] history_sync_not_available", { errors: entry.errors });
        return [];
      }

      return (entry.threads ?? []).flatMap((thread) => {
        const waId = thread.id?.trim() || "";
        if (!waId) {
          return [];
        }

        return (thread.messages ?? [])
          .map((message) => {
            const messageId = message.id?.trim() || "";
            if (!messageId) {
              return null;
            }

            const fromDigits = message.from?.replace(/\D/g, "") || "";
            const isOutbound = Boolean(displayPhoneNumber) && fromDigits === displayPhoneNumber;

            return {
              id: messageId,
              waId,
              content: message.text?.body?.trim() || null,
              type: mapMessageType(message.type),
              createdAt: parseMetaTimestamp(message.timestamp),
              direction: (isOutbound ? "OUTBOUND" : "INBOUND") as "OUTBOUND" | "INBOUND",
              status: mapMessageStatus(message.history_context?.status),
            };
          })
          .filter((message): message is NonNullable<typeof message> => Boolean(message));
      });
    });
  });
}

// Backfill del historial previo al onboarding (ventana de 24h que da Meta). Igual que los
// echoes: se persiste tal cual, sin disparar auto-respuesta (son mensajes viejos).
async function syncHistoryMessages(configId: string, payload: MetaWebhookPayload) {
  const messages = extractHistoryMessages(payload);

  for (const message of messages) {
    const existingRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "OfficialApiMessage" WHERE "configId" = ${configId} AND "externalMessageId" = ${message.id} LIMIT 1
    `;
    if (existingRows[0]) {
      continue;
    }

    const resolved = await upsertOfficialApiContactAndConversation({
      configId,
      waId: message.waId,
      contactName: null,
      lastMessageAt: message.createdAt,
      rawPayload: payload,
    });
    if (!resolved) {
      continue;
    }

    await prisma.$executeRaw`
      INSERT INTO "OfficialApiMessage" (
        "id", "configId", "conversationId", "contactId", "externalMessageId", "direction", "type", "status", "content", "rawPayload", "createdAt", "updatedAt"
      ) VALUES (
        ${randomUUID()}, ${configId}, ${resolved.conversationId}, ${resolved.contactId}, ${message.id},
        ${message.direction}::"OfficialApiMessageDirection", ${message.type}::"OfficialApiMessageType", ${message.status}::"OfficialApiMessageStatus",
        ${message.content}, ${JSON.stringify(payload)}, ${message.createdAt}, CURRENT_TIMESTAMP
      )
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
    // Coexistencia: sync de contactos, echoes (mensajes enviados desde el celu) e historial.
    // No disparan auto-respuesta, solo dejan el CRM al dia con lo que ya paso.
    await syncContactStateSync(config.id, payload);
    await syncMessageEchoes(config.id, payload, config.accessToken, config.workspaceId);
    await syncHistoryMessages(config.id, payload);

    const insertedMessages = await syncInboundMessages(
      config.id,
      payload,
      config.accessToken,
      config.workspaceId,
    );
    await syncMessageStatuses(config.id, payload);

    // Avisa al altavoz para que los navegadores abiertos pinten el cambio al instante, sin
    // esperar el poll. Best-effort: no bloquea ni rompe el webhook si el altavoz no responde.
    void notifyRealtimeUpdate({
      workspaceId: config.workspaceId,
      conversationId: insertedMessages[0]?.conversationId ?? null,
    });
    const linkedAgentChannel = await findOfficialApiLinkedAgent(config.workspaceId);

    for (const message of insertedMessages) {
      // Si el asesor pauso la automatizacion de esta conversacion, guardamos el entrante
      // (ya persistido por syncInboundMessages) pero NO auto-respondemos.
      if (await getOfficialApiConversationAutomationPaused(message.conversationId)) {
        continue;
      }

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
        select: { activeProductContext: true, commercialContext: true },
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

      // Conversacion IA libre (paridad con Evolution): cuando el agente no resolvio por
      // producto/flujo/conocimiento y no hay handoff/auto-notify, generamos la respuesta con
      // el modelo del agente (system prompt + tools + contexto comercial + fallback + bienvenida).
      const iaAgent = linkedAgentChannel?.agent;
      let agentIaText: string | null = null;
      const shouldRunAgentIa =
        Boolean(iaAgent?.id) &&
        !shouldHandoffToHuman &&
        !autoUnknownProductNotifyAction &&
        !agentProductFlowReply &&
        !agentKnowledgeBaseReply;

      // Un canal SIN agente vinculado no responde NADA: la conversacion queda para una persona.
      //
      // Antes, sin agente, se caia igual en el chatbot basico, que sin configurar devuelve el
      // escenario por defecto ("Hola. Soy el asistente automatico..." + "Todavia no tengo una
      // respuesta segura para eso...") — un generico que el cliente recibia incluso al mandar una
      // foto. Preferimos el silencio: es mejor que conteste una asesora a que conteste un robot
      // que no sabe nada del negocio.
      const hasLinkedAgent = Boolean(linkedAgentChannel?.agent?.id);

      // El chatbot basico de la API oficial solo actua cuando NO hay agente IA que responda
      // (el agente vinculado tiene prioridad y no queremos avanzar escenarios en silencio).
      const chatbotReply = !hasLinkedAgent || shouldHandoffToHuman || Boolean(autoUnknownProductNotifyAction) || shouldRunAgentIa
        ? null
        : await resolveOfficialApiAutomationReply({
            configId: config.id,
            conversationId: message.conversationId,
            inboundText: message.content,
          });

      if (shouldRunAgentIa && iaAgent) {
        const inboundText = message.content ?? "";
        const historyRows = await prisma.$queryRaw<
          Array<{ direction: "INBOUND" | "OUTBOUND"; content: string | null; type: string | null; mediaUrl: string | null }>
        >`
          SELECT "direction"::text AS "direction", "content", "type"::text AS "type", "mediaUrl"
          FROM "OfficialApiMessage"
          WHERE "conversationId" = ${message.conversationId}
          ORDER BY "createdAt" DESC
          LIMIT 12
        `;
        const historyTurns = historyRows
          .reverse()
          .map((m) => ({
            direction: m.direction,
            content: m.content,
            type: (m.type ?? "TEXT") as
              | "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "TEMPLATE" | "INTERACTIVE" | "SYSTEM",
            mediaUrl: m.mediaUrl,
          }));

        // Contexto comercial (etapa + contexto de conversacion) y su persistencia.
        const previousCommercialContext = parseCommercialConversationContext(conversationForProductFlow?.commercialContext);
        const commercialStageResolution = classifyCommercialStage({
          latestUserMessage: inboundText,
          history: historyTurns,
          activeProductContext: activeProductContext ?? null,
          previousStage: previousCommercialContext?.currentStage ?? null,
          commercialContext: previousCommercialContext,
        });
        const commercialConversationContext = buildCommercialConversationContext({
          stage: commercialStageResolution,
          latestUserMessage: inboundText,
          history: historyTurns,
          activeProductContext: activeProductContext ?? null,
          previousContext: previousCommercialContext,
        });
        await prisma.$executeRaw`
          UPDATE "OfficialApiConversation"
          SET "commercialContext" = ${commercialConversationContext as unknown as Prisma.InputJsonValue},
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${message.conversationId}
        `;

        const commercialStagePrompt = buildCommercialStagePromptSection(commercialStageResolution);
        const commercialContextPrompt = buildCommercialConversationContextPromptSection(commercialConversationContext);
        const effectiveSystemPrompt =
          agentTraining?.useCustomPrompt && agentTraining.customSystemPrompt?.trim()
            ? `${agentTraining.customSystemPrompt.trim()}\n\n${commercialStagePrompt}\n\n${commercialContextPrompt}`
            : `${iaAgent.systemPrompt ?? ""}\n\n${commercialStagePrompt}\n\n${commercialContextPrompt}`;

        // Notas de contexto que se anteponen al mensaje del cliente (no al system prompt).
        const aiContextNotes = new Set<string>();
        const productNote = buildActiveProductContextNote(activeProductContext ?? null);
        if (productNote) aiContextNotes.add(productNote);
        if (commercialStagePrompt) aiContextNotes.add(commercialStagePrompt);
        if (commercialContextPrompt) aiContextNotes.add(commercialContextPrompt);
        const latestUserMessageForIa =
          aiContextNotes.size > 0
            ? `${Array.from(aiContextNotes).join("\n")}\n\nMensaje del cliente: ${message.content ?? ""}`
            : message.content ?? "";

        const toolHandlers = {
          Notificar_asesor: async (args: Record<string, unknown>) => {
            const result = await sendNotificarAsesorNotification({
              trainingConfig: iaAgent.trainingConfig,
              agentName: iaAgent.name,
              customerPhoneNumber: message.waId,
              customerName: message.contactName,
              latestUserMessage: message.content,
              toolInput: args,
              sendMessage: async (destinationPhoneNumber: string, text: string) =>
                sendOfficialApiDirectTextMessage({ config, to: destinationPhoneNumber, message: text }),
            });
            if (result.ok && agentTraining?.actions.notify.pauseConversationAfterNotify) {
              await setOfficialApiConversationAutomationPaused({ conversationId: message.conversationId, paused: true });
            }
            return result;
          },
          consultar_productos: async (args: Record<string, unknown>) => {
            const result = await executeConsultarProductosTool({ agentId: iaAgent.id, toolInput: args });
            return result ?? { found: false, matches: [], bestMatch: null, recommendation: "No hay coincidencias suficientes." };
          },
          consultar_flujos: async (args: Record<string, unknown>) => {
            const result = await executeConsultarFlujosTool({
              workspaceId: config.workspaceId,
              includeOfficialApi: true,
              toolInput: args,
              allowedFlowIds: agentTraining?.knowledgeFlowIds?.length ? agentTraining.knowledgeFlowIds : undefined,
              enabledChildFlowIds: activeProductContext?.followUpFlowId?.trim()
                ? [activeProductContext.followUpFlowId.trim()]
                : undefined,
            });
            return result ?? { found: false, matches: [], bestMatch: null, recommendation: "No hay coincidencias suficientes." };
          },
        } satisfies Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

        const agentTools = [
          NOTIFICAR_ASESOR_TOOL,
          ...(agentTraining?.enableProductLookup !== false ? [CONSULTAR_PRODUCTOS_TOOL] : []),
          ...(agentTraining?.enableFlowLookup !== false ? [CONSULTAR_FLUJOS_TOOL] : []),
        ];

        let iaText = await generateAgentReply({
          model: iaAgent.model,
          systemPrompt: effectiveSystemPrompt,
          fallbackMessage: iaAgent.fallbackMessage,
          history: historyTurns,
          latestUserMessage: latestUserMessageForIa,
          tools: agentTools,
          toolHandlers,
        });

        if (shouldOverrideCommercialReply(iaText ?? "", commercialConversationContext)) {
          iaText = buildNegotiationAdvanceReply({
            latestUserMessage: inboundText,
            activeProductContext: activeProductContext ?? null,
          });
        }

        agentIaText = composeAgentWelcomeReply({
          welcomeMessage: iaAgent.welcomeMessage ?? null,
          reply: iaText,
          hasConversationHistory: recentMessages.length > 1,
        });
      }

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
              : agentIaText
                ? {
                    text: agentIaText,
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
          // message.conversationId es un id de OfficialApiConversation: usar el setter oficial
          // (antes se usaba el de la tabla "Conversation" de Evolution, un no-op aqui).
          await setOfficialApiConversationAutomationPaused({
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

