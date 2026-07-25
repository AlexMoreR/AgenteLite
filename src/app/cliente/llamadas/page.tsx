import type { Metadata } from "next";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import {
  getLlamadasVendedoraData,
  getLlamadasOwnerData,
} from "@/features/llamadas/services/getLlamadasData";
import { LlamadasWorkspace } from "@/features/llamadas/components/LlamadasWorkspace";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ClienteLlamadasPage() {
  const access = await requireClientWorkspaceAccess("llamadas");
  const canSeeOwner = access.isOwner || access.role === "ADMIN";

  const [vendedora, owner] = await Promise.all([
    getLlamadasVendedoraData(access.workspaceId),
    canSeeOwner ? getLlamadasOwnerData(access.workspaceId) : Promise.resolve(null),
  ]);

  return <LlamadasWorkspace vendedora={vendedora} owner={owner} canSeeOwner={canSeeOwner} />;
}
