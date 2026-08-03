import type { Metadata } from "next";
import { MiTableroView } from "@/features/crm/components/MiTableroView";
import { getMiTableroData } from "@/features/crm/services/getMiTableroData";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function MiTableroPage() {
  const access = await requireClientWorkspaceAccess("crm");

  const usuario = await prisma.user.findUnique({
    where: { id: access.userId },
    select: { name: true, email: true },
  });

  const data = await getMiTableroData({
    workspaceId: access.workspaceId,
    userId: access.userId,
    advisorName: usuario?.name?.trim() || usuario?.email || "Asesora",
  });

  return (
    <section className="p-4 md:p-6">
      <MiTableroView data={data} />
    </section>
  );
}
