import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAgentConversationSummaryByPhoneNumber } from "@/lib/chat-conversation-summary";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

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
  const instanceName = requestUrl.searchParams.get("instanceName")?.trim() || "";
  const phoneNumber = requestUrl.searchParams.get("phoneNumber")?.trim() || "";

  if (!instanceName || !phoneNumber) {
    return NextResponse.json({ ok: false, error: "Parametros invalidos" }, { status: 400 });
  }

  const conversation = await getAgentConversationSummaryByPhoneNumber({
    workspaceId: membership.workspace.id,
    instanceName,
    phoneNumber,
  });

  if (!conversation) {
    return NextResponse.json({ ok: false, error: "Conversacion no encontrada" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, conversation });
}
