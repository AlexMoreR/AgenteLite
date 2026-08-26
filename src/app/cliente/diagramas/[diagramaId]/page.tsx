import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import {
  DiagramaCanvas,
  type DiagramaGuardado,
} from "@/features/diagramas/components/DiagramaCanvas";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ diagramaId: string }>;
};

export default async function ClienteDiagramaPage({ params }: PageProps) {
  const access = await requireClientWorkspaceAccess("diagramas");
  const { diagramaId } = await params;

  // Se busca por AUTOR además de por negocio: con solo el id, un enlace prestado abriría el mapa
  // de otra persona.
  const diagrama = await prisma.diagram.findFirst({
    where: {
      id: diagramaId,
      workspaceId: access.workspaceId,
      createdById: access.userId,
    },
    select: { id: true, title: true, data: true },
  });

  if (!diagrama) {
    notFound();
  }

  return (
    <DiagramaCanvas
      id={diagrama.id}
      tituloInicial={diagrama.title}
      contenidoInicial={(diagrama.data as DiagramaGuardado | null) ?? null}
    />
  );
}
