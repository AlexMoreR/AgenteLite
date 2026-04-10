import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { WhatsAppBusinessWorkspace, getWhatsAppBusinessConnections } from "@/features/conexion";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function ClienteConexionWhatsAppBusinessPage() {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/conexion?error=Debes+crear+tu+negocio+primero");
  }

  const data = await getWhatsAppBusinessConnections(membership.workspace.id);

  return <WhatsAppBusinessWorkspace summary={data.summary} items={data.items} />;
}
