import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getFinanzasData } from "@/features/finanzas/services/getFinanzasData";
import { FinanzasEntryWorkspace } from "@/features/finanzas/components/FinanzasEntryWorkspace";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

export const metadata: Metadata = { title: "Finanzas" };

export default async function FinanzasPage() {
  const access = await requireClientWorkspaceAccess("finanzas");

  const data = await getFinanzasData(access.userId);
  if (!data) redirect("/cliente");

  return <FinanzasEntryWorkspace />;
}
