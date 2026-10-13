import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { etiquetaDeSemana, semanaPedida, semanaPorDefecto, sumarDias } from "@/features/embudo/dominio/semanal";
import { SemanaDeRecuperacionVista } from "@/features/recuperacion/components/semana-de-recuperacion";
import { resumirSemana } from "@/features/recuperacion/dominio/semana";
import { leerAlarmaDeHoy } from "@/features/recuperacion/servicios/alarma";
import { puedeVerRecuperacion } from "@/features/recuperacion/servicios/permiso";
import { leerSemanaDeRecuperacion } from "@/features/recuperacion/servicios/semana";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * RECUPERACIÓN DE LEADS (fase 1: pantalla "Semana"). Solo dueño / administrador y la supervisora
 * del Supervisor accionable. Por defecto, la semana pasada completa (lunes a domingo, hora Bogotá);
 * ?semana=AAAA-MM-DD (un lunes) para otra. Las lecturas quedan 10 min en memoria (la alarma, 5).
 */
export default async function RecuperacionPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!(await puedeVerRecuperacion(access))) {
    redirect("/cliente/crm/mi-dia");
  }

  const params = await searchParams;
  const ahora = new Date();
  const lunes = semanaPedida(typeof params.semana === "string" ? params.semana : "", ahora);
  const lunesAnterior = sumarDias(lunes, -7);

  const [actual, anterior, alarma] = await Promise.all([
    leerSemanaDeRecuperacion(access.workspaceId, lunes),
    leerSemanaDeRecuperacion(access.workspaceId, lunesAnterior),
    leerAlarmaDeHoy(access.workspaceId).catch(() => null),
  ]);
  const semana = resumirSemana(actual.leads, ahora);
  const semanaAnterior = resumirSemana(anterior.leads, ahora);

  const porDefecto = semanaPorDefecto(ahora);
  const href = (semanaDestino: string) =>
    semanaDestino === porDefecto ? "/cliente/crm/recuperacion" : `/cliente/crm/recuperacion?semana=${semanaDestino}`;
  const siguiente = sumarDias(lunes, 7);

  return (
    <SemanaDeRecuperacionVista
      etiquetaSemana={etiquetaDeSemana(lunes)}
      etiquetaAnterior={etiquetaDeSemana(lunesAnterior)}
      hrefSemanaAnterior={href(lunesAnterior)}
      hrefSemanaSiguiente={siguiente <= porDefecto ? href(siguiente) : null}
      alarma={alarma}
      semana={semana}
      anterior={semanaAnterior.llegaron > 0 ? semanaAnterior : null}
    />
  );
}
