import type { Metadata } from "next";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import {
  getLlamadasVendedoraData,
  getLlamadasOwnerData,
} from "@/features/llamadas/services/getLlamadasData";
import { getResumenDiaData } from "@/features/llamadas/services/getResumenDia";
import { LlamadasWorkspace } from "@/features/llamadas/components/LlamadasWorkspace";
import { prisma } from "@/lib/prisma";
import { buildWaCallsDialerUrl } from "@/lib/wacalls";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClienteLlamadasPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("llamadas");
  const canSeeOwner = access.isOwner || access.role === "ADMIN";

  /**
   * El marcador se abre con el número puesto cuando se llega desde el botón "Llamar" de un lead
   * (?tab=marcador&to=...). Es lo que evita que la asesora copie el número a mano.
   */
  const params = await searchParams;
  const telefono = typeof params.to === "string" ? params.to : "";
  const marcadorUrl = buildWaCallsDialerUrl(telefono);
  const pestanaInicial = params.tab === "marcador" && marcadorUrl ? "marcador" : "vendedora";

  // El resumen es de QUIEN abre la pantalla: cada asesora ve y manda el suyo.
  const currentUser = await prisma.user.findUnique({
    where: { id: access.userId },
    select: { name: true, email: true },
  });
  const advisorName = currentUser?.name?.trim() || currentUser?.email || "Asesora";

  const [vendedora, owner, resumen] = await Promise.all([
    getLlamadasVendedoraData(access.workspaceId, access.userId),
    canSeeOwner ? getLlamadasOwnerData(access.workspaceId) : Promise.resolve(null),
    getResumenDiaData({ workspaceId: access.workspaceId, userId: access.userId, advisorName }),
  ]);

  return (
    <LlamadasWorkspace
      vendedora={vendedora}
      owner={owner}
      canSeeOwner={canSeeOwner}
      resumen={resumen}
      marcadorUrl={marcadorUrl}
      pestanaInicial={pestanaInicial}
    />
  );
}
