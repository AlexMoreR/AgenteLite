import { redirect } from "next/navigation";
import { PackagePlus } from "lucide-react";
import { auth } from "@/auth";
import { NewProductForm } from "@/components/admin/new-product-form";
import { hasAdminModuleAccess } from "@/lib/admin-module-access";
import { prisma } from "@/lib/prisma";
import { getSystemCurrency } from "@/lib/system-settings";

export default async function AdminNuevoProductoPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    redirect("/unauthorized");
  }
  const canAccess = await hasAdminModuleAccess(session.user.id, session.user.role, "products");
  if (!canAccess) {
    redirect("/unauthorized");
  }
  const [categories, suppliers] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  const systemCurrency = await getSystemCurrency();

  return (
    <section className="w-full space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="inline-flex items-center gap-1 text-lg font-semibold tracking-tight text-slate-900 md:text-xl">
            <PackagePlus className="h-4 w-4 text-slate-500" />
            <span>Nuevo producto</span>
          </h1>
          <p className="mt-0.5 text-[13px] leading-5 text-slate-600">
            Define costo, porcentaje y precio final comercial antes de guardar el producto.
          </p>
        </div>
      </div>

      <NewProductForm categories={categories} suppliers={suppliers} currency={systemCurrency} />
    </section>
  );
}
