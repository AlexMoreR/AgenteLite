import { canAccessClientModule, getClientWorkspaceAccessForUser, type ClientWorkspaceAccess } from "@/lib/client-workspace-access";

/*
  QUIÉN PUEDE QUÉ en Reuniones.

  - Ver la sección y crear reuniones: el dueño, los administradores y quien tenga el módulo
    "Reuniones" en la pantalla de permisos (canAccessClientModule).
  - "Terminar reunión" en la sala: quien la creó, el dueño del negocio y los administradores.
    Un invitado nunca: su pase no trae permiso de administrar la sala.
*/

export const esDuenoOAdmin = (access: ClientWorkspaceAccess) => access.isOwner || access.role === "ADMIN";

export function puedeVerReuniones(access: ClientWorkspaceAccess | null): access is ClientWorkspaceAccess {
  return Boolean(access && canAccessClientModule(access, "reuniones"));
}

export async function puedeTerminarLaReunion(userId: string, reunion: { workspaceId: string; creadaPorId: string | null }) {
  const access = await getClientWorkspaceAccessForUser(userId);
  if (!access || access.workspaceId !== reunion.workspaceId) {
    return false;
  }
  return reunion.creadaPorId === userId || esDuenoOAdmin(access);
}
