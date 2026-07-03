import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Building2, Globe, MapPin, Megaphone, Users2 } from "lucide-react";
import { MarketingBusinessIntakeModal } from "@/components/marketing/marketing-business-intake-modal";
import { MarketingContextDetailModal } from "@/components/marketing/marketing-context-detail-modal";
import { Card } from "@/components/ui/card";
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

export default async function MarketingBusinessContextPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("marketing_ia");

  const businessContext = await getMarketingBusinessContextForUser(access.userId);
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
          card: "border-emerald-100 bg-emerald-50 shadow-sm",
          robot: "border-emerald-100 bg-emerald-50 text-emerald-500",
          eyebrow: "text-emerald-500",
          value: "text-emerald-700",
          label: "text-emerald-600",
        }
      : robot.tone === "mid"
        ? {
            card: "border-amber-100 bg-amber-50 shadow-sm",
            robot: "border-amber-100 bg-amber-50 text-amber-500",
            eyebrow: "text-amber-500",
            value: "text-amber-700",
            label: "text-amber-600",
          }
        : {
            card: "border-red-100 bg-red-50 shadow-sm",
            robot: "border-red-100 bg-red-50 text-red-500",
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
  const marketingDetailItems = [
    {
      title: "Que hace especial a tu negocio",
      value: businessContext.valueProposition || "Aun no lo has contado.",
    },
    {
      title: "A que tipo de cliente le vendes",
      value: businessContext.idealCustomer || "Aun no lo has definido.",
    },
    {
      title: "Que problema resuelves",
      value: businessContext.painPoints || "Aun no lo has explicado.",
    },
    {
      title: "Que quieres impulsar primero",
      value: businessContext.mainOffer || "Aun no hay una oferta principal.",
    },
    {
      title: "Llamado a la accion",
      value: businessContext.primaryCallToAction || "Aun no hay CTA principal.",
    },
    {
      title: "Redes y canales",
      value:
        digitalSignals.length > 0
          ? digitalSignals.join(" · ")
          : "Aun no hay redes o paginas agregadas.",
    },
  ];

  return (
    <section className="app-page space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Informacion actualizada"
        errorTitle="No pudimos guardar la informacion"
      />

      <div className="relative overflow-hidden rounded-2xl border bg-card p-6 shadow-sm sm:p-7">
        <div className="pointer-events-none absolute inset-0" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Building2 className="h-4.5 w-4.5" />
              </div>
              <h1 className="text-[1.2rem] font-semibold tracking-tight text-foreground sm:text-[1.45rem]">
                Contexto del negocio
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <MarketingBusinessIntakeModal context={businessContext} />
              <Link
                href="/cliente/marketing-ia/ads-generator"
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-2xl border border-border bg-background px-2.5 text-sm font-medium text-foreground transition-all hover:bg-muted hover:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50"
              >
                Siguiente paso
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <div className={`rounded-2xl p-4 ${progressToneClasses.card}`}>
            <div className="flex items-center gap-3">
              <div className={`flex h-20 w-20 items-center justify-center rounded-xl border text-[2.4rem] leading-none ${progressToneClasses.robot}`}>
                {robot.lines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
              <div>
                <p className={`text-xs font-semibold uppercase tracking-widest ${progressToneClasses.eyebrow}`}>Progreso</p>
                <p className={`text-2xl font-semibold tracking-tight ${progressToneClasses.value}`}>{completion}%</p>
                <p className={`text-sm ${progressToneClasses.label}`}>{robot.label}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-2xl p-6">
          <div className="mb-5 flex items-center gap-3">
            <Megaphone className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
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

        <Card className="rounded-2xl p-6">
          <div className="mb-5 flex items-center gap-3">
            <Users2 className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              Senales utiles para marketing
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
        <div className="space-y-4">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              Resporte del marketing
            </h2>
          </div>

          <MarketingContextDetailModal items={marketingDetailItems} />
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
    <div className={`rounded-2xl border bg-muted p-4 ${wide ? "md:col-span-2" : ""}`}>
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm leading-6 text-foreground">{value}</p>
    </div>
  );
}

function ContextChip({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border bg-muted p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="text-primary">{icon}</span>
        <span>{title}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}
