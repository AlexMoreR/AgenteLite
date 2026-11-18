import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { auth } from "@/auth";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import {
  canAccessClientModule,
  getClientWorkspaceAccessForUser,
  requireClientWorkspaceAccess,
} from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClientePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  if (session.user.role === "EMPLEADO") {
    await requireClientWorkspaceAccess(undefined, { redirectTo: "/unauthorized" });
  }

  /**
   * Al entrar, todos (asesoras y dueño) caen directo en la bandeja de Chats: hay que contestar
   * rápido y antes se perdía un paso pasando por "Mi día".
   *
   * Si la persona no puede ver Chats se prueba con "Mi día" (módulo CRM), y si tampoco, se queda
   * acá en la bienvenida (mejor una bienvenida que un "no autorizado"). El dueño que todavía no
   * creó su negocio no tiene acceso (access es null) y también se queda acá, porque necesita el
   * botón "Comenzar". El rol ADMIN no cambia: entra por /admin.
   */
  if (session.user.role !== "ADMIN") {
    const access = await getClientWorkspaceAccessForUser(session.user.id);
    if (access) {
      if (canAccessClientModule(access, "chats")) {
        redirect("/cliente/chats");
      }
      if (canAccessClientModule(access, "crm")) {
        redirect("/cliente/crm/mi-dia");
      }
    }
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const hasWorkspace = Boolean(membership);
  const firstName = session.user.name?.trim().split(/\s+/)[0] ?? "";
  const welcomeHeading = firstName ? `Bienvenido ${firstName}` : "Bienvenido";

  return (
    <section className="app-page space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage=""
        okTitle="Tu negocio ya esta listo"
      />

      <div className="relative overflow-hidden rounded-[28px] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(240,247,255,0.94))] p-5 shadow-[0_24px_54px_-40px_rgba(15,23,42,0.14)] sm:p-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.1),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.08),transparent_30%)]" />
        <div className="pointer-events-none absolute right-0 top-0 text-[color-mix(in_srgb,var(--primary)_78%,white)] opacity-10">
          <Sparkles className="h-28 w-28" strokeWidth={1.5} />
        </div>

        <div className="relative grid gap-5 xl:grid-cols-[1.25fr_0.75fr] xl:items-start">
          <div className="space-y-4">
            <div className="space-y-2">
              <h1 className="max-w-[14ch] text-[1.95rem] font-semibold tracking-[-0.06em] text-slate-950 sm:text-[2.5rem]">
                {welcomeHeading}
              </h1>
              <p className="max-w-[62ch] text-sm leading-6 text-slate-600 sm:text-[15px]">
                {hasWorkspace
                  ? "Tu espacio ya esta listo para operar. Desde aqui puedes crear agentes, conectar canales y preparar Marketing IA con el mismo contexto del negocio."
                  : "Automatiza tu negocio en solo lugar potenciado con ia."}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href={hasWorkspace ? "/cliente/marketing-ia" : "/cliente/onboarding?returnTo=/cliente/marketing-ia"}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-5 text-sm font-medium text-white shadow-[0_16px_30px_-18px_rgba(37,99,235,0.45)] transition hover:translate-y-[-1px] hover:bg-[var(--primary-strong)]"
              >
                {hasWorkspace ? "Ir a Marketing IA" : "Comenzar"}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>

    </section>
  );
}
