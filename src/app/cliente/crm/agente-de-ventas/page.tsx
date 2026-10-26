import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PanelAgenteDeArea, type DatosDelPanel } from "@/features/agentes-de-area/components/PanelAgenteDeArea";
import { ETIQUETA_DE_AREA, fechaValida, hoyEnBogota } from "@/features/agentes-de-area/dominio/reglas";
import { agenteActivo, leerEquipoDeAvisos } from "@/features/agentes-de-area/servicios/config";
import { leerEnviosDelDia, leerResumenDelDia, leerUltimosResumenes } from "@/features/agentes-de-area/servicios/resumenes";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const AREA = "ventas" as const;

function hora(fecha: Date): string {
  return fecha.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" });
}

/**
 * AGENTE DE VENTAS: el resumen del día, lo que entregó cada subagente, los mensajes internos que
 * salieron (o se bloquearon) y el historial. Con el interruptor. La ven los mismos que ven el Supervisor.
 */
export default async function AgenteDeVentasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!(await puedeSupervisar(access))) redirect("/cliente/crm/mi-dia");
  const workspaceId = access.workspaceId;

  const pedida = (await searchParams).fecha;
  const fecha = typeof pedida === "string" && fechaValida(pedida) ? pedida : hoyEnBogota();

  const [activo, resumen, envios, historial, equipo, miembros] = await Promise.all([
    agenteActivo(AREA, workspaceId),
    leerResumenDelDia(workspaceId, AREA, fecha).catch(() => null),
    leerEnviosDelDia(workspaceId, AREA, fecha).catch(() => []),
    leerUltimosResumenes(workspaceId, AREA, 14).catch(() => []),
    leerEquipoDeAvisos(workspaceId),
    prisma.workspaceMember
      .findMany({
        where: { workspaceId, isActive: true, role: "AGENT" },
        select: { userId: true, user: { select: { name: true, email: true } } },
      })
      .catch(() => []),
  ]);

  const conNumero = new Set(equipo.flatMap((persona) => [persona.userId, persona.soloDe]).filter(Boolean));
  const sinNumeroDeAvisos = miembros.filter((miembro) => !conNumero.has(miembro.userId)).map((miembro) => miembro.user?.name?.trim() || miembro.user?.email || miembro.userId);

  const datos: DatosDelPanel = {
    area: AREA,
    titulo: ETIQUETA_DE_AREA[AREA],
    activo,
    fecha,
    resumen: resumen
      ? {
          esPrueba: resumen.esPrueba,
          salioTarde: resumen.salioTarde,
          notaDeRetraso: resumen.notaDeRetraso,
          texto: resumen.resumen,
          numeros: resumen.numeros,
          meta: resumen.meta,
          subagentes: resumen.subagentes && typeof resumen.subagentes === "object" && !Array.isArray(resumen.subagentes) ? (resumen.subagentes as Record<string, unknown>) : {},
          sugeridos: Array.isArray(resumen.sugeridos) ? resumen.sugeridos.length : 0,
        }
      : null,
    envios: envios.map((envio) => ({ ...envio, hora: hora(envio.creadoEn) })),
    historial: historial.map((dia) => ({ fecha: dia.fecha, esPrueba: dia.esPrueba, salioTarde: dia.salioTarde, resumen: dia.resumen })),
    sinNumeroDeAvisos,
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5">
      <PanelAgenteDeArea datos={datos} />
    </div>
  );
}
