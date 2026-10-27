import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { registrarErrorDeEnvio } from "@/lib/chat-errores-de-envio";
import { idDeMensajeValido } from "@/lib/chat-envio-reintento";

/*
  Anota un error de envio que ocurrio en el NAVEGADOR (sin señal, la app no respondio): el pedido
  ni llego a /api/cliente/chats/enviar, asi que el servidor no pudo anotarlo. El navegador lo manda
  aca cuando vuelve la conexion. Solo mide: no envia nada.
*/
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const membership = await getPrimaryWorkspaceForUser(session.user.id).catch(() => null);
  if (!membership?.workspace.id) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const lista = Array.isArray(cuerpo.errores) ? cuerpo.errores.slice(0, 10) : [cuerpo];
  for (const item of lista) {
    const dato = (item ?? {}) as Record<string, unknown>;
    await registrarErrorDeEnvio({
      workspaceId: membership.workspace.id,
      conversationId: typeof dato.conversationId === "string" ? dato.conversationId.slice(0, 80) : null,
      lineaNombre: typeof dato.lineaNombre === "string" ? dato.lineaNombre : null,
      motivo: typeof dato.motivo === "string" ? dato.motivo : "sin_red",
      detalle: typeof dato.detalle === "string" ? dato.detalle : null,
      clientMessageId: idDeMensajeValido(typeof dato.clientMessageId === "string" ? dato.clientMessageId : null),
      userId: session.user.id,
      intento: Number(dato.intento) || 1,
      origen: "navegador",
    });
  }
  return NextResponse.json({ ok: true });
}
