import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { nombresDeUsuariosPara } from "@/features/reuniones/servicios/nombres-de-usuarios";
import { nombreVisible, pareceIdentidad, personasDeLaReunion } from "@/features/reuniones/servicios/nombres-de-participantes";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { esDuenoOAdmin } from "@/features/reuniones/servicios/permisos";
import { puedeBorrarLaReunionDe } from "@/features/reuniones/servicios/borrar-reunion";
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
      sinGrabar: true,
      estado: true,
      aviso: true,
      motivoError: true,
      intentos: true,
      createdAt: true,
      empezoEn: true,
      terminoEn: true,
      transcripcion: true,
      acta: true,
      creadaPorId: true,
      creadaPor: { select: { name: true, email: true } },
      participantes: { orderBy: { entroEn: "asc" }, select: { id: true, nombre: true, identidad: true, userId: true, entroEn: true, salioEn: true } },
      pistas: {
        orderBy: { empiezaEn: "asc" },
        select: { id: true, estado: true, empiezaEn: true, terminaEn: true, participante: { select: { nombre: true, identidad: true, userId: true } } },
      },
    },
  });
  if (!reunion) {
    notFound();
  }

  // Nombres, nunca identidades (u_..., EG_...): los registros viejos se completan con el nombre del usuario.
  const nombres = await nombresDeUsuariosPara([...reunion.participantes, ...reunion.pistas.flatMap((pista) => (pista.participante ? [pista.participante] : []))]);
  const personas = personasDeLaReunion(reunion.participantes, nombres);
  const visiblePorNombre = new Map(personas.flatMap((p) => [[p.nombre, p.nombreVisible], [p.identidad, p.nombreVisible]] as const));

  // Los audios se escuchan solo con un link firmado que vence en 1 hora.
  const secreto = secretoDeLosLinks();

  return (
    <DetalleDeReunion
      reunion={{
        id: reunion.id,
        titulo: reunion.titulo,
        codigo: reunion.codigo,
        origen: reunion.origen,
        sinGrabar: reunion.sinGrabar,
        estado: reunion.estado,
        aviso: reunion.aviso,
        motivoError: reunion.motivoError,
        creada: reunion.createdAt.toISOString(),
        empezoEn: reunion.empezoEn?.toISOString() ?? null,
        terminoEn: reunion.terminoEn?.toISOString() ?? null,
        creadaPor: reunion.creadaPor?.name?.trim() || reunion.creadaPor?.email || null,
        participantes: personas.map((participante) => ({
          id: participante.id,
          nombre: participante.nombreVisible,
          entroEn: participante.entroEn.toISOString(),
          salioEn: participante.salioEn?.toISOString() ?? null,
        })),
        pistas: reunion.pistas.map((pista) => ({
          id: pista.id,
          nombre: (pista.participante ? nombreVisible(pista.participante, nombres) : null) ?? (reunion.origen === "SUBIDA" ? "Audio subido" : "Sin nombre"),
          estado: pista.estado,
          empiezaEn: pista.empiezaEn?.toISOString() ?? null,
          link: secreto && (pista.estado === "LISTA" || pista.estado === "TRANSCRITA") ? linkFirmado(pista.id, secreto) : null,
        })),
        frases: Array.isArray(reunion.transcripcion) ? (reunion.transcripcion as unknown as FraseDeReunion[]).map((frase) => ({ ...frase, nombre: visiblePorNombre.get(frase.nombre) ?? (pareceIdentidad(frase.nombre) ? "Participante" : frase.nombre) })) : [],
        puedeBorrar: puedeBorrarLaReunionDe({ userId: access.userId, esDuenoOAdmin: esDuenoOAdmin(access) }, reunion),
        acta: reunion.acta ? normalizarActa(reunion.acta) : null,
      }}
    />
  );
}
