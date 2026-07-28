import type { Metadata } from "next";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import {
  getLlamadasVendedoraData,
  getLlamadasOwnerData,
} from "@/features/llamadas/services/getLlamadasData";
import { getResumenDiaData } from "@/features/llamadas/services/getResumenDia";
import { LlamadasWorkspace } from "@/features/llamadas/components/LlamadasWorkspace";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ClienteLlamadasPage() {
  const access = await requireClientWorkspaceAccess("llamadas");
  const canSeeOwner = access.isOwner || access.role === "ADMIN";

  // El resumen es de QUIEN abre la pantalla: cada asesora ve y manda el suyo.
  const currentUser = await prisma.user.findUnique({
    where: { id: access.userId },
    select: { name: true, email: true },
  });
  const advisorName = currentUser?.name?.trim() || currentUser?.email || "Asesora";

  const [vendedora, owner, resumen] = await Promise.all([
    getLlamadasVendedoraData(access.workspaceId),
    canSeeOwner ? getLlamadasOwnerData(access.workspaceId) : Promise.resolve(null),
    getResumenDiaData({ workspaceId: access.workspaceId, userId: access.userId, advisorName }),
  ]);

  return (
    <LlamadasWorkspace vendedora={vendedora} owner={owner} canSeeOwner={canSeeOwner} resumen={resumen} />
  );
}
