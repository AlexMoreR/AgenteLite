"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { canAccessOfficialApiModule } from "@/lib/admin-module-access";
import { getOfficialApiConfigByWorkspaceId, hasOfficialApiBaseCredentials } from "@/lib/official-api-config";
import { sendOfficialApiImageMessage, sendOfficialApiTextMessage } from "@/lib/official-api-messaging";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { resolveOfficialApiQuickResponseFlow } from "@/features/official-api/services/resolveOfficialApiQuickResponseFlow";

const sendOfficialApiReplySchema = z.object({
  conversationId: z.string().trim().min(1),
  message: z.string().trim().min(1).max(4096),
  returnTo: z.string().trim().min(1).max(500).optional(),
});

export async function sendOfficialApiReplyAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }
  if (!(await canAccessOfficialApiModule(session.user.id, session.user.role))) {
    redirect("/unauthorized");
  }

  const parsed = sendOfficialApiReplySchema.safeParse({
    conversationId: formData.get("conversationId"),
    message: formData.get("message"),
    returnTo: formData.get("returnTo"),
  });

  const fallbackConversationId = String(formData.get("conversationId") || "");

  if (!parsed.success) {
    const fallbackReturnTo = typeof formData.get("returnTo") === "string" ? String(formData.get("returnTo")) : "";
    if (fallbackReturnTo) {
      redirect(`${fallbackReturnTo}${fallbackReturnTo.includes("?") ? "&" : "?"}error=No+se+pudo+enviar+el+mensaje`);
    }
    redirect(`/cliente/api-oficial/chats?conversationId=${fallbackConversationId}&error=No+se+pudo+enviar+el+mensaje`);
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    redirect("/cliente/api-oficial?error=Debes+configurar+tu+negocio+primero");
  }

  const config = await getOfficialApiConfigByWorkspaceId(membership.workspace.id);
  if (!config || !hasOfficialApiBaseCredentials(config)) {
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
    if (parsed.data.returnTo) {
      redirect(`${parsed.data.returnTo}${parsed.data.returnTo.includes("?") ? "&" : "?"}error=No+se+encontro+el+contacto`);
    }
    redirect(`/cliente/api-oficial/chats?conversationId=${fallbackConversationId}&error=No+se+encontro+el+contacto`);
  }

  const quickResponseFlow = await resolveOfficialApiQuickResponseFlow({
    configId: config.id,
    manualMessage: parsed.data.message,
  });

  if (quickResponseFlow) {
    const { reply } = quickResponseFlow;
    const textToSend = reply.text?.trim() || "";
    const imageToSend = reply.image;

    if (reply.imageFirst && imageToSend) {
      const imageResult = await sendOfficialApiImageMessage({
        config,
        conversationId: conversation.id,
        contactId: conversation.contactId,
        to: conversation.contactWaId,
        imageUrl: imageToSend.url,
        caption: imageToSend.caption,
        source: "manual",
      });

      if (!imageResult.ok) {
        revalidatePath("/cliente/api-oficial");
        revalidatePath("/cliente/api-oficial/chats");
        if (parsed.data.returnTo) {
          redirect(`${parsed.data.returnTo}${parsed.data.returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(imageResult.error)}`);
        }
        redirect(`/cliente/api-oficial/chats?conversationId=${conversation.id}&error=${encodeURIComponent(imageResult.error)}`);
      }
    }

    if (textToSend) {
      const textResult = await sendOfficialApiTextMessage({
        config,
        conversationId: conversation.id,
        contactId: conversation.contactId,
        to: conversation.contactWaId,
        message: textToSend,
        source: "manual",
      });

      if (!textResult.ok) {
        revalidatePath("/cliente/api-oficial");
        revalidatePath("/cliente/api-oficial/chats");
        if (parsed.data.returnTo) {
          redirect(`${parsed.data.returnTo}${parsed.data.returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(textResult.error)}`);
        }
        redirect(`/cliente/api-oficial/chats?conversationId=${conversation.id}&error=${encodeURIComponent(textResult.error)}`);
      }
    }

    if (!reply.imageFirst && imageToSend) {
      const imageResult = await sendOfficialApiImageMessage({
        config,
        conversationId: conversation.id,
        contactId: conversation.contactId,
        to: conversation.contactWaId,
        imageUrl: imageToSend.url,
        caption: imageToSend.caption,
        source: "manual",
      });

      if (!imageResult.ok) {
        revalidatePath("/cliente/api-oficial");
        revalidatePath("/cliente/api-oficial/chats");
        if (parsed.data.returnTo) {
          redirect(`${parsed.data.returnTo}${parsed.data.returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(imageResult.error)}`);
        }
        redirect(`/cliente/api-oficial/chats?conversationId=${conversation.id}&error=${encodeURIComponent(imageResult.error)}`);
      }
    }

    revalidatePath("/cliente/api-oficial");
    revalidatePath("/cliente/api-oficial/chats");
    if (parsed.data.returnTo) {
      redirect(`${parsed.data.returnTo}${parsed.data.returnTo.includes("?") ? "&" : "?"}ok=Flujo+enviado`);
    }
    redirect(`/cliente/api-oficial/chats?conversationId=${conversation.id}&ok=Flujo+enviado`);
  }

  const result = await sendOfficialApiTextMessage({
    config,
    conversationId: conversation.id,
    contactId: conversation.contactId,
    to: conversation.contactWaId,
    message: parsed.data.message,
    source: "manual",
  });

  if (!result.ok) {
    revalidatePath("/cliente/api-oficial");
    revalidatePath("/cliente/api-oficial/chats");
    if (parsed.data.returnTo) {
      redirect(`${parsed.data.returnTo}${parsed.data.returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(result.error)}`);
    }
    redirect(`/cliente/api-oficial/chats?conversationId=${conversation.id}&error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath("/cliente/api-oficial");
  revalidatePath("/cliente/api-oficial/chats");
  if (parsed.data.returnTo) {
    redirect(`${parsed.data.returnTo}${parsed.data.returnTo.includes("?") ? "&" : "?"}ok=Mensaje+enviado`);
  }
  redirect(`/cliente/api-oficial/chats?conversationId=${conversation.id}&ok=Mensaje+enviado`);
}
