import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ImagePlus, Megaphone, Sparkles } from "lucide-react";
import { auth } from "@/auth";
import { Card } from "@/components/ui/card";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { countMarketingGenerations } from "@/lib/marketing-store";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClienteMarketingIaPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente?error=Debes+configurar+tu+negocio+primero");
  }

  const [params, generationCount] = await Promise.all([
    searchParams,
    countMarketingGenerations(membership.workspace.id),
  ]);

  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";

  return (
    <section className="w-full space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Marketing IA actualizado"
        errorTitle="No pudimos abrir el modulo"
      />

      <Card className="space-y-4 border border-[rgba(148,163,184,0.14)] bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950 md:text-3xl">Marketing IA</h1>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
                Un estudio creativo para generar anuncios, copies e imagenes desde el contexto de tu negocio.
              </p>
            </div>
          </div>

          <Link
            href="/cliente/marketing-ia/facebook-ads"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
          >
            Abrir Facebook Ads
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <Link href="/cliente/marketing-ia/facebook-ads" className="group">
          <Card className="h-full space-y-4 border border-[rgba(148,163,184,0.14)] bg-white p-6 transition hover:border-[var(--primary)]/30 hover:shadow-[0_18px_44px_-34px_rgba(15,23,42,0.22)]">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
              <Megaphone className="h-6 w-6" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-slate-950">Generador Facebook Ads</h2>
              <p className="text-sm leading-7 text-slate-600">
                Crea 3 variaciones de copy, CTA sugerido, prompt visual e imagen generada con OpenAI para tus anuncios.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 text-sm font-medium text-[var(--primary)]">
              Entrar a la herramienta
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </div>
          </Card>
        </Link>

        <Card className="space-y-4 border border-[rgba(148,163,184,0.14)] bg-white p-6">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            <ImagePlus className="h-6 w-6" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-slate-950">Estado del modulo</h2>
            <p className="text-sm leading-7 text-slate-600">
              Ya puedes generar piezas para Facebook Ads y conservar un historial por workspace.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 px-4 py-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Workspace</p>
              <p className="mt-2 text-sm font-medium text-slate-900">{membership.workspace.name}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Generaciones</p>
              <p className="mt-2 text-sm font-medium text-slate-900">{generationCount}</p>
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}
