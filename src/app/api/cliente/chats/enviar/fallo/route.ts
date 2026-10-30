import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { MAX_FALLOS_POR_ANOTAR, esMotivoDeFallo, idDeMensajeValido } from "@/lib/chat-envio-reintento";
import { anotarErrorDeEnvio } from "@/lib/chat-errores-de-envio";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

/*
  Fallos de envio que el servidor no pudo anotar porque el pedido NI LLEGO (sin internet, la app
  reiniciando). El navegador los guarda y los manda aca cuando vuelve la conexion (tarjeta whovymqk).

  Solo anota en ChatSendError del negocio de quien llama, con origen "navegador". No envia nada.
*/

const DESFASE_MAXIMO_MS = 7 * 24 * 60 * 60_000;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const userId = session.user.id;
  const access = await getClientWorkspaceAccessForUser(userId);
  if (!access || !canAccessClientModule(access, "chats")) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }
  const membership = await getPrimaryWorkspaceForUser(userId);
  if (!membership?.workspace.id) {
    return NextResponse.json({ ok: false, error: "Workspace no encontrado" }, { status: 404 });
  }

  const cuerpo = (await request.json().catch(() => null)) as { fallos?: unknown } | null;
  const fallos = Array.isArray(cuerpo?.fallos) ? cuerpo.fallos.slice(0, MAX_FALLOS_POR_ANOTAR) : [];
  const ahora = Date.now();
  let anotados = 0;
  for (const item of fallos) {
    if (!item || typeof item !== "object") continue;
    const fallo = item as Record<string, unknown>;
    if (!esMotivoDeFallo(fallo.motivo)) continue;
    const conversationId =
      typeof fallo.conversationId === "string" && fallo.conversationId.trim() ? fallo.conversationId.trim().slice(0, 200) : null;
    const ocurrioEn = typeof fallo.ocurrioEn === "number" ? fallo.ocurrioEn : NaN;
    const intento = typeof fallo.intento === "number" && Number.isInteger(fallo.intento) ? fallo.intento : 1;
    await anotarErrorDeEnvio({
      workspaceId: membership.workspace.id,
      source: fallo.source === "official" ? "official" : "agent",
      conversationId,
      motivo: fallo.motivo,
      detalle: typeof fallo.detalle === "string" ? fallo.detalle : null,
      clientMessageId: idDeMensajeValido(fallo.clientMessageId),
      userId,
      intento,
      origen: "navegador",
      // La hora en que fallo de verdad (no la de ahora), si es creible.
      ocurrioEn:
        Number.isFinite(ocurrioEn) && ocurrioEn <= ahora && ahora - ocurrioEn < DESFASE_MAXIMO_MS ? new Date(ocurrioEn) : undefined,
    });
    anotados += 1;
  }
  return NextResponse.json({ ok: true, anotados }, { headers: { "Cache-Control": "no-store" } });
}
