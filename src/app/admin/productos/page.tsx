import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ProductsWorkspace } from "@/components/admin/products-workspace";
import { leerFiltroDeNegocio, listarNegocios } from "@/lib/negocios-del-admin";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { hasAdminModuleAccess } from "@/lib/admin-module-access";
import { prisma } from "@/lib/prisma";
import { getSystemCurrency } from "@/lib/system-settings";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

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

  const negocios = await listarNegocios();
  const negocioFiltrado = leerFiltroDeNegocio(params.negocio, negocios);

  const [products, categories, suppliers, systemCurrency] = await Promise.all([
    prisma.product.findMany({
      /*
        Sin filtro por defecto: el admin de la plataforma sigue viendo los nueve negocios
        (decision de Alex, 29-09-2026). El filtro de arriba sirve para mirar uno.
      */
      where: negocioFiltrado ? { workspaceId: negocioFiltrado } : {},
      orderBy: { createdAt: "desc" },
      include: {
        workspace: { select: { name: true } },
        category: true,
        images: {
          orderBy: { order: "asc" },
        },
        suppliers: {
          where: { isPreferred: true },
          include: { supplier: true },
          take: 1,
        },
      },
    }),
    // Las categorias que se ofrecen al editar un producto son las del negocio que se esta mirando.
    prisma.category.findMany({
      where: { isActive: true, ...(negocioFiltrado ? { workspaceId: negocioFiltrado } : {}) },
      orderBy: { name: "asc" },
    }),
    prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    getSystemCurrency(),
  ]);

  return (
    <section className="w-full space-y-4 overflow-x-hidden">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Catalogo actualizado"
        errorTitle="Error en productos"
      />

      <ProductsWorkspace
        negocios={negocios}
        negocioFiltrado={negocioFiltrado}
        currency={systemCurrency}
        okMessage={okMessage}
        categories={categories.map((category) => ({
          id: category.id,
          name: category.name,
        }))}
        suppliers={suppliers.map((supplier) => ({
          id: supplier.id,
          name: supplier.name,
        }))}
        products={products.map((product) => ({
          id: product.id,
          code: product.code,
          name: product.name,
          description: product.description,
          categoryId: product.categoryId,
          categoryName: product.category?.name ?? null,
          negocio: product.workspace?.name?.trim() || "Sin negocio",
          supplierId: product.suppliers[0]?.supplier.id ?? null,
          supplierName: product.suppliers[0]?.supplier.name ?? null,
          thumbnailUrl: product.thumbnailUrl,
          imageUrls: product.images.map((image) => image.url),
          baseCost: Number(product.baseCost),
          retailMarginPct: Number(product.retailMarginPct),
          wholesaleMarginPct: Number(product.wholesaleMarginPct),
          minWholesaleQty: product.minWholesaleQty,
          price: Number(product.price),
          wholesalePrice: Number(product.wholesalePrice),
        }))}
      />
    </section>
  );
}
