import type { Metadata } from "next";
import Link from "next/link";
import { HabilidadDelDia } from "@/features/coach/components/HabilidadDelDia";
import { PendientesDelCoach } from "@/features/coach/components/PendientesDelCoach";
import { leerPendientesDelCoach } from "@/features/coach/servicios/leer-coach";
import { TareasDeSeguimiento } from "@/features/seguimiento-inteligente/components/TareasDeSeguimiento";
import { leerTareasDeAsesora } from "@/features/seguimiento-inteligente/servicios/tareas";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getVisibleChannelIds } from "@/lib/channel-visibility";
import { getMiDiaData } from "@/features/crm/services/getMiDiaData";
import { MiDiaView } from "@/features/crm/components/MiDiaView";
import { LlamadasDeMiDia } from "@/features/llamadas/components/LlamadasDeMiDia";
import { getLlamadasVendedoraData } from "@/features/llamadas/services/getLlamadasData";
import { getResumenDiaData } from "@/features/llamadas/services/getResumenDia";
import { ResumenDiaView } from "@/features/llamadas/components/ResumenDiaView";
import { prisma } from "@/lib/prisma";
import { canAccessClientModule } from "@/lib/client-workspace-access";
import { buildWaCallsDialerUrl } from "@/lib/wacalls";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

export default async function ClienteCrmMiDiaPage() {
  // Mi dia es ahora la pantalla de ENTRADA de todos, asi que quien no tenga el modulo CRM no
  // puede quedar en un "no autorizado" sin salida: se lo devuelve a /cliente, que ya sabe a
  // donde mandarlo segun sus permisos.
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  // Su dia: la lista trae SUS leads y los que no tienen dueno, no los de otra persona.
  const visibleChannelIds = await getVisibleChannelIds({
    workspaceId: access.workspaceId,
    userId: access.userId,
    esJefe: access.isOwner || access.role === "ADMIN",
  });

  /*
    Un solo "Mi dia" (Alex, 15-sep-2026).

    Antes habia dos: este, con los chats a contactar y a responder, y el de Llamadas, con a quien
    llamar hoy y las llamadas sin clasificar. La asesora saltaba de uno a otro y se le pasaba lo que
    estaba en el que no miraba. Quien no tenga el modulo de Llamadas ve la pantalla como hasta ahora.
  */
  const veLlamadas = canAccessClientModule(access, "llamadas");
  const quien = veLlamadas
    ? await prisma.user.findUnique({ where: { id: access.userId }, select: { name: true, email: true } })
    : null;
  const [data, vendedora, resumen, coach, tareasDeSeguimiento] = await Promise.all([
    getMiDiaData({
      workspaceId: access.workspaceId,
      userId: access.userId,
      visibleChannelIds,
    }),
    veLlamadas ? getLlamadasVendedoraData(access.workspaceId, access.userId) : Promise.resolve(null),
    /*
      El informe del dia se cierra ACA (Alex, 15-sep-2026): estaba en una pestaña de Llamadas, que
      es una pantalla de consulta. Es lo ultimo del dia de trabajo, asi que va al final de Mi dia.
    */
    veLlamadas
      ? getResumenDiaData({
          workspaceId: access.workspaceId,
          userId: access.userId,
          advisorName: quien?.name?.trim() || quien?.email || "Asesora",
        })
      : Promise.resolve(null),
    // "Lo que te dejó el Coach": sus pendientes del último informe (solo lectura, solo los suyos).
    leerPendientesDelCoach(access.workspaceId, access.userId).catch(() => null),
    // Seguimiento inteligente: sus tareas de hoy (solo con el motor en modo activo).
    leerTareasDeAsesora(access.workspaceId, access.userId).catch(() => []),
  ]);
  const bloqueDeSeguimiento = tareasDeSeguimiento.length ? (
    <details open className="rounded-xl border border-border bg-card px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-foreground">
        Seguimientos para hoy ({tareasDeSeguimiento.length})
      </summary>
      <div className="pt-3">
        <TareasDeSeguimiento tareas={tareasDeSeguimiento} />
      </div>
    </details>
  ) : null;
  const marcadorUrl = buildWaCallsDialerUrl("");
  // Solo lo suyo: su habilidad del día con la meta, y sus pendientes.
  const bloqueDelCoach =
    coach && (coach.pendientes.length || coach.habilidad) ? (
      <details open className="rounded-xl border border-border bg-card px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          Lo que te dejó el Coach
          {coach.habilidad ? ` · ${coach.habilidad.nombre}` : ""}
          {coach.pendientes.length ? ` · ${coach.pendientes.length} pendientes` : ""}
        </summary>
        <div className="space-y-2 pt-3">
          {coach.habilidad ? <HabilidadDelDia habilidad={coach.habilidad} compacta /> : null}
          {coach.pendientes.length ? <PendientesDelCoach pendientes={coach.pendientes} max={5} /> : null}
          <Link href={`/cliente/equipo/coach?dia=${coach.dia}`} className="text-xs font-medium text-primary hover:underline">
            Ver mi informe del {coach.dia}
          </Link>
        </div>
      </details>
    ) : null;

  return (
    <MiDiaView
      data={data}
      llamadasUrgentes={
        bloqueDeSeguimiento || bloqueDelCoach || vendedora ? (
          <>
            {bloqueDeSeguimiento}
            {bloqueDelCoach}
            {vendedora ? <LlamadasDeMiDia vendedora={vendedora} marcadorUrl={marcadorUrl} momento="urgente" /> : null}
          </>
        ) : null
      }
      llamadasDespues={
        <>
          {vendedora ? <LlamadasDeMiDia vendedora={vendedora} marcadorUrl={marcadorUrl} momento="despues" /> : null}
          {resumen ? (
            <details className="rounded-xl border border-border bg-card px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-foreground">
                Informe del día para el jefe
              </summary>
              <div className="pt-4">
                <ResumenDiaView data={resumen} />
              </div>
            </details>
          ) : null}
        </>
      }
    />
  );
}
