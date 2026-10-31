import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MapaColombia } from "@/features/pauta/components/mapa-colombia";
import { leerMapa, type MapaDelMes } from "@/features/pauta/servicios/leer-mapa";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const texto = (valor: string | string[] | undefined) => (typeof valor === "string" ? valor : "");

/** MAPA DE COLOMBIA (para quien supervisa): gasto de Meta, chats y ventas por departamento en un mes. Solo lee. ?mes=AAAA-MM */
export default async function MapaColombiaPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!esJefeDelNegocio(access)) {
    redirect("/cliente/crm/mi-dia");
  }
  const params = await searchParams;
  let mapa: MapaDelMes;
  let error: string | null = null;
  try {
    mapa = await leerMapa(access.workspaceId, { mes: texto(params.mes) });
  } catch (e) {
    // leerMapa solo lanza si el mes no sirve: se avisa y se muestra el mes en curso.
    error = e instanceof Error ? e.message : "El mes no es válido.";
    mapa = await leerMapa(access.workspaceId);
  }
  return <MapaColombia mapa={mapa} error={error} />;
}
