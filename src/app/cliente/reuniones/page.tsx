import type { Metadata } from "next";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { esDuenoOAdmin, puedeAdministrarSalas } from "@/features/reuniones/servicios/permisos";
import { puedeBorrarLaReunionDe } from "@/features/reuniones/servicios/borrar-reunion";
import { ReunionesWorkspace } from "@/features/reuniones/components/ReunionesWorkspace";
import { buscarReuniones } from "@/features/reuniones/servicios/buscar-reuniones";
import { claveDeOpenAI } from "@/features/reuniones/servicios/cola-de-reuniones";
import { leerConfigLivekit } from "@/features/reuniones/servicios/livekit";
import { listarSalas, usuariosDelNegocio } from "@/features/reuniones/servicios/salas";

export const metadata: Metadata = {
  title: "Reuniones",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Reuniones: videollamadas propias (LiveKit) que se graban por persona, se pasan a texto y dejan
 * un acta. Arriba las salas fijas de cada área; abajo «Sin sala», las reuniones sueltas (y las de
 * antes de las salas). Al buscar se busca en todas y cada resultado dice su sala.
 */
export default async function ClienteReunionesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireClientWorkspaceAccess("reuniones");
  const parametros = await searchParams;
  const buscado = typeof parametros.q === "string" ? parametros.q.trim().slice(0, 120) : "";
  const puedeAdministrar = await puedeAdministrarSalas(access.userId, access.workspaceId).catch(() => false);
  const [reuniones, salas, usuarios] = await Promise.all([
    buscarReuniones(access.workspaceId, buscado, 50, { soloSinSala: !buscado }).catch(() => null),
    listarSalas(access.workspaceId).catch(() => null),
    puedeAdministrar ? usuariosDelNegocio(access.workspaceId).catch(() => []) : Promise.resolve([]),
  ]);

  return (
    <ReunionesWorkspace
      buscado={buscado}
      videoListo={Boolean(leerConfigLivekit())}
      hayClaveDeOpenAI={Boolean(claveDeOpenAI())}
      puedeAdministrarSalas={puedeAdministrar}
      usuarios={usuarios}
      salas={
        salas?.map((sala) => ({
          id: sala.id,
          nombre: sala.nombre,
          codigo: sala.codigo,
          sinGrabar: sala.sinGrabar,
          lider: sala.lider,
          enVivo: sala.abierta?.estado === "EN_VIVO",
          abierta: Boolean(sala.abierta),
          ultimaReunion: sala.ultimaReunionEn?.toISOString() ?? null,
          totalDeReuniones: sala.totalDeReuniones,
        })) ?? null
      }
      reuniones={
        reuniones?.map((reunion) => ({
          id: reunion.id,
          titulo: reunion.titulo,
          codigo: reunion.codigo,
          origen: reunion.origen,
          sinGrabar: reunion.sinGrabar,
          estado: reunion.estado,
          aviso: reunion.aviso,
          motivoError: reunion.motivoError,
          creada: reunion.createdAt.toISOString(),
          creadaPor: reunion.creadaPor,
          participantes: reunion.participantes,
          resumen: reunion.resumen,
          sala: reunion.salaFija?.nombre ?? null,
          puedeBorrar: puedeBorrarLaReunionDe({ userId: access.userId, esDuenoOAdmin: esDuenoOAdmin(access) }, reunion),
        })) ?? null
      }
    />
  );
}
