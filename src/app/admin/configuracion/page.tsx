import Link from "next/link";
import { redirect } from "next/navigation";
import { LockKeyhole, Settings, Users } from "lucide-react";
import { auth } from "@/auth";
import { Card } from "@/components/ui/card";
import { getAdminModuleAccess } from "@/lib/admin-module-access";

export default async function AdminConfiguracionPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN" || !session.user.id) {
    redirect("/unauthorized");
  }

  const moduleAccess = await getAdminModuleAccess(session.user.id, session.user.role);

  return (
    <section className="w-full space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight text-slate-900 md:text-xl">Configuracion</h1>
        <p className="text-[13px] leading-5 text-slate-600">
          Elige el apartado que quieres administrar.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {moduleAccess.config_users ? (
          <Link href="/admin/configuracion/usuarios" className="group">
            <Card className="h-full space-y-3 border border-[var(--line)] transition hover:border-[var(--primary)] hover:shadow-lg">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                <Users className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-900">Usuarios</h2>
                <p className="text-sm text-slate-600">
                  Crea cuentas y administra roles y accesos.
                </p>
              </div>
            </Card>
          </Link>
        ) : null}

        {moduleAccess.config_business ? (
          <Link href="/admin/configuracion/negocio" className="group">
            <Card className="h-full space-y-3 border border-[var(--line)] transition hover:border-[var(--primary)] hover:shadow-lg">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                <Settings className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-900">Configuracion negocio</h2>
                <p className="text-sm text-slate-600">
                  Ajusta moneda activa, color primario y preferencias generales.
                </p>
              </div>
            </Card>
          </Link>
        ) : null}

        {moduleAccess.config_permissions ? (
          <Link href="/admin/configuracion/permisos" className="group">
            <Card className="h-full space-y-3 border border-[var(--line)] transition hover:border-[var(--primary)] hover:shadow-lg">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                <LockKeyhole className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-900">Control de modulos</h2>
                <p className="text-sm text-slate-600">
                  Oculta y restringe modulos administrativos por usuario.
                </p>
              </div>
            </Card>
          </Link>
        ) : null}
      </div>

      {!moduleAccess.config_users && !moduleAccess.config_business && !moduleAccess.config_permissions ? (
        <Card className="text-sm text-slate-600">
          No tienes apartados habilitados dentro de configuracion.
        </Card>
      ) : null}
    </section>
  );
}
