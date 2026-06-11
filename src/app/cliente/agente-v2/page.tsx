import { AgentV2Workspace } from "@/features/agents-v2/components/AgentV2Workspace";
import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";
import { canAccessOfficialApiModule } from "@/lib/admin-module-access";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";

export default async function ClienteAgenteV2Page() {
  const access = await requireClientWorkspaceAccess("agents_v2");
  const canUseOfficialApi = await canAccessOfficialApiModule(access.userId, access.role);

  const [products, flowItems, workspace, channels] = await Promise.all([
    prisma.product.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    getCreatedFlowItems({
      workspaceId: access.workspaceId,
      includeOfficialApi: canUseOfficialApi,
    }),
    prisma.workspace.findUnique({
      where: { id: access.workspaceId },
      select: { name: true, businessConfig: true },
    }),
    prisma.whatsAppChannel.findMany({
      where: { workspaceId: access.workspaceId },
      select: { id: true, name: true, phoneNumber: true, provider: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const flows = flowItems.map((flow) => ({ id: flow.id, name: flow.title }));

  const cfg =
    workspace?.businessConfig && typeof workspace.businessConfig === "object"
      ? (workspace.businessConfig as Record<string, unknown>)
      : {};
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  const business = {
    name: workspace?.name ?? "",
    sector: str(cfg.sectorRubro),
    location: str(cfg.location),
    website: str(cfg.website),
    phone: str(cfg.contactPhone),
    email: str(cfg.contactEmail),
    instagram: str(cfg.instagram),
    facebook: str(cfg.facebook),
    tiktok: str(cfg.tiktok),
    youtube: str(cfg.youtube),
  };

  const connections = channels.map((channel) => ({
    id: channel.id,
    label: [channel.name, channel.phoneNumber].filter(Boolean).join(" · ") || channel.provider,
  }));

  return (
    <section className="w-full overflow-x-hidden">
      <AgentV2Workspace
        products={products}
        flows={flows}
        business={business}
        connections={connections}
      />
    </section>
  );
}
