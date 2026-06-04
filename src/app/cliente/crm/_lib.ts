import { redirect } from "next/navigation";
import { getCrmData, getCrmKanbanData } from "@/features/crm";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

export async function getAuthorizedCrmData() {
  const access = await requireClientWorkspaceAccess("crm");

  const data = await getCrmData({ userId: access.userId });

  if (!data) {
    redirect("/cliente");
  }

  return data;
}

export async function getAuthorizedCrmKanbanData() {
  const access = await requireClientWorkspaceAccess("crm");

  const data = await getCrmKanbanData({ userId: access.userId });

  if (!data) {
    redirect("/cliente");
  }

  return data;
}
