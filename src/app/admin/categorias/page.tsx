import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { CategoriesWorkspace } from "@/components/admin/categories-workspace";
import { leerFiltroDeNegocio, listarNegocios } from "@/lib/negocios-del-admin";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { hasAdminModuleAccess } from "@/lib/admin-module-access";
import { prisma } from "@/lib/prisma";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminCategoriasPage({ searchParams }: PageProps) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  const canAccess = await hasAdminModuleAccess(session.user.id, session.user.role, "categories");
  if (!canAccess) {
    redirect("/unauthorized");
  }

  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";

  /*
    El admin sigue viendo los NUEVE negocios (decision de Alex, 29-09-2026): no se filtra por
    defecto. El filtro de arriba es para mirar uno, no para esconder los demas.
  */
  const negocios = await listarNegocios();
  const negocioFiltrado = leerFiltroDeNegocio(params.negocio, negocios);

  const categories = await prisma.category.findMany({
    where: negocioFiltrado ? { workspaceId: negocioFiltrado } : {},
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true } }, workspace: { select: { name: true } } },
  });

  return (
    <section className="w-full space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Configuracion guardada"
        errorTitle="Error de configuracion"
      />

      <CategoriesWorkspace
        negocios={negocios}
        negocioFiltrado={negocioFiltrado}
        categories={categories.map((category) => ({
          id: category.id,
          name: category.name,
          slug: category.slug,
          logoUrl: category.logoUrl,
          productsCount: category._count.products,
          negocio: category.workspace?.name?.trim() || "Sin negocio",
        }))}
      />
    </section>
  );
}
