import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { WhatsAppBusinessConnectionWorkspace, getWhatsAppBusinessConnectionDetail } from "@/features/conexion";
import { getPublicBaseUrl } from "@/lib/app-url";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { readGatewayConnection } from "@/lib/evolution";
import { getEvolutionGateways, getOfficialApiProviderSettings } from "@/lib/system-settings";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

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
  const okMessage = typeof paramsData.ok === "string" ? paramsData.ok : "";
  const errorMessage = typeof paramsData.error === "string" ? paramsData.error : "";

  // El detalle depende de llamadas a Evolution (estado/QR/perfil). Lo cargamos dentro
  // de un Suspense para que la pantalla abra al instante con un skeleton y el contenido
  // haga streaming en cuanto Evolution responda.
  return (
    <Suspense fallback={<ConnectionDetailSkeleton />}>
      <ConnectionDetailContent
        workspaceId={membership.workspace.id}
        agentId={agentId}
        okMessage={okMessage}
        errorMessage={errorMessage}
      />
    </Suspense>
  );
}

async function ConnectionDetailContent({
  workspaceId,
  agentId,
  okMessage,
  errorMessage,
}: {
  workspaceId: string;
  agentId: string;
  okMessage: string;
  errorMessage: string;
}) {
  const detail = await getWhatsAppBusinessConnectionDetail(workspaceId, agentId);
  const [availableAgents, workspaceMembers, providerSettings, evolutionGateways] = await Promise.all([
    prisma.agent.findMany({
      where: {
        workspaceId,
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
      where: { workspaceId, isActive: true },
      select: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    getOfficialApiProviderSettings(),
    getEvolutionGateways(),
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

  const webhookCallbackUrl = `${getPublicBaseUrl()}/api/webhooks/meta/official-api`;

  // "Conectar Evolution API" sirve para MIGRAR un canal de evogo a Evolution API. Si el
  // canal ya esta en Evolution API no aplica: ofrecerlo solo confunde y regeneraria un QR
  // sin motivo.
  const isChannelAlreadyEvolutionApi = readGatewayConnection(detail.channel?.metadata)?.kind === "EVOLUTION_API";

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
      canConnectEvolutionApi={!isChannelAlreadyEvolutionApi}
      evolutionApiGateways={evolutionGateways
        .filter((gateway) => gateway.kind === "EVOLUTION_API")
        .map((gateway) => ({ id: gateway.id, baseUrl: gateway.baseUrl }))}
    />
  );
}

function ConnectionDetailSkeleton() {
  return (
    <section className="space-y-5 p-6">
      <Card>
        <CardContent className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-2.5">
            <Skeleton className="size-10 rounded-md" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
          <Skeleton className="h-8 w-28 rounded-lg" />
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-40 w-full rounded-lg" />
            <Skeleton className="h-3 w-3/4" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-2/3 rounded-lg" />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
