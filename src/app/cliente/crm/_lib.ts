import { redirect } from "next/navigation";
import { getCrmData, getCrmKanbanData } from "@/features/crm";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

export async function getAuthorizedCrmData() {
  const access = await requireClientWorkspaceAccess("crm");

  const data = await getCrmData({
    workspaceId: access.workspaceId,
    workspaceName: access.workspaceName,
  });

  if (!data) {
    redirect("/cliente");
  }

  return data;
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
