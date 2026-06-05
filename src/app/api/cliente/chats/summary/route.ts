import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getAgentConversationSummaryByConversationId,
  getAgentConversationSummaryByPhoneNumber,
} from "@/lib/chat-conversation-summary";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

function extractConversationIdFromChatKey(chatKey: string): string | null {
  const prefix = "agent:";
  if (!chatKey.startsWith(prefix)) return null;
  const id = chatKey.slice(prefix.length).trim();
  return id || null;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "chats")) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    return NextResponse.json({ ok: false, error: "Workspace no encontrado" }, { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const chatKey = requestUrl.searchParams.get("chatKey")?.trim() || "";
  const instanceName = requestUrl.searchParams.get("instanceName")?.trim() || "";
  const phoneNumber = requestUrl.searchParams.get("phoneNumber")?.trim() || "";

  // Los empleados (no-managers) solo pueden recibir summaries de sus chats asignados.
  // El realtime escucha toda la instancia de WhatsApp, asi que sin este filtro se les
  // inyectarian en la lista chats ajenos que luego no pueden abrir (quedan cargando).
  const isManager = membership.role === "OWNER" || membership.role === "ADMIN";
  const assignedToUserId = isManager ? undefined : session.user.id;

  let conversation = null;

  if (chatKey) {
    const conversationId = extractConversationIdFromChatKey(chatKey);
    if (!conversationId) {
      return NextResponse.json({ ok: false, error: "Parametros invalidos" }, { status: 400 });
    }
    conversation = await getAgentConversationSummaryByConversationId({
      workspaceId: membership.workspace.id,
      conversationId,
      assignedToUserId,
    });
  } else {
    if (!instanceName || !phoneNumber) {
      return NextResponse.json({ ok: false, error: "Parametros invalidos" }, { status: 400 });
    }
    conversation = await getAgentConversationSummaryByPhoneNumber({
      workspaceId: membership.workspace.id,
      instanceName,
      phoneNumber,
      assignedToUserId,
    });
  }

  if (!conversation) {
    return NextResponse.json({ ok: false, error: "Conversacion no encontrada" });
  }

  return NextResponse.json({ ok: true, conversation });
}
