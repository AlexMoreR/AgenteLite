import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";
import { getVisibleChannelIds, resolverConexionElegida } from "@/lib/channel-visibility";
import { fragmentosDeFiltrosOficiales } from "@/features/official-api/services/getOfficialApiChatsData";
import {
  idsSinResponder,
  leerFiltrosDeBandeja,
  whereDeEtapas,
  type FiltrosDeBandeja,
} from "@/features/chats/services/filtros-de-bandeja";

export const dynamic = "force-dynamic";

type ChatsStatusFilter = "all" | "open" | "resolved";

// Los contadores tienen que contar LO MISMO que muestra la lista. Sin esto sumaban tambien las
// conversaciones resueltas: la asesora resolvia un chat y su pestaña seguia diciendo "Mias 2".
function buildStatusWhere(statusFilter: ChatsStatusFilter): Prisma.ConversationWhereInput {
  if (statusFilter === "resolved") {
    return { status: { in: ["CLOSED", "ARCHIVED"] } };
  }

  return statusFilter === "all" ? {} : { status: { in: ["OPEN", "PENDING"] } };
}

function buildBaseWhere(input: {
  workspaceId: string;
  searchQuery: string;
  selectedConnectionKey: string;
  statusFilter: ChatsStatusFilter;
  // Contactos con el lead pospuesto: no estan en la lista, asi que tampoco pueden estar en el
  // numero. Si no, la asesora pospone diez chats, la bandeja se vacia y el contador sigue igual.
  snoozedContactIds: string[];
  visibleChannelIds: string[] | null;
  filtros: FiltrosDeBandeja;
  // Las que quedaron sin responder, o null si ese filtro no esta puesto.
  sinResponder: string[] | null;
}): Prisma.ConversationWhereInput {
  const normalizedSearchQuery = input.searchQuery.trim();

  return {
    workspaceId: input.workspaceId,
    AND: [
      buildStatusWhere(input.statusFilter),
      // El numero de la pastilla tiene que contar LO MISMO que muestra la lista: si no, la asesora
      // filtra, ve 20 chats y al lado un "Todas 1956" que no le dice nada de lo que esta mirando.
      whereDeEtapas(input.filtros),
      input.sinResponder ? { id: { in: input.sinResponder } } : {},
      input.snoozedContactIds.length ? { contactId: { notIn: input.snoozedContactIds } } : {},
      input.visibleChannelIds ? { channelId: { in: input.visibleChannelIds } } : {},
      input.selectedConnectionKey.startsWith("channel:")
        ? { channelId: input.selectedConnectionKey.slice("channel:".length) }
        : {},
      normalizedSearchQuery
        ? {
            OR: [
              { contact: { name: { contains: normalizedSearchQuery, mode: "insensitive" } } },
              { contact: { phoneNumber: { contains: normalizedSearchQuery, mode: "insensitive" } } },
              { messages: { some: { content: { contains: normalizedSearchQuery, mode: "insensitive" } } } },
            ],
          }
        : {},
    ],
  };
}

/**
 * Cuenta los chats del canal de API OFICIAL, que viven en su propia tabla.
 *
 * La lista de chats SI los muestra (la arma la pagina mezclando las dos fuentes), pero los
 * contadores de arriba solo miraban Conversation: al entrar a "Ventas 1" se veian los chats
 * y al lado "Todas 0". Se cuentan igual que los muestra la lista: solo cuando el canal
 * elegido es el oficial (o no hay ninguno elegido).
 *
 * Se reparten igual que las del canal viejo: las que tienen asesora cuentan en "Mias" de esa
 * persona y las que no, en "Sin asignar".
 */
async function countOfficialConversations(input: {
  workspaceId: string;
  searchQuery: string;
  selectedConnectionKey: string;
  userId: string;
  assignedTo: "mine" | "unassigned" | "all";
  statusFilter: ChatsStatusFilter;
  filtros: FiltrosDeBandeja;
}): Promise<number> {
  if (input.selectedConnectionKey.startsWith("channel:")) {
    const channelId = input.selectedConnectionKey.slice("channel:".length);
    const channel = await prisma.whatsAppChannel.findFirst({
      where: { id: channelId, workspaceId: input.workspaceId },
      select: { provider: true },
    });
    if (channel?.provider !== "OFFICIAL_API") {
      return 0;
    }
  } else if (input.selectedConnectionKey) {
    // Hay un filtro de conexion que no es un canal: no aplica.
    return 0;
  }

  const config = await prisma.officialApiClientConfig.findFirst({
    where: { workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!config) {
    return 0;
  }

  const normalizedSearchQuery = input.searchQuery.trim();

  /**
   * Con los filtros nuevos puestos el conteo va por SQL.
   *
   * La ficha del CRM (donde vive la etapa) cuelga del contacto oficial por un id suelto, sin
   * relacion declarada, asi que Prisma no puede llegar hasta ella. Se usan los MISMOS fragmentos
   * que arma la lista: si el contador se escribiera aparte, terminarian diciendo cosas distintas.
   */
  if (input.filtros.etapas.length > 0 || input.filtros.sinResponder) {
    const { etapa, sinResponder } = fragmentosDeFiltrosOficiales(input.filtros);
    const estado =
      input.statusFilter === "resolved"
        ? Prisma.sql`AND c."status"::text IN ('CLOSED', 'ARCHIVED')`
        : input.statusFilter === "all"
          ? Prisma.empty
          : Prisma.sql`AND c."status"::text IN ('OPEN', 'PENDING')`;
    const asignacion =
      input.assignedTo === "mine"
        ? Prisma.sql`AND c."assignedToUserId" = ${input.userId}`
        : input.assignedTo === "unassigned"
          ? Prisma.sql`AND c."assignedToUserId" IS NULL`
          : Prisma.empty;

    const filas = await prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS "total"
      FROM "OfficialApiConversation" c
      WHERE c."configId" = ${config.id}
        ${estado}
        ${asignacion}
        ${etapa}
        ${sinResponder}
    `;
    return Number(filas[0]?.total ?? 0);
  }

  return prisma.officialApiConversation.count({
    where: {
      configId: config.id,
      ...(input.statusFilter === "resolved"
        ? { status: { in: ["CLOSED", "ARCHIVED"] } }
        : input.statusFilter === "all"
          ? {}
          : { status: { in: ["OPEN", "PENDING"] } }),
      ...(input.assignedTo === "mine"
        ? { assignedToUserId: input.userId }
        : input.assignedTo === "unassigned"
          ? { assignedToUserId: null }
          : {}),
      ...(normalizedSearchQuery
        ? {
            OR: [
              { contact: { name: { contains: normalizedSearchQuery, mode: "insensitive" } } },
              { contact: { waId: { contains: normalizedSearchQuery, mode: "insensitive" } } },
              { messages: { some: { content: { contains: normalizedSearchQuery, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
  });
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
  const searchQuery = requestUrl.searchParams.get("q")?.trim() || "";
  const selectedConnectionKey = requestUrl.searchParams.get("connection")?.trim() || "";
  // Mismo default que la lista y la pantalla: solo abiertas.
  const requestedStatusRaw = requestUrl.searchParams.get("status")?.trim() || "";
  const statusFilter: ChatsStatusFilter =
    requestedStatusRaw === "all" || requestedStatusRaw === "resolved" ? requestedStatusRaw : "open";

  const isManager = membership.role === "OWNER" || membership.role === "ADMIN";

  /**
   * Los contactos con el lead pospuesto, para descontarlos.
   *
   * Va con SQL directo porque la fecha vive dentro de metadata: como es un texto ISO, compararlo
   * con el ahora funciona tal cual. Son pocos, asi que la lista de ids es corta.
   */
  const snoozedRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Contact"
    WHERE "workspaceId" = ${membership.workspace.id}
      AND ("metadata"->>'snoozedUntil') > ${new Date().toISOString()}
  `;

  const visibleChannelIds = await getVisibleChannelIds({
    workspaceId: membership.workspace.id,
    userId: session.user.id,
    esJefe: isManager,
  });

  /**
   * El contador tiene que contar lo mismo que muestra la lista, incluida la conexion elegida: si
   * la lista descarta una conexion que no es de este negocio, el numero de al lado tambien.
   */
  const conexionElegida = await resolverConexionElegida({
    workspaceId: membership.workspace.id,
    connectionKey: selectedConnectionKey,
    visibleChannelIds,
  });

  const filtros = leerFiltrosDeBandeja((clave) => requestUrl.searchParams.get(clave));

  const baseWhere = buildBaseWhere({
    workspaceId: membership.workspace.id,
    searchQuery,
    selectedConnectionKey: conexionElegida,
    statusFilter,
    snoozedContactIds: snoozedRows.map((fila) => fila.id),
    visibleChannelIds,
    filtros,
    sinResponder: filtros.sinResponder
      ? await idsSinResponder({
          workspaceId: membership.workspace.id,
          visibleChannelIds,
          channelId: conexionElegida.startsWith("channel:")
            ? conexionElegida.slice("channel:".length)
            : null,
        })
      : null,
  });

  const [officialMine, officialUnassigned, officialAll] = await Promise.all([
    countOfficialConversations({
      workspaceId: membership.workspace.id,
      searchQuery,
      selectedConnectionKey: conexionElegida,
      userId: session.user.id,
      assignedTo: "mine",
      statusFilter,
      filtros,
    }),
    countOfficialConversations({
      workspaceId: membership.workspace.id,
      searchQuery,
      selectedConnectionKey: conexionElegida,
      userId: session.user.id,
      assignedTo: "unassigned",
      statusFilter,
      filtros,
    }),
    countOfficialConversations({
      workspaceId: membership.workspace.id,
      searchQuery,
      selectedConnectionKey: conexionElegida,
      userId: session.user.id,
      assignedTo: "all",
      statusFilter,
      filtros,
    }),
  ]);

  // Los empleados solo cuentan sus chats asignados.
  if (!isManager) {
    const mine = await prisma.conversation.count({
      where: { AND: [baseWhere, { assignedToUserId: session.user.id }] },
    });

    return NextResponse.json({
      ok: true,
      isManager,
      counts: { mine: mine + officialMine, unassigned: 0, all: mine + officialAll },
    });
  }

  const [mine, unassigned, all] = await Promise.all([
    prisma.conversation.count({ where: { AND: [baseWhere, { assignedToUserId: session.user.id }] } }),
    prisma.conversation.count({ where: { AND: [baseWhere, { assignedToUserId: null }] } }),
    prisma.conversation.count({ where: baseWhere }),
  ]);

  return NextResponse.json({
    ok: true,
    isManager,
    counts: {
      mine: mine + officialMine,
      unassigned: unassigned + officialUnassigned,
      all: all + officialAll,
    },
  });
}
