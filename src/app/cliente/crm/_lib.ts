import { redirect } from "next/navigation";
import { getCrmData, getCrmKanbanData } from "@/features/crm";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

export async function getAuthorizedCrmData() {
  const access = await requireClientWorkspaceAccess("crm");

  /**
   * El informe del jefe es el del negocio; el de una asesora, el suyo.
   *
   * Todas veian los mismos numeros globales, que no le dicen nada a una asesora sobre su propio
   * trabajo — y de paso le mostraban las ventas de las companeras.
   */
  const esJefe = access.isOwner || access.role === "ADMIN";

  const data = await getCrmData({
    workspaceId: access.workspaceId,
    workspaceName: access.workspaceName,
    assignedToUserId: esJefe ? null : access.userId,
  });

  if (!data) {
    redirect("/cliente");
  }

  return { ...data, esInformePersonal: !esJefe };
}

export async function getAuthorizedCrmKanbanData() {
  const access = await requireClientWorkspaceAccess("crm");

  const data = await getCrmKanbanData({
    workspaceId: access.workspaceId,
    workspaceName: access.workspaceName,
  });

  if (!data) {
    redirect("/cliente");
  }

  return data;
}
