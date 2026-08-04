import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { lookupEvolutionUserInfo, sampleEvolutionContacts } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";

/**
 * ¿El gateway sabe a que TELEFONO corresponde un LID?
 *
 * WhatsApp nos manda a veces el telefono y a veces solo el LID, para la misma persona. Cuando
 * llega solo el LID y nunca vimos el par, se abre una ficha nueva: la misma clienta queda dos
 * veces, con dos chats, y la asesora contesta en uno sin ver el otro.
 *
 * El motor que hay adentro de evogo (whatsmeow) mantiene esa equivalencia —la necesita para
 * enrutar—, pero no sabemos si la expone. Esto lo averigua preguntandole de verdad, en vez de
 * suponerlo leyendo documentacion.
 *
 * Las credenciales no salen del servidor: se leen de la conexion guardada, igual que para
 * enviar un mensaje.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "connection")) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const channelId = url.searchParams.get("channelId")?.trim() || "";
  const lid = url.searchParams.get("lid")?.trim() || "";

  const canal = channelId
    ? await prisma.whatsAppChannel.findFirst({
        where: { id: channelId, workspaceId: access.workspaceId, provider: "EVOLUTION" },
        select: { evolutionInstanceName: true, name: true },
      })
    : await prisma.whatsAppChannel.findFirst({
        where: { workspaceId: access.workspaceId, provider: "EVOLUTION", status: "CONNECTED" },
        select: { evolutionInstanceName: true, name: true },
      });

  if (!canal?.evolutionInstanceName) {
    return NextResponse.json({ ok: false, error: "No hay un canal de WhatsApp conectado." }, { status: 404 });
  }

  const [info, contactos] = await Promise.all([
    lid ? lookupEvolutionUserInfo({ instanceName: canal.evolutionInstanceName, jid: lid }) : Promise.resolve(null),
    sampleEvolutionContacts({ instanceName: canal.evolutionInstanceName }),
  ]);

  return NextResponse.json({
    ok: true,
    canal: canal.name,
    // Respuesta cruda de /user/info para ESE lid: es un solo contacto, no una agenda.
    userInfo: info,
    // De /user/contacts solo se devuelve la FORMA, no la agenda entera.
    contactos,
  });
}
