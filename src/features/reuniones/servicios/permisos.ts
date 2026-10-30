import { canAccessClientModule, getClientWorkspaceAccessForUser, type ClientWorkspaceAccess } from "@/lib/client-workspace-access";

/*
  QUIÉN PUEDE QUÉ en Reuniones.

  - Ver la sección y crear reuniones: el dueño, los administradores y quien tenga el módulo
    "Reuniones" en la pantalla de permisos (canAccessClientModule). Lo mismo para «Iniciar reunión»
    en el link fijo de una sala, siempre que la sala sea de su negocio.
  - "Terminar reunión" en la sala: quien la creó, el dueño del negocio, los administradores y, en una
    sala fija, su líder. Un invitado nunca: su pase no trae permiso de administrar la sala.
  - Crear y editar salas fijas: solo el dueño o un administrador.
*/

export const esDuenoOAdmin = (access: ClientWorkspaceAccess) => access.isOwner || access.role === "ADMIN";

export function puedeVerReuniones(access: ClientWorkspaceAccess | null): access is ClientWorkspaceAccess {
  return Boolean(access && canAccessClientModule(access, "reuniones"));
}

/** «Iniciar reunión» en el link fijo de una sala: tiene el módulo Reuniones en el negocio de esa sala. */
export function puedeIniciarLaSala(access: ClientWorkspaceAccess | null, sala: { workspaceId: string }): access is ClientWorkspaceAccess {
  return puedeVerReuniones(access) && access.workspaceId === sala.workspaceId;
}

export async function puedeTerminarLaReunion(
  userId: string,
  reunion: { workspaceId: string; creadaPorId: string | null; salaFija?: { liderId: string | null } | null },
) {
  const access = await getClientWorkspaceAccessForUser(userId);
  if (!access || access.workspaceId !== reunion.workspaceId) {
    return false;
  }
  return reunion.creadaPorId === userId || reunion.salaFija?.liderId === userId || esDuenoOAdmin(access);
}

export async function puedeAdministrarSalas(userId: string, workspaceId: string) {
  const access = await getClientWorkspaceAccessForUser(userId);
  return Boolean(access && access.workspaceId === workspaceId && esDuenoOAdmin(access));
}
