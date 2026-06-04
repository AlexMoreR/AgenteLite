import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getFinanzasData } from "@/features/finanzas/services/getFinanzasData";
import { FinanzasWorkspace } from "@/features/finanzas/components/FinanzasWorkspace";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

export const metadata: Metadata = { title: "Asistente de Finanzas" };

export default async function FinanzasAssistantPage() {
  const access = await requireClientWorkspaceAccess("finanzas");

  const data = await getFinanzasData(access.userId);
  if (!data) redirect("/cliente");

  const workspaceKey = [data.workspaceId, data.currency, data.googleSheet?.id ?? "no-sheet"].join("|");

  return <FinanzasWorkspace key={workspaceKey} {...data} />;
}
