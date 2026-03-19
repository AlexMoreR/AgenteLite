import { redirect } from "next/navigation";
import { Building2, ChevronRight } from "lucide-react";
import { auth } from "@/auth";
import { completeWorkspaceOnboardingAction } from "@/app/actions/workspace-actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClienteOnboardingPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const existingWorkspace = await getPrimaryWorkspaceForUser(session.user.id);
  if (existingWorkspace) {
    redirect("/cliente");
  }

  const params = await searchParams;
  const errorMessage = typeof params.error === "string" ? params.error : "";

  return (
    <section className="app-page grid min-h-[calc(100vh-9rem)] place-items-center px-4 py-10">
      <QueryFeedbackToast
        errorMessage={errorMessage}
        okMessage=""
        errorTitle="No pudimos guardar tu negocio"
      />

      <Card className="w-full max-w-2xl space-y-6">
        <div className="space-y-2">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
              Configura tu negocio
            </h1>
            <p className="text-sm text-slate-600 md:text-base">
              Antes de crear tu primer agente, necesitamos unos datos basicos de tu empresa para preparar tu espacio de trabajo.
            </p>
          </div>
        </div>

        <form action={completeWorkspaceOnboardingAction} className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 md:col-span-2">
            <span className="text-sm font-medium text-slate-700">Nombre del negocio</span>
            <Input
              name="businessName"
              placeholder="Ej. Clinica Dental Sonrisa"
              defaultValue={session.user.name ?? ""}
              required
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Tipo de negocio</span>
            <Input
              name="businessType"
              placeholder="Ej. Restaurante, clinica, inmobiliaria"
              required
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Pais</span>
            <Input
              name="country"
              placeholder="Ej. Colombia"
              required
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Ciudad</span>
            <Input
              name="city"
              placeholder="Ej. Bogota"
              required
            />
          </label>

          <div className="md:col-span-2 flex items-center justify-between rounded-xl border border-[var(--line)] bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <p>Despues de esto te llevaremos al panel para crear tu primer agente.</p>
            <button
              type="submit"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
            >
              Continuar
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </form>
      </Card>
    </section>
  );
}
