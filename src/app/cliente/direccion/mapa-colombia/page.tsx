import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MapaColombia } from "@/features/pauta/components/mapa-colombia";
import { leerMapa } from "@/features/pauta/servicios/leer-mapa";
import { rangoPorDefecto } from "@/features/pauta/servicios/leer-reporte";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Cuántos meses hacia atrás ofrece el selector. */
const MESES_EN_EL_SELECTOR = 12;

const texto = (valor: string | string[] | undefined) => (typeof valor === "string" ? valor : "");

/** Los últimos meses 'AAAA-MM', del más nuevo al más viejo (hora de Colombia). */
function mesesRecientes(): string[] {
  const [anio, mes] = rangoPorDefecto().hasta.split("-").map(Number);
  return Array.from({ length: MESES_EN_EL_SELECTOR }, (_, i) => {
    const fecha = new Date(Date.UTC(anio, mes - 1 - i, 1));
    return fecha.toISOString().slice(0, 7);
  });
}

/** MAPA DE COLOMBIA (solo jefes): gasto de Meta, chats y ventas por departamento en un mes. Solo lee. ?mes=AAAA-MM */
export default async function MapaColombiaPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!esJefeDelNegocio(access)) {
    redirect("/cliente/crm/mi-dia");
  }
  const params = await searchParams;
  let error: string | null = null;
  let mapa;
  try {
    mapa = await leerMapa(access.workspaceId, { mes: texto(params.mes) });
  } catch (falla) {
    // leerMapa solo lanza por un mes que no sirve: se avisa y se muestra el mes en curso.
    const motivo = falla instanceof Error && falla.message.startsWith('"mes"') ? falla.message : "No se pudo leer ese mes.";
    error = `${motivo} Se muestra el mes en curso.`;
    mapa = await leerMapa(access.workspaceId);
  }
  return <MapaColombia mapa={mapa} meses={mesesRecientes()} error={error} />;
}
