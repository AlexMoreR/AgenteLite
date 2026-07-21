import type { Metadata } from "next";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getMiDiaData } from "@/features/crm/services/getMiDiaData";
import { MiDiaView } from "@/features/crm/components/MiDiaView";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

export default async function ClienteCrmMiDiaPage() {
  const access = await requireClientWorkspaceAccess("crm");
  const data = await getMiDiaData({ workspaceId: access.workspaceId });

  return <MiDiaView data={data} />;
}
