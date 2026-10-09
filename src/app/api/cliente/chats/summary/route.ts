import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getAgentConversationSummaryByConversationId,
  getAgentConversationSummaryByPhoneNumber,
} from "@/lib/chat-conversation-summary";
import { canAccessClientModule, getClientWorkspaceAccessForUserCached } from "@/lib/client-workspace-access";
import { conServerTiming, type MedidorServerTiming } from "@/lib/server-timing";

function extractConversationIdFromChatKey(chatKey: string): string | null {
  const prefix = "agent:";
  if (!chatKey.startsWith(prefix)) return null;
  const id = chatKey.slice(prefix.length).trim();
  return id || null;
}

export const GET = conServerTiming(manejarGet);

async function manejarGet(request: Request, t: MedidorServerTiming) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  // Una sola lectura de acceso por pedido, y de la cache del proceso (45 s, se vacia sola al
  // cambiar usuarios, miembros o negocios: ver cache-de-permisos.ts).
  const access = await getClientWorkspaceAccessForUserCached(session.user.id);
  if (!access || !canAccessClientModule(access, "chats")) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }

  /*
    Antes aca se volvia a leer la membresia con getPrimaryWorkspaceForUser: la MISMA que ya trae
    `access` (la primera activa por fecha de alta), mas los conteos de agentes, canales y TODAS
    las conversaciones del negocio, que esta ruta no usa. Eran 2-5 consultas mas por pedido.
  */
  const membership = { role: access.membershipRole, workspace: { id: access.workspaceId } };
  t.marca("auth");

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
  t.marca("resumen");

  if (!conversation) {
    return NextResponse.json({ ok: false, error: "Conversacion no encontrada" });
  }

  return NextResponse.json({ ok: true, conversation });
}
