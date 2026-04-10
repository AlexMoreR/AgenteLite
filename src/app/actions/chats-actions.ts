"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { sendManualAgentReplyAction } from "@/app/actions/agent-actions";
import { sendOfficialApiReplyAction } from "@/app/actions/official-api-actions";

const sendUnifiedChatReplySchema = z.object({
  source: z.enum(["agent", "official"]),
  conversationId: z.string().trim().min(1),
  message: z.string().trim().min(1).max(4096),
  agentId: z.string().trim().optional(),
});

export async function sendUnifiedChatReplyAction(formData: FormData): Promise<void> {
  const parsed = sendUnifiedChatReplySchema.safeParse({
    source: formData.get("source"),
    conversationId: formData.get("conversationId"),
    message: formData.get("message"),
    agentId: formData.get("agentId"),
  });

  if (!parsed.success) {
    redirect("/cliente/chats?error=No+se+pudo+enviar+el+mensaje");
  }

  if (parsed.data.source === "official") {
    const nextData = new FormData();
    nextData.set("conversationId", parsed.data.conversationId);
    nextData.set("message", parsed.data.message);
    return sendOfficialApiReplyAction(nextData);
  }

  if (!parsed.data.agentId) {
    redirect("/cliente/chats?error=No+se+encontro+el+agente");
  }

  const nextData = new FormData();
  nextData.set("agentId", parsed.data.agentId);
  nextData.set("conversationId", parsed.data.conversationId);
  nextData.set("message", parsed.data.message);
  return sendManualAgentReplyAction(nextData);
}
