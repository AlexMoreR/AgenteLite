import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { loadAgentConversationDetail } from "@/lib/chat-message-loader";
import { fetchEvolutionMediaDataUrl } from "@/lib/evolution";
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
  const beforeMessageId = requestUrl.searchParams.get("beforeMessageId")?.trim() || "";
  const batchSizeParam = requestUrl.searchParams.get("batchSize")?.trim() || "";
  const parsed = parseChatKey(chatKey);

  if (!parsed) {
    return NextResponse.json({ ok: false, error: "Chat invalido" }, { status: 400 });
  }

  const conversation = await loadAgentConversationDetail({
    workspaceId: membership.workspace.id,
    conversationId: parsed.conversationId,
    beforeMessageId: beforeMessageId || null,
    batchSize: batchSizeParam ? Number.parseInt(batchSizeParam, 10) : (beforeMessageId ? 10 : 1),
  });

  if (!conversation) {
    return NextResponse.json({ ok: false, error: "Conversacion no encontrada" }, { status: 404 });
  }

  const instanceName = conversation.channel?.evolutionInstanceName?.trim() || null;
  const messages = await Promise.all(
    conversation.messages.map(async (message) => {
      const resolvedMediaUrl =
        message.type === "AUDIO" && instanceName
          ? (await fetchEvolutionMediaDataUrl({
              instanceName,
              messageId: message.externalId ?? message.id,
              mediaType: "AUDIO",
            })) || message.mediaUrl
          : message.mediaUrl;

      return {
        ...message,
        mediaUrl: resolvedMediaUrl,
        createdAt: message.createdAt.toISOString(),
      };
    }),
  );

  return NextResponse.json({
    ok: true,
    conversation: {
      ...conversation,
      label: conversation.contact.name?.trim() || conversation.contact.phoneNumber,
      secondaryLabel: conversation.contact.phoneNumber,
      avatarUrl: conversation.contact.avatarUrl ?? null,
      contactId: conversation.contact.id,
      messages,
    },
  });
}
