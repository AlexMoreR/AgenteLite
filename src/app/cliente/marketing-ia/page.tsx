import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Globe,
  Megaphone,
  Sparkles,
  Users2,
} from "lucide-react";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
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
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";
  const businessContext = await getMarketingBusinessContextForUser(session.user.id);

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

function getMotivationalBusinessLine(
  context: Awaited<ReturnType<typeof getMarketingBusinessContextForUser>>,
) {
  const businessName = context?.businessName?.trim();
  if (businessName) {
    return `${formatDisplayName(businessName)} tiene potencial. Completa los datos para crear un marketing mas claro y efectivo.`;
  }

  return "Tu negocio tiene potencial. Completa los datos para crear un marketing mas claro y efectivo.";
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
  const motivationalLine = getMotivationalBusinessLine(businessContext);
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
        <div className="relative overflow-hidden rounded-[12px] border border-[var(--line)] bg-[linear-gradient(180deg,var(--surface)_0%,#f8fafc_100%)] p-4 text-[var(--foreground)] shadow-[0_24px_54px_-40px_rgba(15,23,42,0.14)] sm:p-7">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.08),transparent_26%),radial-gradient(circle_at_bottom_left,rgba(37,99,235,0.04),transparent_30%)]" />
          <div className="pointer-events-none absolute right-0 top-0 text-[color-mix(in_srgb,var(--primary)_78%,white)] opacity-10">
            <Sparkles className="h-28 w-28" strokeWidth={1.5} />
          </div>

          <div className="relative space-y-3 sm:space-y-4">
            <div className="flex items-start gap-3 sm:gap-4">
              <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)] sm:h-12 sm:w-12 sm:rounded-[20px]">
                <Megaphone className="h-4.5 w-4.5 sm:h-5 sm:w-5" />
              </div>

              <div className="space-y-2 sm:space-y-3">
                <h1 className="text-[1.4rem] font-semibold tracking-[-0.06em] text-slate-950 sm:text-[2.55rem]">
                  Marketing IA
                </h1>

                <p className="max-w-[60ch] text-[13px] leading-6 text-slate-600 sm:text-base sm:leading-7">
                  Organiza primero el contexto comercial de tu negocio y luego crea piezas, anuncios y mensajes con mejor criterio.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <Link
            href="/cliente/marketing-ia/contexto-negocio"
            className="group relative overflow-hidden rounded-[26px] border border-[color:color-mix(in_srgb,var(--primary)_14%,white)] bg-[linear-gradient(135deg,rgba(255,255,255,0.98)_0%,rgba(240,246,255,0.96)_52%,rgba(232,241,255,0.98)_100%)] p-3.5 shadow-[0_20px_52px_-42px_rgba(37,99,235,0.2)] transition hover:-translate-y-0.5 hover:shadow-[0_26px_60px_-44px_rgba(37,99,235,0.24)] sm:p-4"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.13),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.08),transparent_34%)]" />
            <div className="pointer-events-none absolute right-4 top-4 h-16 w-16 rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.16),transparent_66%)] blur-2xl" />

            <div className="relative space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(228,237,255,0.92))] text-[var(--primary)] shadow-[0_12px_20px_-18px_rgba(37,99,235,0.42)]">
                    <Building2 className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <div className="space-y-1.5">
                      <h2 className="max-w-[20ch] text-[1rem] font-semibold tracking-[-0.04em] text-slate-950 sm:max-w-none sm:text-[1.1rem]">
                        Agente conoce tu negocio
                      </h2>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex rounded-full border border-[color:color-mix(in_srgb,var(--primary)_20%,white)] bg-white/86 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--primary)]">
                          Paso 1
                        </span>
                      </div>
                      <p className="max-w-[44ch] text-[12px] leading-5 text-slate-600 sm:max-w-[58ch] sm:text-[13px]">
                        {motivationalLine}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex w-full items-center gap-2 rounded-[18px] border border-red-100 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,244,244,0.96))] px-3 py-2 shadow-[0_14px_24px_-22px_rgba(127,29,29,0.18)] sm:w-auto">
                  <div className="rounded-[12px] border border-red-100 bg-[linear-gradient(180deg,#fff8f8,#fff0f0)] px-2 py-1 font-mono text-[8px] leading-[0.9] text-red-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
                    {robot.lines.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>

                  <div className="min-w-0 flex-1 sm:min-w-[82px] sm:flex-none">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-red-400">
                      Progreso
                    </p>
                    <p className="text-[0.95rem] font-semibold text-red-700">{completion}%</p>
                    <p className="text-[11px] leading-4 text-red-500">
                      {isIncomplete ? `Agente ${robot.label.toLowerCase()}` : "Listo"}
                    </p>
                  </div>

                  <div className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--primary)] text-white shadow-[0_14px_22px_-18px_rgba(37,99,235,0.68)] transition group-hover:translate-x-0.5">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </div>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-[0.72fr_1.05fr_0.95fr]">
                <div className="rounded-[20px] border border-white/85 bg-white/92 p-3.5 shadow-[0_14px_24px_-22px_rgba(15,23,42,0.13)]">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Negocio
                  </p>
                  <p className="mt-2 text-[1rem] font-semibold tracking-[-0.04em] text-slate-950">
                    {businessContext?.businessName
                      ? formatDisplayName(businessContext.businessName)
                      : "Negocio sin configurar"}
                  </p>
                </div>

                <div className="rounded-[20px] border border-white/85 bg-white/92 p-3.5 shadow-[0_14px_24px_-22px_rgba(15,23,42,0.13)]">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Que vende
                  </p>
                  <p className="mt-2 max-w-[40ch] text-[13px] leading-5 text-slate-700 sm:text-[14px]">
                    {businessContext?.businessDescription ?? "Aun no hay descripcion comercial."}
                  </p>
                </div>

                <div className="rounded-[20px] border border-white/85 bg-white/92 p-3.5 shadow-[0_14px_24px_-22px_rgba(15,23,42,0.13)]">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
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

          <div className="relative overflow-hidden rounded-[32px] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.95))] p-4 shadow-[0_24px_54px_-42px_rgba(15,23,42,0.14)] sm:p-6">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.06),transparent_24%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.05),transparent_28%)]" />
            <div className="relative space-y-4 sm:space-y-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-5">
                <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
                  <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)] sm:h-14 sm:w-14 sm:rounded-[22px]">
                    <Sparkles className="h-5 w-5 sm:h-6 sm:w-6" />
                  </div>
                  <div className="space-y-1.5 sm:space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 sm:text-xs sm:tracking-[0.22em]">
                      Paso 2
                    </p>
                    <h2 className="text-[1.15rem] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[1.7rem] sm:tracking-[-0.05em]">
                      Creativos y anuncios
                    </h2>
                    <p className="max-w-[70ch] text-[13px] leading-5 text-slate-600 sm:text-sm sm:leading-6">
                      Usa el contexto del negocio y luego entra al estudio visual para preparar piezas, anuncios y mensajes listos para trabajar.
                    </p>
                  </div>
                </div>

                <Button asChild size="lg" className="h-11 w-full rounded-2xl sm:w-auto">
                  <Link href="/cliente/marketing-ia/creativos">
                    Abrir modulo
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>

              <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-[24px] border border-[var(--line)] bg-white/88 p-4">
                  <p className="text-[13px] font-semibold text-slate-950 sm:text-sm">
                    Siguiente paso: entrar al estudio de anuncios
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-slate-500">
                    Prepara la foto, define el enfoque y descarga los resultados.
                  </p>
                </div>

                <div className="rounded-[24px] border border-[var(--line)] bg-white/88 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 sm:text-[11px]">
                    Flujo
                  </p>
                  <p className="mt-2 text-[13px] leading-5 text-slate-700 sm:text-sm sm:leading-6">
                    Contexto del negocio primero, creativos despues y anuncios con una base comercial mas solida.
                  </p>
                </div>
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
          ? "inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
          : "inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700"
      }
    >
      {tone === "ready" ? <CheckCircle2 className="h-3.5 w-3.5" /> : icon}
      {label}
    </span>
  );
}
