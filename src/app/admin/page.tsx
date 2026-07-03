import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { auth } from "@/auth";
import { getAdminModuleAccess } from "@/lib/admin-module-access";

export default async function AdminPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN" || !session.user.id) {
    redirect("/unauthorized");
  }

  const moduleAccess = await getAdminModuleAccess(session.user.id, session.user.role);

  return (
    <section className="app-page space-y-5">
      <Card className="max-w-2xl">
        <h2 className="text-base font-semibold text-foreground md:text-lg">Configuracion</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Administra todos los usuarios, cambia roles y crea nuevas cuentas.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {(moduleAccess.config_users || moduleAccess.config_business || moduleAccess.config_permissions || moduleAccess.config_whatsapp) ? (
            <Link
              href="/admin/configuracion"
              className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              Ir a configuracion
            </Link>
          ) : null}
          {moduleAccess.products ? (
            <Link
              href="/admin/productos"
              className="inline-flex rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              Gestionar productos
            </Link>
          ) : null}
          {moduleAccess.quotes ? (
            <Link
              href="/admin/cotizaciones"
              className="inline-flex rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              Gestionar cotizaciones
            </Link>
          ) : null}
        </div>
      </Card>
    </section>
  );
}
