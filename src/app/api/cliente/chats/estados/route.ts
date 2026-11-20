import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUserCached } from "@/lib/client-workspace-access";
import { canalesQueMonitorea } from "@/lib/modo-monitoreo";
import { getVisibleChannelIds } from "@/lib/channel-visibility";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";
import { esSupervisora } from "@/lib/permisos-del-equipo";
import { puedeAbrirChatPorClave } from "@/lib/chats-acceso-por-enlace";
import { prisma } from "@/lib/prisma";
import { conServerTiming, type MedidorServerTiming } from "@/lib/server-timing";

/*
  Los chulos del chat abierto, sin el chat (velocidad de Chats, paso 3, 19-nov-2026).

  Cada "entregado" o "leido" que avisaba WhatsApp hacia que el navegador volviera a pedir el chat
  abierto entero por /live (~17 kB, con los rawPayload, la verificacion de medios y el marcado de
  leidos), solo para cambiar el color de un chulo. Medido: 17 de los 31 avisos de un minuto eran
  acuses. El aviso del altavoz no dice que mensaje cambio, asi que se piden los estados de los
  ultimos mensajes salientes: id, estado y si el audio ya se escucho (~1 kB).

  Solo lectura. Mismas reglas de acceso que /live: un chat que no se puede abrir responde 404.
  No marca leidos ni toca nada: un acuse no trae mensajes del cliente.
*/

const MENSAJES_SALIENTES = 20;

export const GET = conServerTiming(manejarGet);

async function manejarGet(request: Request, t: MedidorServerTiming) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const access = await getClientWorkspaceAccessForUserCached(session.user.id);
  if (!access || !canAccessClientModule(access, "chats")) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }

  const chatKey = new URL(request.url).searchParams.get("chatKey")?.trim() || "";
  const conversationId = chatKey.startsWith("agent:") ? chatKey.slice("agent:".length).trim() : "";
  if (!conversationId) {
    return NextResponse.json({ ok: false, error: "Chat invalido" }, { status: 400 });
  }

  const workspaceId = access.workspaceId;
  const [canalesMonitoreados, esJefe, canalesVisibles] = await Promise.all([
    canalesQueMonitorea({ workspaceId, userId: session.user.id }),
    esJefeDelNegocio(access) ? Promise.resolve(true) : esSupervisora(workspaceId, session.user.id),
    getVisibleChannelIds({
      workspaceId,
      userId: session.user.id,
      esJefe: access.isOwner || access.role === "ADMIN",
    }),
  ]);
  const permitido = await puedeAbrirChatPorClave({
    workspaceId,
    userId: session.user.id,
    fuente: "agent",
    conversationId,
    esJefe,
    canalesVisibles,
    canalesMonitoreados,
  });
  t.marca("auth");
  if (!permitido) {
    return NextResponse.json({ ok: false, error: "Conversacion no encontrada" }, { status: 404 });
  }

  /*
    El rawPayload se lee SOLO de los audios (el CASE no lo abre en los demas): leer ese JSON es lo
    caro de una consulta sobre mensajes. Usa el indice (workspaceId, conversationId, direction,
    createdAt).
  */
  const filas = await prisma.$queryRaw<Array<{ id: string; estado: string; reproducidoAt: string | null }>>`
    SELECT "id",
           "status"::text AS "estado",
           CASE WHEN "type" = 'AUDIO' THEN "rawPayload"->>'reproducidoAt' ELSE NULL END AS "reproducidoAt"
    FROM "Message"
    WHERE "workspaceId" = ${workspaceId}
      AND "conversationId" = ${conversationId}
      AND "direction" = 'OUTBOUND'
    ORDER BY "createdAt" DESC
    LIMIT ${MENSAJES_SALIENTES}
  `;
  t.marca("estados");

  return NextResponse.json({
    ok: true,
    estados: filas.map((fila) => ({
      id: fila.id,
      estado: fila.estado,
      reproducidoAt: typeof fila.reproducidoAt === "string" && fila.reproducidoAt ? fila.reproducidoAt : null,
    })),
  });
}
