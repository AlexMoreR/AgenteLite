"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { getOfficialApiConfigByWorkspaceId } from "@/lib/official-api-config";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

const sendOfficialApiReplySchema = z.object({
  conversationId: z.string().trim().min(1),
  message: z.string().trim().min(1).max(4096),
});

export async function sendOfficialApiReplyAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const parsed = sendOfficialApiReplySchema.safeParse({
    conversationId: formData.get("conversationId"),
    message: formData.get("message"),
  });

  const fallbackConversationId = String(formData.get("conversationId") || "");

  if (!parsed.success) {
    redirect(`/cliente/api-oficial/chats?conversationId=${fallbackConversationId}&error=No+se+pudo+enviar+el+mensaje`);
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    redirect("/cliente/api-oficial?error=Debes+configurar+tu+negocio+primero");
  }

  const config = await getOfficialApiConfigByWorkspaceId(membership.workspace.id);
  if (!config?.accessToken || !config.phoneNumberId || config.status !== "CONNECTED") {
    redirect("/cliente/api-oficial?error=La+API+oficial+no+esta+activa");
  }

  const conversationRows = await prisma.$queryRaw<Array<{
    id: string;
    contactId: string;
    contactWaId: string | null;
    contactPhoneNumber: string | null;
  }>>`
    SELECT
      c."id",
      ct."id" AS "contactId",
      ct."waId" AS "contactWaId",
      ct."phoneNumber" AS "contactPhoneNumber"
    FROM "OfficialApiConversation" c
    INNER JOIN "OfficialApiContact" ct
      ON ct."id" = c."contactId"
    WHERE c."id" = ${parsed.data.conversationId}
      AND c."configId" = ${config.id}
    LIMIT 1
  `;

  const conversation = conversationRows[0] ?? null;

  if (!conversation?.contactWaId) {
    redirect(`/cliente/api-oficial/chats?conversationId=${fallbackConversationId}&error=No+se+encontro+el+contacto`);
  }

  const response = await fetch(
    `https://graph.facebook.com/v23.0/${encodeURIComponent(config.phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: conversation.contactWaId,
        type: "text",
        text: {
          body: parsed.data.message,
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
    const errorMessage =
      payload?.error?.message || "No se pudo enviar el mensaje con la API oficial.";
    redirect(`/cliente/api-oficial/chats?conversationId=${conversation.id}&error=${encodeURIComponent(errorMessage)}`);
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
      ${config.id},
      ${conversation.id},
      ${conversation.contactId},
      ${payload?.messages?.[0]?.id ?? null},
      'OUTBOUND'::"OfficialApiMessageDirection",
      'TEXT'::"OfficialApiMessageType",
      'SENT'::"OfficialApiMessageStatus",
      ${parsed.data.message},
      ${JSON.stringify({
        source: "manual",
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
    WHERE "id" = ${conversation.id}
  `;

  await prisma.$executeRaw`
    UPDATE "OfficialApiContact"
    SET
      "lastMessageAt" = ${now},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${conversation.contactId}
  `;

  revalidatePath("/cliente/api-oficial");
  revalidatePath("/cliente/api-oficial/chats");
  redirect(`/cliente/api-oficial/chats?conversationId=${conversation.id}&ok=Mensaje+enviado`);
}
