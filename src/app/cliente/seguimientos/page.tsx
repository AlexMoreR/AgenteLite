import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SeguimientosWorkspace } from "@/features/seguimientos/components/SeguimientosWorkspace";
import { getFollowOverview } from "@/features/seguimientos/services/follows";
import { canAccessOfficialApiModule } from "@/lib/admin-module-access";
import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

const CRM_STAGES = [
  { value: "NUEVO", label: "Nuevo", color: "#64748b" },
  { value: "CALIFICADO", label: "Calificado", color: "#3b82f6" },
  { value: "PROPUESTA", label: "Propuesta", color: "#8b5cf6" },
  { value: "NEGOCIACION", label: "Negociación", color: "#f59e0b" },
  { value: "GANADO", label: "Ganado", color: "#22c55e" },
  { value: "PERDIDO", label: "Perdido", color: "#ef4444" },
];

export default async function SeguimientosPage() {
  const access = await requireClientWorkspaceAccess("seguimientos");

  const membership = await getPrimaryWorkspaceForUser(access.userId);
  if (!membership?.workspace.id) {
    redirect("/cliente");
  }

  const canUseOfficialApi = await canAccessOfficialApiModule(access.userId, access.role);
  const [overview, channels, contacts, flows, products, tags] = await Promise.all([
    getFollowOverview({ workspaceId: membership.workspace.id }),
    prisma.whatsAppChannel.findMany({
      where: {
        workspaceId: membership.workspace.id,
        provider: "EVOLUTION",
      },
      orderBy: [{ status: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        status: true,
        evolutionInstanceName: true,
      },
    }),
    prisma.contact.findMany({
      where: {
        workspaceId: membership.workspace.id,
      },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        name: true,
        phoneNumber: true,
      },
    }),
    getCreatedFlowItems({
      workspaceId: membership.workspace.id,
      includeOfficialApi: canUseOfficialApi,
    }),
    prisma.product.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: 40,
      select: {
        id: true,
        name: true,
      },
    }),
    prisma.tag.findMany({
      where: {
        workspaceId: membership.workspace.id,
      },
      orderBy: [{ createdAt: "desc" }],
      take: 40,
      select: {
        id: true,
        name: true,
        color: true,
      },
    }),
  ]);

  return (
    <SeguimientosWorkspace
      workspaceName={membership.workspace.name}
      counts={overview.counts}
      rules={overview.rules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        sourceType: rule.sourceType,
        sourceId: rule.sourceId,
        timeType: rule.timeType,
        timeValue: rule.timeValue,
        messageType: rule.messageType,
        content: rule.content,
        mediaUrl: rule.mediaUrl,
        cancelOnActivity: rule.cancelOnActivity,
        isActive: rule.isActive,
        createdAt: rule.createdAt,
        channel: rule.channel
          ? {
              id: rule.channel.id,
              name: rule.channel.name,
              status: rule.channel.status,
              provider: rule.channel.provider,
              evolutionInstanceName: rule.channel.evolutionInstanceName,
            }
          : null,
        _count: {
          follows: rule._count.follows,
        },
      }))}
      follows={overview.follows.map((follow) => ({
        id: follow.id,
        contactId: follow.contactId,
        name: follow.name,
        timeType: follow.timeType,
        timeValue: follow.timeValue,
        executeAt: follow.executeAt,
        messageType: follow.messageType,
        content: follow.content,
        mediaUrl: follow.mediaUrl,
        status: follow.status,
        provider: follow.provider,
        cancelOnActivity: follow.cancelOnActivity,
        executionError: follow.executionError,
        executedAt: follow.executedAt,
        cancelledAt: follow.cancelledAt,
        createdAt: follow.createdAt,
        followRule: follow.followRule
          ? {
              id: follow.followRule.id,
              name: follow.followRule.name,
              sourceType: follow.followRule.sourceType,
              sourceId: follow.followRule.sourceId,
            }
          : null,
        channel: follow.channel
          ? {
              id: follow.channel.id,
              name: follow.channel.name,
              status: follow.channel.status,
              provider: follow.channel.provider,
              evolutionInstanceName: follow.channel.evolutionInstanceName,
            }
          : null,
      }))}
      channels={channels.map((channel) => ({
        value: channel.id,
        label: `${channel.name} ${channel.evolutionInstanceName ? `· ${channel.evolutionInstanceName}` : ""}`,
      }))}
    contacts={contacts.map((contact) => ({
      value: contact.id,
      label: contact.name?.trim() || contact.phoneNumber,
      phoneNumber: contact.phoneNumber,
    }))}
      sourceOptions={[
        {
          label: "Flujos",
          options: flows.map((flow) => ({
            value: flow.id,
            label: flow.title,
          })),
        },
        {
          label: "Productos",
          options: products.map((product) => ({
            value: product.id,
            label: product.name,
          })),
        },
        {
          label: "Tags",
          options: tags.map((tag) => ({
            value: tag.id,
            label: tag.name,
            color: tag.color,
          })),
        },
      ]}
      crmStages={CRM_STAGES}
    />
  );
}
