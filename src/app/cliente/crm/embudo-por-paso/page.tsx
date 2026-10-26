import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EmbudoPorPasoVista } from "@/features/embudo/components/embudo-por-paso";
import { esDiaValido } from "@/features/embudo/dominio/comparar";
import { textoPorPaso } from "@/features/embudo/dominio/por-paso";
import { esFamilia, nombreDeFamilia, type ClaveDeFamilia } from "@/features/embudo/dominio/semanal";
import { leerEmbudoPorPaso } from "@/features/embudo/servicios/leer-embudo-por-paso";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const texto = (valor: string | string[] | undefined) => (typeof valor === "string" ? valor : "");

/**
 * EMBUDO POR PASO (para quien supervisa): cuántos clientes llegaron a cada paso del bot y cuántos se
 * quedaron. Solo lee. Parámetros: ?familia=combo|... &desde=AAAA-MM-DD &hasta=AAAA-MM-DD.
 */
export default async function EmbudoPorPasoPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!(await puedeSupervisar(access))) {
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
      apagado={!lectura.activo}
      familia={familia}
      nombreProducto={nombreDeFamilia(familia)}
      desde={lectura.desde}
      hasta={lectura.hasta}
      soloBot={lectura.embudo.soloBot}
      conAsesora={lectura.embudo.conAsesora}
      resumen={textoPorPaso(lectura.embudo, nombreDeFamilia(familia))}
      hrefEmbudo="/cliente/crm/embudo"
    />
  );
}
