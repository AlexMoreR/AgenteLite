import { notFound, redirect } from "next/navigation";
import { PackageSearch } from "lucide-react";
import { auth } from "@/auth";
import { EditProductForm } from "@/components/admin/edit-product-form";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { hasAdminModuleAccess } from "@/lib/admin-module-access";
import { prisma } from "@/lib/prisma";
import { getSystemCurrency } from "@/lib/system-settings";

type PageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminProductoDetallePage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  const canAccess = await hasAdminModuleAccess(session.user.id, session.user.role, "products");
  if (!canAccess) {
    redirect("/unauthorized");
  }

  const [{ productId }, query] = await Promise.all([params, searchParams]);
  const okMessage = typeof query.ok === "string" ? query.ok : "";
  const errorMessage = typeof query.error === "string" ? query.error : "";

  const [product, categories, suppliers, systemCurrency] = await Promise.all([
    prisma.product.findUnique({
      where: { id: productId },
      include: {
        category: true,
        images: { orderBy: { order: "asc" } },
        suppliers: {
          where: { isPreferred: true },
          include: { supplier: true },
          take: 1,
        },
      },
    }),
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    getSystemCurrency(),
  ]);

  if (!product) {
    notFound();
  }

  return (
    <section className="w-full space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="inline-flex items-center gap-1 text-lg font-semibold tracking-tight text-slate-900 md:text-xl">
            <PackageSearch className="h-4 w-4 text-slate-500" />
            <span>{product.name}</span>
          </h1>
          <p className="mt-0.5 text-[13px] leading-5 text-slate-600">
            Visualiza y ajusta costo, sugerencia y precio final con el mismo flujo del formulario de creacion.
          </p>
        </div>
      </div>

      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Producto actualizado"
        errorTitle="Error al guardar"
      />

      <EditProductForm
        categories={categories}
        suppliers={suppliers}
        currency={systemCurrency}
          initialData={{
            id: product.id,
            code: product.code,
            name: product.name,
            description: product.description,
            baseCost: Number(product.baseCost),
            price: Number(product.price),
            wholesalePrice: Number(product.wholesalePrice),
            retailMarginPct: Number(product.retailMarginPct),
            wholesaleMarginPct: Number(product.wholesaleMarginPct),
          minWholesaleQty: product.minWholesaleQty,
          categoryId: product.categoryId,
          supplierId: product.suppliers[0]?.supplier.id ?? null,
          imageUrls: product.images.map((image) => image.url),
        }}
      />
    </section>
  );
}
