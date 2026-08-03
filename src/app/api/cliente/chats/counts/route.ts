import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

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
}): Prisma.ConversationWhereInput {
  const normalizedSearchQuery = input.searchQuery.trim();

  return {
    workspaceId: input.workspaceId,
    AND: [
      buildStatusWhere(input.statusFilter),
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
  const baseWhere = buildBaseWhere({
    workspaceId: membership.workspace.id,
    searchQuery,
    selectedConnectionKey,
    statusFilter,
  });

  const [officialMine, officialUnassigned, officialAll] = await Promise.all([
    countOfficialConversations({
      workspaceId: membership.workspace.id,
      searchQuery,
      selectedConnectionKey,
      userId: session.user.id,
      assignedTo: "mine",
      statusFilter,
    }),
    countOfficialConversations({
      workspaceId: membership.workspace.id,
      searchQuery,
      selectedConnectionKey,
      userId: session.user.id,
      assignedTo: "unassigned",
      statusFilter,
    }),
    countOfficialConversations({
      workspaceId: membership.workspace.id,
      searchQuery,
      selectedConnectionKey,
      userId: session.user.id,
      assignedTo: "all",
      statusFilter,
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
