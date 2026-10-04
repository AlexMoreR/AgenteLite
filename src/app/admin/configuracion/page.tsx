import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, LockKeyhole, MessageSquareMore, Settings, Users, type LucideIcon } from "lucide-react";
import { auth } from "@/auth";
import { getAdminModuleAccess } from "@/lib/admin-module-access";

type Apartado = {
  href: string;
  titulo: string;
  descripcion: string;
  icono: LucideIcon;
  color: string;
};

export default async function AdminConfiguracionPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN" || !session.user.id) {
    redirect("/unauthorized");
  }

  const moduleAccess = await getAdminModuleAccess(session.user.id, session.user.role);

  const apartados: Apartado[] = [
    moduleAccess.config_users && {
      href: "/admin/configuracion/usuarios",
      titulo: "Usuarios",
      descripcion: "Crea cuentas y administra roles y accesos.",
      icono: Users,
      color: "bg-sky-500",
    },
    moduleAccess.config_business && {
      href: "/admin/configuracion/negocio",
      titulo: "Negocio",
      descripcion: "Moneda, color principal y preferencias generales.",
      icono: Settings,
      color: "bg-slate-500",
    },
    moduleAccess.config_permissions && {
      href: "/admin/configuracion/permisos",
      titulo: "Control de módulos",
      descripcion: "Oculta y restringe módulos por usuario.",
      icono: LockKeyhole,
      color: "bg-amber-500",
    },
    moduleAccess.config_whatsapp && {
      href: "/admin/configuracion/whatsapp",
      titulo: "WhatsApp",
      descripcion: "Conexión global de WhatsApp para toda la aplicación.",
      icono: MessageSquareMore,
      color: "bg-emerald-500",
    },
  ].filter(Boolean) as Apartado[];

  return (
    <section className="mx-auto w-full max-w-2xl p-4 md:p-6">
      {apartados.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {apartados.map(({ href, titulo, descripcion, icono: Icono, color }) => (
            <li key={href}>
              <Link
                href={href}
                className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/60 active:bg-muted"
              >
                <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white ${color}`}>
                  <Icono className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold leading-5 text-foreground">{titulo}</span>
                  <span className="mt-0.5 block text-[13px] leading-5 text-muted-foreground">{descripcion}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          No tienes apartados habilitados dentro de configuración.
        </p>
      )}
    </section>
  );
}
