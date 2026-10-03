import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { CatalogoDeProductos, type ProductoDelCatalogo } from "@/components/admin/catalogo-de-productos";
import { leerFiltroDeNegocio, listarNegocios } from "@/lib/negocios-del-admin";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { hasAdminModuleAccess } from "@/lib/admin-module-access";
import { prisma } from "@/lib/prisma";
import { getSystemCurrency } from "@/lib/system-settings";
import { leerConexionConGestion, leerUltimaSincronizacion } from "@/lib/sincronizacion-gestion";
import { PRODUCT_FUNNEL_STAGES } from "@/lib/product-funnel-stages";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Donde se crean los productos desde el 03-10-2026: en Gestión, que es la fuente de verdad. */
const CREAR_EN_GESTION = "https://magilus.com/admin/productos/new";

const ETIQUETA_DEL_PASO = new Map(PRODUCT_FUNNEL_STAGES.map((paso) => [paso.stage as string, paso.label]));
const UNIDAD_CORTA: Record<string, string> = { MINUTES: "min", HOURS: "h", DAYS: "d" };

/**
 * PRODUCTOS: el catálogo que viene de Gestión y lo que el CRM le agrega para vender.
 *
 * Rediseño de Alex (03-10-2026): tabla limpia a la izquierda y, al tocar un producto, un panel con
 * dos mitades bien separadas: "Desde Gestión" (solo lectura, con candado) y "Para el agente"
 * (la descripción de venta y el embudo, que son del CRM).
 */
export default async function AdminProductosPage({ searchParams }: PageProps) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  const canAccess = await hasAdminModuleAccess(session.user.id, session.user.role, "products");
  if (!canAccess) {
    redirect("/unauthorized");
  }

  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";

  /*
    El selector "Negocio" solo aparece con dos o más negocios.

    En la base hay nueve espacios de trabajo, casi todos vacíos (pruebas viejas, duplicados). Lo que
    cuenta como negocio para esta pantalla es el que TIENE CATÁLOGO: hoy uno solo, así que el
    selector se esconde; el día que otro negocio cargue productos, aparece solo. El soporte para
    varios negocios no se quitó: es la misma pantalla filtrada.
  */
  const todos = await listarNegocios();
  const conProductos = await prisma.product.groupBy({ by: ["workspaceId"], _count: { _all: true } });
  const idsConProductos = new Set(conProductos.map((fila) => fila.workspaceId));
  const negocios = todos.filter((negocio) => idsConProductos.has(negocio.id));
  const pedido = leerFiltroDeNegocio(params.negocio, negocios);
  const negocioFiltrado = pedido ?? (negocios.length === 1 ? negocios[0].id : null);

  const [productos, currency, conexion, ultima] = await Promise.all([
    prisma.product.findMany({
      where: negocioFiltrado ? { workspaceId: negocioFiltrado } : {},
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        price: true,
        wholesalePrice: true,
        minWholesaleQty: true,
        thumbnailUrl: true,
        origen: true,
        activo: true,
        estadoEnGestion: true,
        sincronizadoEl: true,
        workspace: { select: { name: true } },
        category: { select: { name: true } },
        images: { orderBy: { order: "asc" }, select: { url: true } },
        playbooks: {
          take: 1,
          select: {
            stages: {
              orderBy: { sortOrder: "asc" },
              select: {
                stage: true,
                goal: true,
                script: true,
                followUps: {
                  where: { isActive: true },
                  orderBy: { sortOrder: "asc" },
                  select: { timeType: true, timeValue: true, flowId: true },
                },
              },
            },
          },
        },
      },
    }),
    getSystemCurrency(),
    negocioFiltrado ? leerConexionConGestion(negocioFiltrado) : Promise.resolve(null),
    negocioFiltrado ? leerUltimaSincronizacion(negocioFiltrado) : Promise.resolve(null),
  ]);

  const filas: ProductoDelCatalogo[] = productos.map((producto) => {
    const fotos = [...new Set([producto.thumbnailUrl, ...producto.images.map((imagen) => imagen.url)])].filter(
      (url) => url && url.trim() && url !== "/file.svg",
    );
    const pasos = (producto.playbooks[0]?.stages ?? [])
      .filter((paso) => (paso.goal ?? "").trim() || (paso.script ?? "").trim() || paso.followUps.length > 0)
      .map((paso) => ({
        etiqueta: ETIQUETA_DEL_PASO.get(paso.stage) ?? paso.stage,
        objetivo: paso.goal?.trim() || null,
        seguimientos: paso.followUps.map(
          (seguimiento) =>
            `${seguimiento.timeValue} ${UNIDAD_CORTA[seguimiento.timeType] ?? seguimiento.timeType}${seguimiento.flowId ? " (flujo)" : ""}`,
        ),
      }));
    return {
      id: producto.id,
      nombre: producto.name,
      codigo: producto.code,
      negocio: producto.workspace?.name?.trim() || "Sin negocio",
      categoria: producto.category?.name ?? null,
      precio: Number(producto.price),
      precioMayorista: Number(producto.wholesalePrice),
      cantidadMinimaMayorista: producto.minWholesaleQty,
      descripcion: producto.description ?? "",
      fotos,
      origen: producto.origen === "GESTION" ? "GESTION" : "MANUAL",
      activo: producto.activo,
      estadoEnGestion: producto.estadoEnGestion,
      pasos,
    };
  });

  return (
    <section className="w-full space-y-4 overflow-x-hidden">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Catálogo actualizado"
        errorTitle="Error en productos"
      />
      <CatalogoDeProductos
        productos={filas}
        negocios={negocios}
        negocioFiltrado={negocioFiltrado}
        currency={currency}
        conectadoAGestion={Boolean(conexion)}
        ultimaSincronizacion={ultima}
        crearEnGestionHref={CREAR_EN_GESTION}
      />
    </section>
  );
}
