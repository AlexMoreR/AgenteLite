"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { getOfficialApiConfigByWorkspaceId, hasOfficialApiBaseCredentials } from "@/lib/official-api-config";
import { sendOfficialApiTextMessage } from "@/lib/official-api-messaging";
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
    redirect(`/cliente/api-oficial/chats?conversationId=${fallbackConversationId}&error=No+se+encontro+el+contacto`);
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
    redirect(`/cliente/api-oficial/chats?conversationId=${conversation.id}&error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath("/cliente/api-oficial");
  revalidatePath("/cliente/api-oficial/chats");
  redirect(`/cliente/api-oficial/chats?conversationId=${conversation.id}&ok=Mensaje+enviado`);
}
