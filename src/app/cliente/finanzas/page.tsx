import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { getFinanzasData } from "@/features/finanzas/services/getFinanzasData";
import { FinanzasWorkspace } from "@/features/finanzas/components/FinanzasWorkspace";

export const metadata: Metadata = { title: "Finanzas" };

export default async function FinanzasPage() {
  const session = await auth();
  if (
    !session?.user?.id ||
    !["ADMIN", "CLIENTE"].includes(session.user.role ?? "")
  ) {
    redirect("/unauthorized");
  }

  const data = await getFinanzasData(session.user.id);
  if (!data) redirect("/cliente");

  return <FinanzasWorkspace {...data} />;
}
