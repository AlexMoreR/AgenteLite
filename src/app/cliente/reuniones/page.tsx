import type { Metadata } from "next";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { esDuenoOAdmin } from "@/features/reuniones/servicios/permisos";
import { puedeBorrarLaReunionDe } from "@/features/reuniones/servicios/borrar-reunion";
import { ReunionesWorkspace } from "@/features/reuniones/components/ReunionesWorkspace";
import { buscarReuniones } from "@/features/reuniones/servicios/buscar-reuniones";
import { claveDeOpenAI } from "@/features/reuniones/servicios/cola-de-reuniones";
import { leerConfigLivekit } from "@/features/reuniones/servicios/livekit";

export const metadata: Metadata = {
  title: "Reuniones",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Reuniones: videollamadas propias (LiveKit) que se graban por persona, se pasan a texto y dejan
 * un acta.
 */
export default async function ClienteReunionesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireClientWorkspaceAccess("reuniones");
  const parametros = await searchParams;
  const buscado = typeof parametros.q === "string" ? parametros.q.trim().slice(0, 120) : "";
  const reuniones = await buscarReuniones(access.workspaceId, buscado).catch(() => []);

  return (
    <ReunionesWorkspace
      buscado={buscado}
      videoListo={Boolean(leerConfigLivekit())}
      hayClaveDeOpenAI={Boolean(claveDeOpenAI())}
      reuniones={reuniones.map((reunion) => ({
        id: reunion.id,
        titulo: reunion.titulo,
        codigo: reunion.codigo,
        origen: reunion.origen,
        estado: reunion.estado,
        aviso: reunion.aviso,
        motivoError: reunion.motivoError,
        creada: reunion.createdAt.toISOString(),
        creadaPor: reunion.creadaPor,
        participantes: reunion.participantes,
        resumen: reunion.resumen,
        puedeBorrar: puedeBorrarLaReunionDe({ userId: access.userId, esDuenoOAdmin: esDuenoOAdmin(access) }, reunion),
      }))}
    />
  );
}
