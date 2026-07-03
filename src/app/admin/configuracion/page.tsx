import Link from "next/link";
import { redirect } from "next/navigation";
import { LockKeyhole, MessageSquareMore, Settings, Users } from "lucide-react";
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
        <h1 className="text-lg font-semibold tracking-tight text-foreground md:text-xl">Configuracion</h1>
        <p className="text-[13px] leading-5 text-muted-foreground">
          Elige el apartado que quieres administrar.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {moduleAccess.config_users ? (
          <Link href="/admin/configuracion/usuarios" className="group">
            <Card className="h-full space-y-3 border border-border transition hover:border-primary hover:shadow-lg">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Users className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-foreground">Usuarios</h2>
                <p className="text-sm text-muted-foreground">
                  Crea cuentas y administra roles y accesos.
                </p>
              </div>
            </Card>
          </Link>
        ) : null}

        {moduleAccess.config_business ? (
          <Link href="/admin/configuracion/negocio" className="group">
            <Card className="h-full space-y-3 border border-border transition hover:border-primary hover:shadow-lg">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Settings className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-foreground">Configuracion negocio</h2>
                <p className="text-sm text-muted-foreground">
                  Ajusta moneda activa, color primario y preferencias generales.
                </p>
              </div>
            </Card>
          </Link>
        ) : null}

        {moduleAccess.config_permissions ? (
          <Link href="/admin/configuracion/permisos" className="group">
            <Card className="h-full space-y-3 border border-border transition hover:border-primary hover:shadow-lg">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <LockKeyhole className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-foreground">Control de modulos</h2>
                <p className="text-sm text-muted-foreground">
                  Oculta y restringe modulos administrativos por usuario.
                </p>
              </div>
            </Card>
          </Link>
        ) : null}

        {moduleAccess.config_whatsapp ? (
          <Link href="/admin/configuracion/whatsapp" className="group">
            <Card className="h-full space-y-3 border border-border transition hover:border-primary hover:shadow-lg">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <MessageSquareMore className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-foreground">Configuracion WhatsApp</h2>
                <p className="text-sm text-muted-foreground">
                  Define la conexion global con Evolution API para toda la aplicacion.
                </p>
              </div>
            </Card>
          </Link>
        ) : null}
      </div>

      {!moduleAccess.config_users && !moduleAccess.config_business && !moduleAccess.config_permissions && !moduleAccess.config_whatsapp ? (
        <Card className="text-sm text-muted-foreground">
          No tienes apartados habilitados dentro de configuracion.
        </Card>
      ) : null}
    </section>
  );
}
