import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ReportePauta } from "@/features/pauta/components/reporte-pauta";
import { leerReporteDePauta } from "@/features/pauta/servicios/leer-reporte";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const texto = (valor: string | string[] | undefined) => (typeof valor === "string" ? valor : "");

/** PAUTA (para quien supervisa): chats, Calientes, ventas, gasto y costo por venta por campaña. Solo lee. ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD */
export default async function PautaPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!(await puedeSupervisar(access))) {
    redirect("/cliente/crm/mi-dia");
  }
  const params = await searchParams;
  const lectura = await leerReporteDePauta(access.workspaceId, { desde: texto(params.desde), hasta: texto(params.hasta) });
  return <ReportePauta lectura={lectura} />;
}
