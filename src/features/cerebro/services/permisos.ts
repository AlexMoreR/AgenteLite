import { prisma } from "@/lib/prisma";
import type { ClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { autorizadosDeEntrada, puedeAdministrarElCerebro, puedeVerElCerebro } from "./reglas";

/*
  CEREBRO: quién ve la pestaña. El dueño y las personas que él autorice (lista en AppSetting
  `cerebro:autorizados:<negocio>`, como las supervisoras: no necesita tabla).
*/

const claveDeAutorizados = (workspaceId: string) => `cerebro:autorizados:${workspaceId}`;

export async function autorizadosDelCerebro(workspaceId: string): Promise<string[]> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveDeAutorizados(workspaceId) }, select: { value: true } });
  return autorizadosDeEntrada(fila?.value);
}

export async function guardarAutorizadosDelCerebro(workspaceId: string, userIds: string[]) {
  const limpios = [...new Set(userIds.filter(Boolean))];
  // Solo personas que son miembros activos del negocio.
  const miembros = await prisma.workspaceMember.findMany({
    where: { workspaceId, isActive: true, userId: { in: limpios } },
    select: { userId: true },
  });
  const validos = miembros.map((miembro) => miembro.userId);
  await prisma.appSetting.upsert({
    where: { key: claveDeAutorizados(workspaceId) },
    create: { key: claveDeAutorizados(workspaceId), value: JSON.stringify(validos) },
    update: { value: JSON.stringify(validos) },
  });
  return validos;
}

/** Lo que esta persona puede hacer con el cerebro de su negocio. */
export async function permisosDelCerebro(access: Pick<ClientWorkspaceAccess, "userId" | "workspaceId" | "isOwner"> & { membershipRole: string | null }) {
  const autorizados = await autorizadosDelCerebro(access.workspaceId);
  const acceso = { userId: access.userId, isOwner: access.isOwner, membershipRole: access.membershipRole };
  return {
    ver: puedeVerElCerebro(acceso, autorizados),
    administrar: puedeAdministrarElCerebro(acceso),
    autorizados,
  };
}
