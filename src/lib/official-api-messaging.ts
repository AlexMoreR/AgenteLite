import { randomUUID } from "node:crypto";
import { getMetaGraphErrorMessage, isMetaGraphAuthError } from "@/lib/official-api-graph";
import { updateOfficialApiConnectionStatus } from "@/lib/official-api-connection-status";
import { prisma } from "@/lib/prisma";

type OfficialApiMessagingConfig = {
  id: string;
  accessToken: string | null;
  phoneNumberId: string | null;
};

export async function sendOfficialApiTypingIndicator(input: {
  config: OfficialApiMessagingConfig;
  to: string;
  inboundMessageId: string;
  delayMs?: number;
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
      // OJO: este request es "marcar como leido + escribiendo", NO un envio de mensaje. Cloud API
      // solo acepta messaging_product, status, message_id y typing_indicator. Mandar tambien
      // `recipient_type` y `to` (que son del envio) lo hacia fallar con "(#100) Invalid parameter",
      // asi que el indicador NUNCA se mostraba y ademas no habia pausa antes de responder.
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: input.inboundMessageId,
        typing_indicator: {
          type: "text",
        },
      }),
      cache: "no-store",
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | {
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
        : getMetaGraphErrorMessage(payload, "No se pudo activar el indicador de escritura."),
    };
  }

  const delayMs = Number.isFinite(input.delayMs) ? Math.max(0, Math.min(4000, input.delayMs ?? 900)) : 900;
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return { ok: true as const };
}

export async function sendOfficialApiAudioMessage(input: {
  config: OfficialApiMessagingConfig;
  conversationId: string;
  contactId: string;
  to: string;
  audioUrl: string;
  // URL que se GUARDA en la base. Meta necesita la absoluta para descargar el archivo, pero
  // guardamos la relativa (igual que el otro canal): con la absoluta, la burbuja "enviando" no
  // coincidia con el mensaje real y se quedaba girando para siempre.
  storedMediaUrl?: string | null;
  caption?: string | null;
  source: "manual" | "automation";
}) {
  if (!input.config.accessToken?.trim() || !input.config.phoneNumberId?.trim()) {
    return { ok: false as const, error: "La API oficial no tiene credenciales activas." };
  }

  const normalizedCaption = input.caption?.trim() || null;
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
        type: "audio",
        audio: {
          link: input.audioUrl,
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
        : getMetaGraphErrorMessage(payload, "No se pudo enviar el audio con la API oficial."),
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
      "mediaUrl",
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
      'AUDIO'::"OfficialApiMessageType",
      'SENT'::"OfficialApiMessageStatus",
      ${normalizedCaption},
      ${input.storedMediaUrl ?? input.audioUrl},
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

export async function sendOfficialApiDirectTextMessage(input: {
  config: OfficialApiMessagingConfig;
  to: string;
  message: string;
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
        recipient_type: "individual",
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
        : getMetaGraphErrorMessage(payload, "No se pudo enviar la notificacion con la API oficial."),
    };
  }

  return {
    ok: true as const,
    messageId: payload?.messages?.[0]?.id ?? null,
  };
}

export async function sendOfficialApiVideoMessage(input: {
  config: OfficialApiMessagingConfig;
  conversationId: string;
  contactId: string;
  to: string;
  videoUrl: string;
  // URL que se GUARDA en la base. Meta necesita la absoluta para descargar el archivo, pero
  // guardamos la relativa (igual que el otro canal): con la absoluta, la burbuja "enviando" no
  // coincidia con el mensaje real y se quedaba girando para siempre.
  storedMediaUrl?: string | null;
  caption?: string | null;
  source: "manual" | "automation";
}) {
  if (!input.config.accessToken?.trim() || !input.config.phoneNumberId?.trim()) {
    return { ok: false as const, error: "La API oficial no tiene credenciales activas." };
  }

  const normalizedCaption = input.caption?.trim() || null;
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
        type: "video",
        video: {
          link: input.videoUrl,
          ...(normalizedCaption ? { caption: normalizedCaption } : {}),
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
        : getMetaGraphErrorMessage(payload, "No se pudo enviar el video con la API oficial."),
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
      "mediaUrl",
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
      'VIDEO'::"OfficialApiMessageType",
      'SENT'::"OfficialApiMessageStatus",
      ${normalizedCaption},
      ${input.storedMediaUrl ?? input.videoUrl},
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

export async function sendOfficialApiImageMessage(input: {
  config: OfficialApiMessagingConfig;
  conversationId: string;
  contactId: string;
  to: string;
  imageUrl: string;
  // URL que se GUARDA en la base. Meta necesita la absoluta para descargar el archivo, pero
  // guardamos la relativa (igual que el otro canal): con la absoluta, la burbuja "enviando" no
  // coincidia con el mensaje real y se quedaba girando para siempre.
  storedMediaUrl?: string | null;
  caption?: string | null;
  source: "manual" | "automation";
}) {
  if (!input.config.accessToken?.trim() || !input.config.phoneNumberId?.trim()) {
    return { ok: false as const, error: "La API oficial no tiene credenciales activas." };
  }

  const normalizedCaption = input.caption?.trim() || null;
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
        type: "image",
        image: {
          link: input.imageUrl,
          ...(normalizedCaption ? { caption: normalizedCaption } : {}),
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
        : getMetaGraphErrorMessage(payload, "No se pudo enviar la imagen con la API oficial."),
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
      "mediaUrl",
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
      'IMAGE'::"OfficialApiMessageType",
      'SENT'::"OfficialApiMessageStatus",
      ${normalizedCaption},
      ${input.storedMediaUrl ?? input.imageUrl},
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

/**
 * Envia un DOCUMENTO (el catalogo en PDF) por la API oficial.
 *
 * Faltaba por completo: era el unico tipo de archivo sin funcion, y sin el la asesora no podia
 * mandar el catalogo — el motivo principal por el que el canal oficial no se podia usar para
 * vender. Mismo patron que imagen/video: link publico + persistencia en OfficialApiMessage.
 */
export async function sendOfficialApiDocumentMessage(input: {
  config: OfficialApiMessagingConfig;
  conversationId: string;
  contactId: string;
  to: string;
  documentUrl: string;
  // URL que se GUARDA en la base. Meta necesita la absoluta para descargar el archivo, pero
  // guardamos la relativa (igual que el otro canal): con la absoluta, la burbuja "enviando" no
  // coincidia con el mensaje real y se quedaba girando para siempre.
  storedMediaUrl?: string | null;
  fileName?: string | null;
  caption?: string | null;
  source: "manual" | "automation";
}) {
  if (!input.config.accessToken?.trim() || !input.config.phoneNumberId?.trim()) {
    return { ok: false as const, error: "La API oficial no tiene credenciales activas." };
  }

  const normalizedCaption = input.caption?.trim() || null;
  const normalizedFileName = input.fileName?.trim() || "documento.pdf";

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
        type: "document",
        document: {
          link: input.documentUrl,
          filename: normalizedFileName,
          ...(normalizedCaption ? { caption: normalizedCaption } : {}),
        },
      }),
      cache: "no-store",
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | { messages?: Array<{ id?: string }>; error?: { message?: string } }
    | null;

  if (!response.ok) {
    if (isMetaGraphAuthError(payload)) {
      await updateOfficialApiConnectionStatus({ configId: input.config.id, status: "ERROR" });
    }

    return {
      ok: false as const,
      error: isMetaGraphAuthError(payload)
        ? "El access token de Meta ya no es valido. Pide al administrador reconectar la API oficial."
        : getMetaGraphErrorMessage(payload, "No se pudo enviar el documento con la API oficial."),
    };
  }

  const now = new Date();
  await prisma.$executeRaw`
    INSERT INTO "OfficialApiMessage" (
      "id", "configId", "conversationId", "contactId", "externalMessageId",
      "direction", "type", "status", "content", "mediaUrl", "rawPayload",
      "sentAt", "createdAt", "updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${input.config.id},
      ${input.conversationId},
      ${input.contactId},
      ${payload?.messages?.[0]?.id ?? null},
      'OUTBOUND'::"OfficialApiMessageDirection",
      'DOCUMENT'::"OfficialApiMessageType",
      'SENT'::"OfficialApiMessageStatus",
      ${normalizedCaption ?? normalizedFileName},
      ${input.storedMediaUrl ?? input.documentUrl},
      ${JSON.stringify({ source: input.source, fileName: normalizedFileName, meta: payload })},
      ${now}, ${now}, ${now}
    )
  `;

  await prisma.$executeRaw`
    UPDATE "OfficialApiConversation"
    SET "lastMessageAt" = ${now},
        "status" = 'OPEN'::"OfficialApiConversationStatus",
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${input.conversationId}
  `;

  await prisma.$executeRaw`
    UPDATE "OfficialApiContact"
    SET "lastMessageAt" = ${now}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${input.contactId}
  `;

  return { ok: true as const };
}
