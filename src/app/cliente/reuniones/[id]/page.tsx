import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { DetalleDeReunion } from "@/features/reuniones/components/DetalleDeReunion";
import { normalizarActa } from "@/features/reuniones/servicios/hacer-acta";
import { linkFirmado, secretoDeLosLinks } from "@/features/reuniones/servicios/link-firmado";
import type { FraseDeReunion } from "@/features/reuniones/servicios/unir-pistas";

export const metadata: Metadata = {
  title: "Reunión",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ClienteReunionPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireClientWorkspaceAccess("reuniones");
  const { id } = await params;
  const reunion = await prisma.reunion.findFirst({
    where: { id, workspaceId: access.workspaceId },
    select: {
      id: true,
      titulo: true,
      codigo: true,
      origen: true,
      estado: true,
      aviso: true,
      motivoError: true,
      intentos: true,
      createdAt: true,
      empezoEn: true,
      terminoEn: true,
      transcripcion: true,
      acta: true,
      creadaPor: { select: { name: true, email: true } },
      participantes: { orderBy: { entroEn: "asc" }, select: { id: true, nombre: true, entroEn: true, salioEn: true } },
      pistas: {
        orderBy: { empiezaEn: "asc" },
        select: { id: true, estado: true, empiezaEn: true, terminaEn: true, participante: { select: { nombre: true } } },
      },
    },
  });
  if (!reunion) {
    notFound();
  }

  // Los audios se escuchan solo con un link firmado que vence en 1 hora.
  const secreto = secretoDeLosLinks();

  return (
    <DetalleDeReunion
      reunion={{
        id: reunion.id,
        titulo: reunion.titulo,
        codigo: reunion.codigo,
        origen: reunion.origen,
        estado: reunion.estado,
        aviso: reunion.aviso,
        motivoError: reunion.motivoError,
        creada: reunion.createdAt.toISOString(),
        empezoEn: reunion.empezoEn?.toISOString() ?? null,
        terminoEn: reunion.terminoEn?.toISOString() ?? null,
        creadaPor: reunion.creadaPor?.name?.trim() || reunion.creadaPor?.email || null,
        participantes: reunion.participantes.map((participante) => ({
          id: participante.id,
          nombre: participante.nombre,
          entroEn: participante.entroEn.toISOString(),
          salioEn: participante.salioEn?.toISOString() ?? null,
        })),
        pistas: reunion.pistas.map((pista) => ({
          id: pista.id,
          nombre: pista.participante?.nombre ?? (reunion.origen === "SUBIDA" ? "Audio subido" : "Sin nombre"),
          estado: pista.estado,
          empiezaEn: pista.empiezaEn?.toISOString() ?? null,
          link: secreto && (pista.estado === "LISTA" || pista.estado === "TRANSCRITA") ? linkFirmado(pista.id, secreto) : null,
        })),
        frases: Array.isArray(reunion.transcripcion) ? (reunion.transcripcion as unknown as FraseDeReunion[]) : [],
        acta: reunion.acta ? normalizarActa(reunion.acta) : null,
      }}
    />
  );
}
