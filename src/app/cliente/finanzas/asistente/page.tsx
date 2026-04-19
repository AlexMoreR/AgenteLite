import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { getFinanzasData } from "@/features/finanzas/services/getFinanzasData";
import { FinanzasWorkspace } from "@/features/finanzas/components/FinanzasWorkspace";

export const metadata: Metadata = { title: "Asistente de Finanzas" };

export default async function FinanzasAssistantPage() {
  const session = await auth();
  if (!session?.user?.id || !["ADMIN", "CLIENTE"].includes(session.user.role ?? "")) {
    redirect("/unauthorized");
  }

  const data = await getFinanzasData(session.user.id);
  if (!data) redirect("/cliente");

  const workspaceKey = [
    data.currency,
    data.googleSheet?.id ?? "no-sheet",
    ...data.transactions.map((transaction) => `${transaction.id}:${transaction.date}:${transaction.amount}`),
  ].join("|");

  return <FinanzasWorkspace key={workspaceKey} {...data} />;
}
