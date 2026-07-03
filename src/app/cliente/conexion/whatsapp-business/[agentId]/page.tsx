import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { WhatsAppBusinessConnectionWorkspace, getWhatsAppBusinessConnectionDetail } from "@/features/conexion";
import { getPublicBaseUrl } from "@/lib/app-url";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getOfficialApiProviderSettings } from "@/lib/system-settings";
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
  const access = await requireClientWorkspaceAccess("connection");

  const membership = await getPrimaryWorkspaceForUser(access.userId);
  if (!membership) {
    redirect("/cliente/conexion?error=Debes+crear+tu+negocio+primero");
  }

  const [{ agentId }, paramsData] = await Promise.all([params, searchParams]);
  const detail = await getWhatsAppBusinessConnectionDetail(membership.workspace.id, agentId);
  const [availableAgents, workspaceMembers, providerSettings] = await Promise.all([
    prisma.agent.findMany({
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
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId: membership.workspace.id, isActive: true },
      select: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    getOfficialApiProviderSettings(),
  ]);

  if (!detail) {
    redirect("/cliente/conexion?error=Canal+no+encontrado");
  }

  // Colaboradores guardados en metadata del canal.
  const channelMetadata =
    detail.channel?.metadata && typeof detail.channel.metadata === "object" && !Array.isArray(detail.channel.metadata)
      ? (detail.channel.metadata as Record<string, unknown>)
      : {};
  const collaboratorIds = Array.isArray(channelMetadata.collaboratorIds)
    ? (channelMetadata.collaboratorIds as unknown[]).filter((id): id is string => typeof id === "string")
    : [];
  const collaboratorMembers = workspaceMembers.map((member) => ({
    id: member.user.id,
    name: member.user.name,
    email: member.user.email,
  }));

  const okMessage = typeof paramsData.ok === "string" ? paramsData.ok : "";
  const errorMessage = typeof paramsData.error === "string" ? paramsData.error : "";
  const webhookCallbackUrl = `${getPublicBaseUrl()}/api/webhooks/meta/official-api`;

  return (
    <WhatsAppBusinessConnectionWorkspace
      connection={detail.connection}
      isConnected={detail.isConnected}
      qrDataUrl={detail.qrDataUrl}
      pairingCode={detail.pairingCode}
      hasQrCode={detail.hasQrCode}
      channelStatus={detail.channel?.status}
      officialApiConfig={detail.officialApiConfig}
      officialApiProviderAppId={providerSettings.appId}
      officialApiProviderAppSecret={providerSettings.appSecret}
      officialApiWebhookCallbackUrl={webhookCallbackUrl}
      okMessage={okMessage}
      errorMessage={errorMessage}
      availableAgents={availableAgents}
      collaboratorMembers={collaboratorMembers}
      collaboratorIds={collaboratorIds}
    />
  );
}
