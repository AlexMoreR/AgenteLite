import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { idDeEnvioValido } from "@/lib/chat-envio-reintento";
import { anotarErrorDeEnvio, datosDeLineaDelChat } from "@/lib/chat-errores-de-envio";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/*
  Anota un error de envio que el servidor no pudo ver: el navegador ni consiguio hablar con el
  (sin internet, version vieja, servidor reiniciando). Lo manda el propio navegador cuando vuelve la
  conexion. Solo anota; no envia nada.
*/
const MOTIVOS = new Set(["version_vieja", "sin_red", "timeout_gateway", "conexion_cerrada", "sesion", "otro"]);

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const membership = await getPrimaryWorkspaceForUser(userId);
  const workspaceId = membership?.workspace.id;
  if (!workspaceId) {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  const cuerpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const motivoCrudo = typeof cuerpo?.motivo === "string" ? cuerpo.motivo : "otro";
  const motivo = (MOTIVOS.has(motivoCrudo) ? motivoCrudo : "otro") as
    | "version_vieja"
    | "sin_red"
    | "timeout_gateway"
    | "conexion_cerrada"
    | "sesion"
    | "otro";
  const conversationId = typeof cuerpo?.conversationId === "string" ? cuerpo.conversationId.slice(0, 100) : "";
  const source = cuerpo?.source === "official" ? "official" : "agent";

  await anotarErrorDeEnvio({
    workspaceId,
    conversationId: conversationId || null,
    linea: conversationId ? await datosDeLineaDelChat({ source, conversationId, workspaceId }) : null,
    motivo,
    detalle: typeof cuerpo?.detalle === "string" ? cuerpo.detalle : null,
    clientMessageId: idDeEnvioValido(cuerpo?.clientMessageId),
    userId,
    intento: typeof cuerpo?.intento === "number" ? cuerpo.intento : 1,
    origen: "navegador",
  });
  return NextResponse.json({ ok: true });
}
