import type { Metadata } from "next";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { DiagramasLista } from "@/features/diagramas/components/DiagramasLista";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ClienteDiagramasPage() {
  const access = await requireClientWorkspaceAccess("diagramas");

  /**
   * Solo los MÍOS. Un mapa mental a medio pensar no es un documento del equipo, y encontrarse el
   * borrador de otro en la lista es la forma más rápida de que nadie vuelva a escribir nada
   * honesto acá.
   */
  const diagramas = await prisma.diagram
    .findMany({
      where: { workspaceId: access.workspaceId, createdById: access.userId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, updatedAt: true, data: true },
    })
    .catch(() => []);

  return (
    <DiagramasLista
      diagramas={diagramas.map((diagrama) => ({
        id: diagrama.id,
        titulo: diagrama.title,
        actualizado: diagrama.updatedAt.toISOString(),
        // Cuántas ideas tiene, para reconocerlo sin abrirlo.
        ideas: contarIdeas(diagrama.data),
      }))}
    />
  );
}

function contarIdeas(data: unknown): number {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return 0;
  }
  const nodos = (data as { nodes?: unknown }).nodes;
  return Array.isArray(nodos) ? nodos.length : 0;
}
