import { redirect } from "next/navigation";
import type { Role, WorkspaceMemberRole } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { cacheDeAcceso } from "@/lib/cache-de-permisos";
import {
  clientAssignableModuleKeys,
  sanitizeClientModuleAccess,
  type ClientAssignableModuleKey,
} from "@/lib/client-workspace-modules";

type ClientWorkspaceModuleKey = ClientAssignableModuleKey | "client_team";

export type ClientWorkspaceAccess = {
  userId: string;
  role: Role;
  workspaceId: string;
  workspaceName: string;
  workspaceOwnerId: string | null;
  membershipRole: WorkspaceMemberRole;
  moduleAccess: ClientAssignableModuleKey[];
  isOwner: boolean;
  isEmployee: boolean;
};

export function canAccessClientModule(
  access: Pick<ClientWorkspaceAccess, "isOwner" | "role" | "moduleAccess">,
  moduleKey: ClientWorkspaceModuleKey,
) {
  if (moduleKey === "client_team") {
    return access.isOwner || access.role === "ADMIN";
  }

  if (access.isOwner || access.role === "ADMIN") {
    return true;
  }

  return access.moduleAccess.includes(moduleKey);
}

export function getVisibleClientModuleAccess(access: ClientWorkspaceAccess | null) {
  return Object.fromEntries(
    clientAssignableModuleKeys.map((key) => [key, access ? canAccessClientModule(access, key) : false]),
  ) as Record<ClientAssignableModuleKey, boolean>;
}

export async function getClientWorkspaceAccessForUser(userId: string): Promise<ClientWorkspaceAccess | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      workspaceMemberships: {
        orderBy: { createdAt: "asc" },
        take: 1,
        where: { isActive: true },
        select: {
          role: true,
          moduleAccess: true,
          workspace: {
            select: {
              id: true,
              name: true,
              ownerId: true,
            },
          },
        },
      },
    },
  });

  const membership = user?.workspaceMemberships[0];
  if (!user || !membership?.workspace.id) {
    return null;
  }

  const isOwner =
    user.role === "CLIENTE" &&
    (membership.role === "OWNER" || membership.workspace.ownerId === user.id);

  return {
    userId: user.id,
    role: user.role,
    workspaceId: membership.workspace.id,
    workspaceName: membership.workspace.name,
    workspaceOwnerId: membership.workspace.ownerId,
    membershipRole: membership.role,
    moduleAccess: sanitizeClientModuleAccess(membership.moduleAccess),
    isOwner,
    isEmployee: user.role === "EMPLEADO",
  };
}

/**
 * Lo mismo que `getClientWorkspaceAccessForUser`, con la cache del proceso (45 s).
 *
 * Para las rutas de Chats que se piden varias veces por minuto (list, counts, live, summary). Las
 * pantallas siguen con la version sin cache. Se vacia sola con cualquier escritura de usuarios,
 * miembros o negocios (ver cache-de-permisos.ts).
 *
 * Trae tambien lo que antes se volvia a leer con `getPrimaryWorkspaceForUser`: es la MISMA
 * membresia (la primera activa por fecha de alta), asi que `workspaceId` y `membershipRole` son
 * los mismos que daba `membership.workspace.id` y `membership.role`.
 */
export function getClientWorkspaceAccessForUserCached(userId: string): Promise<ClientWorkspaceAccess | null> {
  return cacheDeAcceso.obtener(userId, () => getClientWorkspaceAccessForUser(userId));
}

export async function requireClientWorkspaceAccess(
  moduleKey?: ClientWorkspaceModuleKey,
  options: { ownerOnly?: boolean; redirectTo?: string } = {},
): Promise<ClientWorkspaceAccess> {
  const session = await auth();
  const fallback = options.redirectTo ?? "/unauthorized";

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    redirect(fallback);
  }

  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access) {
    redirect(fallback);
  }

  if (options.ownerOnly && !access.isOwner && access.role !== "ADMIN") {
    redirect(fallback);
  }

  if (moduleKey && !canAccessClientModule(access, moduleKey)) {
    redirect(fallback);
  }

  return access;
}
