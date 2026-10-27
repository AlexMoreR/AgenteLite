import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EmbudoPorPasoVista } from "@/features/embudo/components/embudo-por-paso";
import { esDiaValido } from "@/features/embudo/dominio/comparar";
import { esFamilia, nombreDeFamilia, type ClaveDeFamilia } from "@/features/embudo/dominio/semanal";
import { leerEmbudoPorPaso } from "@/features/embudo/servicios/leer-embudo-por-paso";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const texto = (valor: string | string[] | undefined) => (typeof valor === "string" ? valor : "");

/**
 * EMBUDO POR PASO (para quien supervisa): en qué paso del bot se queda la gente. Solo lee.
 * Parámetros: ?familia=combo|camillas|... &desde=AAAA-MM-DD &hasta=AAAA-MM-DD.
 */
export default async function EmbudoPorPasoPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!esJefeDelNegocio(access)) {
    redirect("/cliente/crm/mi-dia");
  }

  const params = await searchParams;
  const pedida = texto(params.familia);
  const familia: ClaveDeFamilia = esFamilia(pedida) ? pedida : "combo";
  const lectura = await leerEmbudoPorPaso(access.workspaceId, {
    familia,
    desde: esDiaValido(texto(params.desde)) ? texto(params.desde) : null,
    hasta: esDiaValido(texto(params.hasta)) ? texto(params.hasta) : null,
  });

  return (
    <EmbudoPorPasoVista
      embudo={lectura.embudo}
      apagado={!lectura.activo}
      familia={familia}
      nombreProducto={nombreDeFamilia(familia)}
      desde={lectura.desde}
      hasta={lectura.hasta}
    />
  );
}
