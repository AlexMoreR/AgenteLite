import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Target } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { FormularioDeMetas } from "@/features/metas/components/FormularioDeMetas";
import { esMesValido } from "@/features/metas/dominio/metas-guardadas";
import { mesActualBogota, metasParaFormulario } from "@/features/metas/servicios/metas-del-mes";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";

export const metadata: Metadata = {
  title: "Metas del mes",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Metas del mes de cada asesora, el equipo y la comisión. Solo el dueño y los administradores del negocio:
 * las demás cuentas, también las que llegan por un link, terminan en Mi día.
 */
export default async function MetasPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess(undefined, { redirectTo: "/cliente" });
  if (!esJefeDelNegocio(access)) redirect("/cliente/crm/mi-dia");

  const params = await searchParams;
  const mesActual = mesActualBogota(new Date());
  const pedido = typeof params.mes === "string" ? params.mes.trim() : "";
  const mes = esMesValido(pedido) ? pedido : mesActual;

  const datos = await metasParaFormulario(access.workspaceId, mes);

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 md:p-6">
      <PageHeader icon={Target} title="Metas del mes" />
      {datos ? (
        <FormularioDeMetas
          key={mes}
          mes={mes}
          mesActual={mesActual}
          metas={datos.metas}
          origen={datos.origen}
          miembros={datos.miembros}
        />
      ) : (
        <p role="alert" className="rounded-lg border border-border px-3 py-2 text-sm text-destructive">
          No se pudieron leer las metas. Recarga la página en un momento.
        </p>
      )}
    </section>
  );
}
