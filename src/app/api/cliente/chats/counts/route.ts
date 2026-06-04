import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function buildBaseWhere(input: {
  workspaceId: string;
  searchQuery: string;
  selectedConnectionKey: string;
}): Prisma.ConversationWhereInput {
  const normalizedSearchQuery = input.searchQuery.trim();

  return {
    workspaceId: input.workspaceId,
    AND: [
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

  const isManager = membership.role === "OWNER" || membership.role === "ADMIN";
  const baseWhere = buildBaseWhere({
    workspaceId: membership.workspace.id,
    searchQuery,
    selectedConnectionKey,
  });

  // Los empleados solo cuentan sus chats asignados.
  if (!isManager) {
    const mine = await prisma.conversation.count({
      where: { AND: [baseWhere, { assignedToUserId: session.user.id }] },
    });

    return NextResponse.json({
      ok: true,
      isManager,
      counts: { mine, unassigned: 0, all: mine },
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
    counts: { mine, unassigned, all },
  });
}
