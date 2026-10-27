import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CompararEmbudosVista } from "@/features/embudo/components/comparar-embudos";
import { CompararFiltros } from "@/features/embudo/components/comparar-filtros";
import { esDiaValido, esOrigen } from "@/features/embudo/dominio/comparar";
import { esFamilia, nombreDeFamilia, type ClaveDeFamilia } from "@/features/embudo/dominio/semanal";
import { leerComparacion, leerLineasDeVentas } from "@/features/embudo/servicios/leer-comparacion";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const texto = (valor: string | string[] | undefined) => (typeof valor === "string" ? valor : "");

/** "", "sin" o un número de versión. undefined = automática. */
function versionPedida(valor: string): number | null | undefined {
  if (valor === "sin") return null;
  return /^\d{1,6}$/.test(valor) ? Number(valor) : undefined;
}

/**
 * COMPARAR EMBUDOS (para quien supervisa): dos versiones del libro lado a lado. Solo lee.
 * Parámetros: ?familia=combo|camillas|... &a=<versión>|sin &b=<versión>|sin &desde=AAAA-MM-DD
 * &hasta=AAAA-MM-DD &linea=<id de la línea> &origen=anuncio|marketplace|directo.
 */
export default async function CompararEmbudosPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!esJefeDelNegocio(access)) {
    redirect("/cliente/crm/mi-dia");
  }

  const params = await searchParams;
  const pedidaFamilia = texto(params.familia);
  const familia: ClaveDeFamilia = esFamilia(pedidaFamilia) ? pedidaFamilia : "combo";
  const desde = esDiaValido(texto(params.desde)) ? texto(params.desde) : null;
  const hasta = esDiaValido(texto(params.hasta)) ? texto(params.hasta) : null;
  const canalId = texto(params.linea) || null;
  const origenPedido = texto(params.origen);
  const origen = esOrigen(origenPedido) ? origenPedido : null;

  const [lectura, lineas] = await Promise.all([
    leerComparacion(access.workspaceId, {
      desde,
      hasta,
      canalId,
      origen,
      familia,
      versionA: versionPedida(texto(params.a)),
      versionB: versionPedida(texto(params.b)),
    }),
    leerLineasDeVentas(access.workspaceId),
  ]);

  return (
    <CompararEmbudosVista
      comparacion={lectura.comparacion}
      apagado={!lectura.activo}
      etiquetaRango={`${lectura.desde} a ${lectura.hasta}`}
      nombreProducto={nombreDeFamilia(familia)}
      versionesConChats={lectura.versiones.length}
      // La prueba A/B (Embudo 5) todavía no existe en el código: el botón va apagado.
      hrefPruebaAb={null}
      filtros={
        <CompararFiltros
          actuales={{
            familia,
            versionA: texto(params.a),
            versionB: texto(params.b),
            desde: desde ?? lectura.desde,
            hasta: hasta ?? lectura.hasta,
            canalId: canalId ?? "",
            origen: origen ?? "",
          }}
          versiones={lectura.versiones}
          sinVersion={lectura.sinVersion}
          lineas={lineas}
          hrefLimpiar="/cliente/crm/comparar-embudos"
        />
      }
    />
  );
}
