import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Megaphone, Sparkles } from "lucide-react";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MarketingIaPage({ searchParams }: PageProps) {
  const session = await auth();

  if (
    !session?.user?.id ||
    !session.user.role ||
    !["ADMIN", "CLIENTE"].includes(session.user.role)
  ) {
    redirect("/unauthorized");
  }

  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";

  return (
    <MarketingPageContent
      okMessage={okMessage}
      errorMessage={errorMessage}
    />
  );
}

function MarketingPageContent({
  okMessage,
  errorMessage,
}: {
  okMessage: string;
  errorMessage: string;
}) {
  return (
    <section className="app-page space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Marketing actualizado"
        errorTitle="No pudimos completar la accion"
      />

      <div className="grid gap-4">
        <div className="relative overflow-hidden rounded-[12px] border border-[var(--line)] bg-[linear-gradient(180deg,var(--surface)_0%,#f8fafc_100%)] p-6 text-[var(--foreground)] shadow-[0_24px_54px_-40px_rgba(15,23,42,0.14)] sm:p-7">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.08),transparent_26%),radial-gradient(circle_at_bottom_left,rgba(37,99,235,0.04),transparent_30%)]" />
          <div className="pointer-events-none absolute right-0 top-0 text-[color-mix(in_srgb,var(--primary)_78%,white)] opacity-10">
            <Sparkles className="h-28 w-28" strokeWidth={1.5} />
          </div>

          <div className="relative space-y-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl space-y-4">
                <div className="flex items-start gap-4">
                  <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[20px] bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                    <Megaphone className="h-5 w-5" />
                  </div>

                  <div className="space-y-3">
                    <h1 className="text-[2rem] font-semibold tracking-[-0.07em] text-slate-950 sm:text-[2.55rem]">
                      Creativos
                    </h1>

                    <p className="max-w-[60ch] text-sm leading-7 text-slate-600 sm:text-base">
                      Ahorra tiempo y conviértete en un experto en marketing con estos asistentes de IA diseñados para potenciar tus resultados.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 rounded-[26px] border border-[var(--line)] bg-white/88 p-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-950">
                  Paso 1: Entrar al estudio de anuncios
                </p>
                <p className="text-xs leading-5 text-slate-500">
                  Prepara la foto, define el enfoque y descarga los resultados.
                </p>
              </div>

              <Button asChild size="lg" className="rounded-2xl">
                <Link href="/cliente/marketing-ia/creativos">
                  Abrir modulo
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
