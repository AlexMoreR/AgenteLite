import type { Metadata } from "next";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";
import { LlamadasWorkspace } from "@/features/llamadas/components/LlamadasWorkspace";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClienteLlamadasPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("llamadas");
  const canSeeOwner = await puedeSupervisar(access);

  /**
   * El marcador se abre con el número puesto cuando se llega desde el botón "Llamar" de un lead
   * (?tab=marcador&to=...). Es lo que evita que la asesora copie el número a mano.
   */
  await searchParams;

  /*
    El filtro por asesora es de quien supervisa. A una asesora se le manda la lista vacia: no lo ve,
    y la accion igual le devuelve solo sus llamadas.
  */
  const miembros = canSeeOwner
    ? await prisma.workspaceMember.findMany({
        where: { workspaceId: access.workspaceId, isActive: true },
        select: { userId: true, user: { select: { name: true, email: true } } },
      })
    : [];
  const asesoras = miembros
    .map((miembro) => ({
      id: miembro.userId,
      nombre: miembro.user?.name?.trim() || miembro.user?.email || "Sin nombre",
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return (
    <LlamadasWorkspace asesoras={asesoras} />
  );
}
