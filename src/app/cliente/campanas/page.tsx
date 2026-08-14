import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CampanasWorkspace } from "@/features/campanas/components/CampanasWorkspace";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";
import { CRM_STAGE_META, CRM_STAGE_ORDER } from "@/features/crm/domain/crm-config";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CampanasPage() {
  const access = await requireClientWorkspaceAccess("campanas");

  const membership = await getPrimaryWorkspaceForUser(access.userId);
  if (!membership?.workspace.id) {
    redirect("/cliente");
  }
  const workspaceId = membership.workspace.id;

  const [campanas, canales, porEtapa] = await Promise.all([
    prisma.campaign.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        name: true,
        crmStage: true,
        content: true,
        batchSize: true,
        intervalMinutes: true,
        status: true,
        totalRecipients: true,
        sentCount: true,
        lastBatchAt: true,
        createdAt: true,
      },
    }),
    prisma.whatsAppChannel.findMany({
      where: { workspaceId, provider: "EVOLUTION", isActive: true },
      orderBy: [{ status: "desc" }, { createdAt: "desc" }],
      select: { id: true, name: true },
    }),
    // Cuantos leads hay en cada etapa, para que el tamaño del publico se vea al elegir la
    // condicion y no despues de haber creado la campaña.
    prisma.contact.groupBy({
      by: ["crmStage"],
      where: { workspaceId, excludedFromCrm: false, phoneNumber: { not: "" } },
      _count: true,
    }),
  ]);

  const conteoPorEtapa = Object.fromEntries(
    porEtapa.map((fila) => [String(fila.crmStage), fila._count]),
  );

  return (
    <CampanasWorkspace
      campanas={campanas.map((campana) => ({
        ...campana,
        content: campana.content ?? "",
        lastBatchAt: campana.lastBatchAt?.toISOString() ?? null,
        createdAt: campana.createdAt.toISOString(),
      }))}
      canales={canales}
      etapas={CRM_STAGE_ORDER.map((stage) => ({
        value: stage,
        label: CRM_STAGE_META[stage]?.label ?? stage,
        total: conteoPorEtapa[stage] ?? 0,
      }))}
    />
  );
}
