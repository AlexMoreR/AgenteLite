import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { WhatsAppBusinessConnectionWorkspace, getWhatsAppBusinessConnectionDetail } from "@/features/conexion";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type PageProps = {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClienteConexionWhatsAppBusinessDetailPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/conexion?error=Debes+crear+tu+negocio+primero");
  }

  const [{ agentId }, paramsData] = await Promise.all([params, searchParams]);
  const detail = await getWhatsAppBusinessConnectionDetail(membership.workspace.id, agentId);
  const availableAgents = await prisma.agent.findMany({
    where: {
      workspaceId: membership.workspace.id,
      status: {
        not: "ARCHIVED",
      },
    },
    orderBy: {
      name: "asc",
    },
    select: {
      id: true,
      name: true,
      status: true,
    },
  });

  if (!detail) {
    redirect("/cliente/conexion?error=Canal+no+encontrado");
  }

  const okMessage = typeof paramsData.ok === "string" ? paramsData.ok : "";
  const errorMessage = typeof paramsData.error === "string" ? paramsData.error : "";

  return (
    <WhatsAppBusinessConnectionWorkspace
      connection={detail.connection}
      isConnected={detail.isConnected}
      qrDataUrl={detail.qrDataUrl}
      pairingCode={detail.pairingCode}
      hasQrCode={detail.hasQrCode}
      channelStatus={detail.channel?.status}
      okMessage={okMessage}
      errorMessage={errorMessage}
      availableAgents={availableAgents}
    />
  );
}
