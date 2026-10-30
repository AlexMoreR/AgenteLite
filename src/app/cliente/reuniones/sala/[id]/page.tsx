import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { ESTADOS_PARA_ENTRAR } from "@/features/reuniones/estados";
import { puedeAdministrarSalas } from "@/features/reuniones/servicios/permisos";
import { leerHistorialDeLaSala, usuariosDelNegocio } from "@/features/reuniones/servicios/salas";
import { nombresDeUsuariosPara } from "@/features/reuniones/servicios/nombres-de-usuarios";
import { personasDeLaReunion } from "@/features/reuniones/servicios/nombres-de-participantes";
import { HistorialDeLaSala } from "@/features/reuniones/components/HistorialDeLaSala";
import { BotonEditarSala, CompartirSala, type SalaDeLaPantalla } from "@/features/reuniones/components/SalasDeReuniones";

export const metadata: Metadata = {
  title: "Sala de reuniones",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Una sala fija (como un canal de Teams): su nombre y líder, el link fijo /reunion/sala/<codigo> para
 * compartir, «Iniciar»/«Entrar» y el historial de todas sus reuniones con el resumen del acta.
 * «Editar» solo lo ve el dueño o un administrador.
 */
export default async function ClienteSalaDeReunionesPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireClientWorkspaceAccess("reuniones");
  const { id } = await params;
  const sala = await prisma.salaDeReuniones.findFirst({
    where: { id, workspaceId: access.workspaceId },
    select: { id: true, nombre: true, codigo: true, sinGrabar: true, lider: { select: { id: true, name: true, email: true } } },
  });
  if (!sala) {
    notFound();
  }

  const puedeAdministrar = await puedeAdministrarSalas(access.userId, access.workspaceId).catch(() => false);
  const [historial, usuarios] = await Promise.all([
    leerHistorialDeLaSala(sala.id).catch(() => null),
    puedeAdministrar ? usuariosDelNegocio(access.workspaceId).catch(() => []) : Promise.resolve([]),
  ]);
  // Nombres, nunca identidades (u_..., EG_...): los registros viejos se completan con el nombre del usuario.
  const nombres = historial ? await nombresDeUsuariosPara(historial.flatMap((reunion) => reunion.participantes)).catch(() => new Map<string, string>()) : new Map<string, string>();

  const abierta = historial?.find((reunion) => ESTADOS_PARA_ENTRAR.includes(reunion.estado)) ?? null;
  const datosDeLaSala: SalaDeLaPantalla = {
    id: sala.id,
    nombre: sala.nombre,
    codigo: sala.codigo,
    sinGrabar: sala.sinGrabar,
    lider: sala.lider ? { id: sala.lider.id, nombre: sala.lider.name?.trim() || sala.lider.email.split("@")[0] } : null,
    enVivo: abierta?.estado === "EN_VIVO",
    abierta: Boolean(abierta),
    ultimaReunion: historial?.[0]?.createdAt.toISOString() ?? null,
    totalDeReuniones: historial?.length ?? 0,
  };

  return (
    <section className="mx-auto w-full max-w-3xl space-y-5 px-4 py-5">
      <div className="space-y-1">
        <Link href="/cliente/reuniones" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Reuniones
        </Link>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h1 className="min-w-0 break-words text-lg font-semibold">{sala.nombre}</h1>
              {datosDeLaSala.enVivo ? <Badge variant="destructive">● En vivo</Badge> : null}
              {sala.sinGrabar ? <Badge variant="outline">Sin grabar</Badge> : null}
            </div>
            <p className="text-xs text-muted-foreground">{datosDeLaSala.lider ? `Líder: ${datosDeLaSala.lider.nombre}` : "Sin líder"}</p>
          </div>
          {puedeAdministrar ? <BotonEditarSala sala={datosDeLaSala} usuarios={usuarios} /> : null}
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-card px-3 py-2.5">
        <p className="text-xs text-muted-foreground">
          Link fijo de la sala (no cambia): <span className="break-all font-medium text-foreground">/reunion/sala/{sala.codigo}</span>
        </p>
        <CompartirSala sala={datosDeLaSala} />
      </div>

      <HistorialDeLaSala
        reuniones={
          historial?.map((reunion) => ({
            id: reunion.id,
            titulo: reunion.titulo,
            estado: reunion.estado,
            sinGrabar: reunion.sinGrabar,
            empezoEn: reunion.empezoEn?.toISOString() ?? null,
            terminoEn: reunion.terminoEn?.toISOString() ?? null,
            creada: reunion.createdAt.toISOString(),
            participantes: [...new Set(personasDeLaReunion(reunion.participantes, nombres).map((persona) => persona.nombreVisible))],
            resumen: reunion.resumen,
          })) ?? null
        }
      />
    </section>
  );
}
