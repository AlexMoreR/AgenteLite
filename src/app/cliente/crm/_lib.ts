import { redirect } from "next/navigation";
import { getCrmData, getCrmKanbanData } from "@/features/crm";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";

export type AsesoraDelFiltro = { id: string; nombre: string };

/**
 * Quien esta mirando el CRM y de quien.
 *
 * Una asesora ve SOLO lo suyo y no puede cambiarlo: los numeros globales no le dicen nada sobre
 * su propio trabajo, y de paso le mostraban las ventas de las compañeras.
 *
 * El jefe ve todo por defecto y puede elegir una asesora con `?userId=`. Ese id se valida contra
 * los miembros del negocio: sin eso alcanzaria con cambiarlo en la direccion para ver los datos
 * de otra empresa.
 */
async function resolverMirada(pedido: string) {
  const access = await requireClientWorkspaceAccess("crm");
  const esJefe = access.isOwner || access.role === "ADMIN";

  if (!esJefe) {
    return { access, esJefe, verComoUserId: access.userId, asesoras: [] as AsesoraDelFiltro[] };
  }

  const miembros = await prisma.workspaceMember.findMany({
    where: { workspaceId: access.workspaceId, isActive: true },
    select: { userId: true, user: { select: { name: true, email: true } } },
  });

  const asesoras: AsesoraDelFiltro[] = miembros
    .map((miembro) => ({
      id: miembro.userId,
      nombre: miembro.user?.name?.trim() || miembro.user?.email || "Sin nombre",
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  // Vacio = todo el equipo. Un id que no sea del negocio se ignora y se cae a "todo".
  const elegida = pedido && asesoras.some((asesora) => asesora.id === pedido) ? pedido : null;

  return { access, esJefe, verComoUserId: elegida, asesoras };
}

export async function getAuthorizedCrmData(pedido = "") {
  const { access, esJefe, verComoUserId, asesoras } = await resolverMirada(pedido);

  const data = await getCrmData({
    workspaceId: access.workspaceId,
    workspaceName: access.workspaceName,
    assignedToUserId: verComoUserId,
  });

  if (!data) {
    redirect("/cliente");
  }

  return {
    ...data,
    esInformePersonal: !esJefe,
    // El selector solo existe para el jefe: la asesora no elige, ve lo suyo.
    asesoras: esJefe ? asesoras : [],
    asesoraElegida: esJefe ? (verComoUserId ?? "") : "",
  };
}

export async function getAuthorizedCrmKanbanData(pedido = "") {
  const { access, esJefe, verComoUserId, asesoras } = await resolverMirada(pedido);

  const data = await getCrmKanbanData({
    workspaceId: access.workspaceId,
    workspaceName: access.workspaceName,
    assignedToUserId: verComoUserId,
  });

  if (!data) {
    redirect("/cliente");
  }

  return {
    ...data,
    asesoras: esJefe ? asesoras : [],
    asesoraElegida: esJefe ? (verComoUserId ?? "") : "",
  };
}
