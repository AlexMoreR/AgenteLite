import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { loadAgentConversationDetail } from "@/lib/chat-message-loader";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

function parseChatKey(input: string) {
  if (!input) {
    return null;
  }

  const [source, ...rest] = input.split(":");
  const conversationId = rest.join(":");

  if (source !== "agent" || !conversationId) {
    return null;
  }

  return {
    source: source as "agent",
    conversationId,
  };
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    return NextResponse.json({ ok: false, error: "Workspace no encontrado" }, { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const chatKey = requestUrl.searchParams.get("chatKey")?.trim() || "";
  const parsed = parseChatKey(chatKey);

  if (!parsed) {
    return NextResponse.json({ ok: false, error: "Chat invalido" }, { status: 400 });
  }

  const conversation = await loadAgentConversationDetail({
    workspaceId: membership.workspace.id,
    conversationId: parsed.conversationId,
    batchSize: 20,
  });

  if (!conversation) {
    return NextResponse.json({ ok: false, error: "Conversacion no encontrada" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    conversation: {
      ...conversation,
      messages: conversation.messages.map((message) => ({
        ...message,
        createdAt: message.createdAt.toISOString(),
      })),
    },
  });
}
