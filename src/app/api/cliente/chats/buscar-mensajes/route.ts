import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUserCached } from "@/lib/client-workspace-access";
import { getVisibleChannelIds } from "@/lib/channel-visibility";
import { DIAS_DE_MENSAJES_EN_LA_BUSQUEDA } from "@/lib/busqueda-de-chats";
import { canalesQueMonitorea, enmascararSiEsTelefono, enmascararTelefono } from "@/lib/modo-monitoreo";
import { esSupervisora } from "@/lib/permisos-del-equipo";
import { prisma } from "@/lib/prisma";

/*
  LOS MENSAJES QUE CONTIENEN LO BUSCADO, como la seccion "Mensajes" del buscador de WhatsApp
  (Alex, 19-10-2026).

  La lista de chats ya encuentra el CHAT por un mensaje; esto devuelve el MENSAJE: su texto, de que
  chat es y cuando, para abrir el chat justo ahi. Tambien busca en lo que se dijo en las notas de
  voz (la transcripcion).

  Cada quien ve solo lo que ya ve en la bandeja, con las mismas reglas que /api/cliente/chats/list:
  el jefe y la supervisora, sus lineas; la que monitorea, las lineas que monitorea (con los
  telefonos tapados); el resto, solo sus chats asignados. Nunca chats de contactos bloqueados.

  Sin indice de texto: `ILIKE` recorre los mensajes de 90 dias. Medido el 19-10-2026 sobre 92.485
  mensajes: 2 ms con una palabra comun, 120 ms en el peor caso (una que no aparece).
*/

const LETRAS_MINIMAS = 3;
const RESULTADOS = 30;
const LARGO_DEL_FRAGMENTO = 110;

/** El pedazo del texto alrededor de lo encontrado, con "…" si se corta. */
function fragmentoAlrededor(texto: string, q: string): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  if (limpio.length <= LARGO_DEL_FRAGMENTO) return limpio;
  const donde = limpio.toLowerCase().indexOf(q.toLowerCase());
  const inicio = Math.max(0, (donde < 0 ? 0 : donde) - 35);
  const fin = Math.min(limpio.length, inicio + LARGO_DEL_FRAGMENTO);
  return `${inicio > 0 ? "…" : ""}${limpio.slice(inicio, fin)}${fin < limpio.length ? "…" : ""}`;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  const access = await getClientWorkspaceAccessForUserCached(session.user.id);
  if (!access || !canAccessClientModule(access, "chats")) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < LETRAS_MINIMAS) {
    return NextResponse.json({ ok: true, mensajes: [] });
  }

  const workspaceId = access.workspaceId;
  const esJefe = access.membershipRole === "OWNER" || access.membershipRole === "ADMIN";
  const [esSuper, monitoreadas, visibles] = await Promise.all([
    esJefe ? Promise.resolve(true) : esSupervisora(workspaceId, session.user.id),
    canalesQueMonitorea({ workspaceId, userId: session.user.id }),
    getVisibleChannelIds({ workspaceId, userId: session.user.id, esJefe }),
  ]);
  const esManager = esJefe || esSuper;
  const tapar = monitoreadas.length > 0;

  // Mismas reglas que la bandeja (ver list/route.ts).
  const deQuienSon: Prisma.ConversationWhereInput = tapar
    ? { channelId: { in: monitoreadas } }
    : esManager
      ? {}
      : { assignedToUserId: session.user.id };

  const desde = new Date(Date.now() - DIAS_DE_MENSAJES_EN_LA_BUSQUEDA * 24 * 60 * 60 * 1000);
  const filas = await prisma.message.findMany({
    where: {
      workspaceId,
      createdAt: { gte: desde },
      deletedAt: null,
      isStatusBroadcast: false,
      type: { not: "SYSTEM" },
      OR: [
        { content: { contains: q, mode: "insensitive" } },
        { transcripcion: { contains: q, mode: "insensitive" } },
      ],
      conversation: {
        AND: [
          visibles ? { channelId: { in: visibles } } : {},
          deQuienSon,
          { contact: { bloqueadoEn: null } },
        ],
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: RESULTADOS,
    select: {
      id: true,
      content: true,
      transcripcion: true,
      createdAt: true,
      direction: true,
      type: true,
      conversationId: true,
      conversation: {
        select: { contact: { select: { name: true, phoneNumber: true, avatarUrl: true } } },
      },
    },
  });

  const mensajes = filas.map((fila) => {
    const enElTexto = (fila.content ?? "").toLowerCase().includes(q.toLowerCase());
    const texto = enElTexto ? fila.content ?? "" : fila.transcripcion ?? fila.content ?? "";
    const contacto = fila.conversation.contact;
    const nombre = contacto.name?.trim() || contacto.phoneNumber;
    return {
      id: fila.id,
      chatKey: `agent:${fila.conversationId}`,
      nombre: tapar ? enmascararSiEsTelefono(nombre) : nombre,
      telefono: tapar ? enmascararTelefono(contacto.phoneNumber) : contacto.phoneNumber,
      avatarUrl: contacto.avatarUrl ?? null,
      fragmento: fragmentoAlrededor(texto, q),
      // Si lo encontrado estaba en lo que se dijo en un audio, la fila lo dice.
      esDeUnAudio: !enElTexto && fila.type === "AUDIO",
      deQuien: fila.direction === "INBOUND" ? ("cliente" as const) : ("nosotros" as const),
      createdAt: fila.createdAt.toISOString(),
    };
  });

  return NextResponse.json({ ok: true, mensajes });
}
