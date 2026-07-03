import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Globe,
  Sparkles,
  Users2,
} from "lucide-react";
import { MarketingIaResetButton } from "@/components/marketing/marketing-ia-reset-button";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import {
  getMarketingBusinessContextForUser,
  getMarketingContextCompletion,
  getMarketingRobotMood,
} from "@/lib/marketing-business-context";

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
  const access = await requireClientWorkspaceAccess("marketing_ia");

  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";
  const businessContext = await getMarketingBusinessContextForUser(access.userId);

  return (
    <MarketingPageContent
      okMessage={okMessage}
      errorMessage={errorMessage}
      businessContext={businessContext}
    />
  );
}

function formatDisplayName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function MarketingPageContent({
  okMessage,
  errorMessage,
  businessContext,
}: {
  okMessage: string;
  errorMessage: string;
  businessContext: Awaited<ReturnType<typeof getMarketingBusinessContextForUser>>;
}) {
  const completion = getMarketingContextCompletion(businessContext);
  const isIncomplete = completion < 100;
  const robot = getMarketingRobotMood(completion);

  return (
    <section className="app-page space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Marketing actualizado"
        errorTitle="No pudimos completar la accion"
      />

      <div className="grid gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Marketing IA</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Prepara el contexto del negocio y crea anuncios con el mismo lenguaje visual del resto del workspace.
            </p>
          </div>

          <div className="sm:pt-1">
            <MarketingIaResetButton />
          </div>
        </div>

        <div className="grid gap-4">
          <Link
            href="/cliente/marketing-ia/contexto-negocio"
            className="group relative overflow-hidden rounded-2xl border border-primary/20 bg-card p-3.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:p-4"
          >
            <div className="pointer-events-none absolute inset-0" />
            <div className="pointer-events-none absolute right-4 top-4 h-16 w-16 rounded-full blur-2xl" />

            <div className="relative space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-primary shadow-sm">
                    <Building2 className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <div className="space-y-1.5">
                      <h2 className="max-w-[20ch] text-base font-semibold tracking-tight text-foreground sm:max-w-none sm:text-[1.1rem]">
                        Agente conoce tu negocio
                      </h2>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex rounded-full border border-primary/20 bg-background/80 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-primary">
                          Paso 1
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex w-full items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 shadow-sm sm:w-auto">
                  <div className="text-[1.2rem] leading-none">
                    {robot.lines.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>

                  <div className="min-w-0 flex-1 sm:min-w-[82px] sm:flex-none">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-red-400">
                      Progreso
                    </p>
                    <p className="text-[0.95rem] font-semibold text-red-700">{completion}%</p>
                    <p className="text-xs leading-4 text-red-500">
                      {isIncomplete ? `Agente ${robot.label.toLowerCase()}` : "Listo"}
                    </p>
                  </div>

                  <div className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition group-hover:translate-x-0.5">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </div>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-[0.72fr_1.05fr_0.95fr]">
                <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Negocio
                  </p>
                  <p className="mt-2 text-base font-semibold tracking-tight text-foreground">
                    {businessContext?.businessName
                      ? formatDisplayName(businessContext.businessName)
                      : "Negocio sin configurar"}
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Que vende
                  </p>
                  <p className="mt-2 max-w-[40ch] text-[13px] leading-5 text-foreground sm:text-[14px]">
                    {businessContext?.businessDescription ?? "Aun no hay descripcion comercial."}
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Audiencia y redes
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusChip
                      icon={<Users2 className="h-3.5 w-3.5" />}
                      label={businessContext?.targetAudiences.length ? "Audiencia definida" : "Audiencia pendiente"}
                      tone={businessContext?.targetAudiences.length ? "ready" : "pending"}
                    />
                    <StatusChip
                      icon={<Globe className="h-3.5 w-3.5" />}
                      label={
                        businessContext?.socialStatus === "ready" || businessContext?.websiteStatus === "ready"
                          ? "Redes o paginas listas"
                          : "Redes y paginas pendientes"
                      }
                      tone={
                        businessContext?.socialStatus === "ready" || businessContext?.websiteStatus === "ready"
                          ? "ready"
                          : "pending"
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          </Link>

          <div className="relative overflow-hidden rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
            <div className="pointer-events-none absolute inset-0" />
            <div className="relative space-y-4 sm:space-y-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-5">
                <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
                  <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:h-14 sm:w-14 sm:rounded-2xl">
                    <Sparkles className="h-5 w-5 sm:h-6 sm:w-6" />
                  </div>
                  <div className="space-y-1.5 sm:space-y-2">
                    <h2 className="text-[1.15rem] font-semibold tracking-tight text-foreground sm:text-[1.7rem] sm:tracking-tight">
                      Generador de anuncios
                    </h2>
                  </div>
                </div>

                <Link
                  href="/cliente/marketing-ia/ads-generator"
                  className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-2xl bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/80 sm:w-auto"
                >
                  Abrir modulo
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatusChip({
  icon,
  label,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  tone: "ready" | "pending";
}) {
  return (
    <span
      className={
        tone === "ready"
          ? "inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
          : "inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
      }
    >
      {tone === "ready" ? <CheckCircle2 className="h-3.5 w-3.5" /> : icon}
      {label}
    </span>
  );
}
