import { randomUUID } from "node:crypto";
import { getMetaGraphErrorMessage, isMetaGraphAuthError } from "@/lib/official-api-graph";
import { updateOfficialApiConnectionStatus } from "@/lib/official-api-connection-status";
import { prisma } from "@/lib/prisma";

type OfficialApiMessagingConfig = {
  id: string;
  accessToken: string | null;
  phoneNumberId: string | null;
};

export async function sendOfficialApiTextMessage(input: {
  config: OfficialApiMessagingConfig;
  conversationId: string;
  contactId: string;
  to: string;
  message: string;
  source: "manual" | "automation";
}) {
  if (!input.config.accessToken?.trim() || !input.config.phoneNumberId?.trim()) {
    return { ok: false as const, error: "La API oficial no tiene credenciales activas." };
  }

  const response = await fetch(
    `https://graph.facebook.com/v23.0/${encodeURIComponent(input.config.phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.config.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: input.to,
        type: "text",
        text: {
          body: input.message,
        },
      }),
      cache: "no-store",
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | {
        messages?: Array<{
          id?: string;
        }>;
        error?: {
          message?: string;
        };
      }
    | null;

  if (!response.ok) {
    if (isMetaGraphAuthError(payload)) {
      await updateOfficialApiConnectionStatus({
        configId: input.config.id,
        status: "ERROR",
      });
    }

    return {
      ok: false as const,
      error: isMetaGraphAuthError(payload)
        ? "El access token de Meta ya no es valido. Pide al administrador reconectar la API oficial."
        : getMetaGraphErrorMessage(payload, "No se pudo enviar el mensaje con la API oficial."),
    };
  }

  const now = new Date();
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
      "sentAt",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${input.config.id},
      ${input.conversationId},
      ${input.contactId},
      ${payload?.messages?.[0]?.id ?? null},
      'OUTBOUND'::"OfficialApiMessageDirection",
      'TEXT'::"OfficialApiMessageType",
      'SENT'::"OfficialApiMessageStatus",
      ${input.message},
      ${JSON.stringify({
        source: input.source,
        meta: payload,
      })},
      ${now},
      ${now},
      ${now}
    )
  `;

  await prisma.$executeRaw`
    UPDATE "OfficialApiConversation"
    SET
      "lastMessageAt" = ${now},
      "status" = 'OPEN'::"OfficialApiConversationStatus",
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${input.conversationId}
  `;

  await prisma.$executeRaw`
    UPDATE "OfficialApiContact"
    SET
      "lastMessageAt" = ${now},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${input.contactId}
  `;

  return { ok: true as const };
}
