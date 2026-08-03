import type { Metadata } from "next";
import { MiTableroView } from "@/features/crm/components/MiTableroView";
import { diaDeHoyBogota, getMiTableroData } from "@/features/crm/services/getMiTableroData";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MiTableroPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("crm");
  const params = await searchParams;

  const esJefe = access.isOwner || access.role === "ADMIN";
  const pedido = typeof params.userId === "string" ? params.userId.trim() : "";
  const dia = typeof params.dia === "string" ? params.dia.trim() : "";

  /**
   * Solo el jefe puede mirar el tablero de OTRA persona.
   *
   * Sin este control alcanzaria con cambiar el id en la direccion para ver los numeros de una
   * companera. Se valida ademas que sea del mismo negocio: un id de otra empresa no abre nada.
   */
  let userId = access.userId;
  if (esJefe && pedido && pedido !== access.userId) {
    const miembro = await prisma.workspaceMember.findFirst({
      where: { workspaceId: access.workspaceId, userId: pedido, isActive: true },
      select: { userId: true },
    });
    if (miembro) {
      userId = miembro.userId;
    }
  }

  const usuario = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  const data = await getMiTableroData({
    workspaceId: access.workspaceId,
    userId,
    advisorName: usuario?.name?.trim() || usuario?.email || "Asesora",
    dia: dia || diaDeHoyBogota(),
  });

  return (
    <section className="p-4 md:p-6">
      <MiTableroView data={data} esDeOtraPersona={userId !== access.userId} />
    </section>
  );
}
