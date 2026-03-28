import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Building2, Globe, MapPin, Megaphone, Users2 } from "lucide-react";
import { auth } from "@/auth";
import { MarketingBusinessIntakeModal } from "@/components/marketing/marketing-business-intake-modal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

export default async function MarketingBusinessContextPage({ searchParams }: PageProps) {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const businessContext = await getMarketingBusinessContextForUser(session.user.id);
  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";

  if (!businessContext) {
    redirect("/cliente/onboarding?returnTo=/cliente/marketing-ia/contexto-negocio");
  }

  const completion = getMarketingContextCompletion(businessContext);
  const robot = getMarketingRobotMood(completion);
  const progressToneClasses =
    robot.tone === "ready"
      ? {
          card: "border-emerald-100 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(240,253,244,0.96))] shadow-[0_16px_30px_-24px_rgba(5,150,105,0.2)]",
          robot: "border-emerald-100 bg-[linear-gradient(180deg,#f7fffb,#ecfdf5)] text-emerald-500",
          eyebrow: "text-emerald-500",
          value: "text-emerald-700",
          label: "text-emerald-600",
        }
      : robot.tone === "mid"
        ? {
            card: "border-amber-100 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,251,235,0.96))] shadow-[0_16px_30px_-24px_rgba(217,119,6,0.18)]",
            robot: "border-amber-100 bg-[linear-gradient(180deg,#fffdf7,#fffbeb)] text-amber-500",
            eyebrow: "text-amber-500",
            value: "text-amber-700",
            label: "text-amber-600",
          }
        : {
            card: "border-red-100 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,244,244,0.96))] shadow-[0_16px_30px_-24px_rgba(127,29,29,0.18)]",
            robot: "border-red-100 bg-[linear-gradient(180deg,#fff8f8,#fff0f0)] text-red-500",
            eyebrow: "text-red-400",
            value: "text-red-700",
            label: "text-red-500",
          };
  const digitalSignals = [
    businessContext.websiteUrl,
    businessContext.instagramUrl,
    businessContext.facebookUrl,
    businessContext.tiktokUrl,
  ].filter(Boolean);

  return (
    <section className="app-page space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Informacion actualizada"
        errorTitle="No pudimos guardar la informacion"
      />

      <div className="relative overflow-hidden rounded-[28px] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(240,247,255,0.94))] p-6 shadow-[0_24px_54px_-40px_rgba(15,23,42,0.14)] sm:p-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.12),transparent_30%)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-[16px] bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                <Building2 className="h-4.5 w-4.5" />
              </div>
              <h1 className="text-[1.2rem] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[1.45rem]">
                Contexto del negocio
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-[20px] border border-[var(--line)] bg-white/85 p-3 shadow-[0_16px_32px_-28px_rgba(15,23,42,0.22)]">
              <MarketingBusinessIntakeModal context={businessContext} />

              <Button asChild variant="outline" size="lg" className="rounded-2xl">
                <Link href="/cliente/marketing-ia/creativos">
                  Ir a Creativos
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>

          <div className={`rounded-[24px] p-4 ${progressToneClasses.card}`}>
            <div className="flex items-center gap-3">
              <div className={`flex h-20 w-20 items-center justify-center rounded-[18px] border text-[2.4rem] leading-none ${progressToneClasses.robot}`}>
                {robot.lines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
              <div>
                <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${progressToneClasses.eyebrow}`}>Progreso</p>
                <p className={`text-2xl font-semibold tracking-[-0.04em] ${progressToneClasses.value}`}>{completion}%</p>
                <p className={`text-sm ${progressToneClasses.label}`}>{robot.label}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-[28px] p-6">
          <div className="mb-5 flex items-center gap-3">
            <Megaphone className="h-5 w-5 text-[var(--primary)]" />
            <h2 className="text-xl font-semibold tracking-[-0.04em] text-slate-950">
              Informacion base del negocio
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <InfoBlock label="Negocio" value={businessContext.businessName} />
            <InfoBlock label="Tipo de negocio" value={businessContext.businessType ?? "Pendiente"} />
            <InfoBlock label="Pais" value={businessContext.country ?? "Pendiente"} />
            <InfoBlock label="Ciudad" value={businessContext.city ?? "Pendiente"} />
            <InfoBlock
              label="Que vende"
              value={businessContext.businessDescription ?? "Aun no hay una descripcion comercial guardada."}
              wide
            />
          </div>
        </Card>

        <Card className="rounded-[28px] p-6">
          <div className="mb-5 flex items-center gap-3">
            <Users2 className="h-5 w-5 text-[var(--primary)]" />
            <h2 className="text-xl font-semibold tracking-[-0.04em] text-slate-950">
              Señales utiles para marketing
            </h2>
          </div>

          <div className="space-y-3">
            <ContextChip
              icon={<Users2 className="h-4 w-4" />}
              title="Audiencia"
              body={
                businessContext.targetAudiences.length > 0
                  ? businessContext.targetAudiences.join(", ")
                  : "Aun no hay audiencias guardadas desde el agente."
              }
            />
            <ContextChip
              icon={<Megaphone className="h-4 w-4" />}
              title="Tono comercial"
              body={businessContext.salesTone ?? "Aun no hay tono definido para marketing."}
            />
            <ContextChip
              icon={<MapPin className="h-4 w-4" />}
              title="Cobertura"
              body={[businessContext.city, businessContext.country].filter(Boolean).join(", ") || "Pendiente"}
            />
            <ContextChip
              icon={<Globe className="h-4 w-4" />}
              title="Redes y paginas"
              body={
                digitalSignals.length > 0
                  ? digitalSignals.join(" · ")
                  : "Aun faltan datos digitales para que la IA entienda mejor como promocionar tu negocio."
              }
            />
          </div>
        </Card>
      </div>

      <Card className="rounded-[28px] p-6">
        <div className="mb-5 space-y-4">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold tracking-[-0.04em] text-slate-950">
              Cuéntale a la IA como funciona tu negocio
            </h2>
            <p className="max-w-[68ch] text-sm leading-6 text-slate-600">
              Responde preguntas faciles y rapidas. El agente experto en marketing usara esto para
              entender tu negocio, proponer mensajes y definir mejor la estrategia.
            </p>
          </div>

        </div>

        <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[26px] border border-[var(--line)] bg-[linear-gradient(180deg,#ffffff,#f8fbff)] p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <SummaryItem
                title="Que hace especial a tu negocio"
                value={businessContext.valueProposition || "Aun no lo has contado."}
              />
              <SummaryItem
                title="A que tipo de cliente le vendes"
                value={businessContext.idealCustomer || "Aun no lo has definido."}
              />
              <SummaryItem
                title="Que problema resuelves"
                value={businessContext.painPoints || "Aun no lo has explicado."}
              />
              <SummaryItem
                title="Que quieres impulsar primero"
                value={businessContext.mainOffer || "Aun no hay una oferta principal."}
              />
            </div>
          </div>

          <div className="rounded-[26px] border border-[var(--line)] bg-[linear-gradient(180deg,#ffffff,#f8fbff)] p-5">
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-950">Asistente guiado</p>
                <p className="text-sm leading-6 text-slate-600">
                  Usa el modal guiado para contarle a la IA lo basico del negocio y dejar lista la base para marketing.
                </p>
              </div>

              <div className="space-y-2 rounded-[20px] border border-[var(--line)] bg-slate-50 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Incluye
                </p>
                <p className="text-sm leading-6 text-slate-700">
                  Diferencial, cliente ideal, problema, oferta principal, CTA y redes.
                </p>
              </div>

            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}

function InfoBlock({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={`rounded-[22px] border border-[var(--line)] bg-slate-50 p-4 ${wide ? "md:col-span-2" : ""}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm leading-6 text-slate-800">{value}</p>
    </div>
  );
}

function ContextChip({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[22px] border border-[var(--line)] bg-slate-50 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className="text-[var(--primary)]">{icon}</span>
        <span>{title}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
    </div>
  );
}

function SummaryItem({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-[var(--line)] bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-700">{value}</p>
    </div>
  );
}
