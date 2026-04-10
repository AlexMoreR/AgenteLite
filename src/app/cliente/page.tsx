import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { auth } from "@/auth";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { getAdminModuleAccess } from "@/lib/admin-module-access";
import { getOfficialApiConfigByWorkspaceId } from "@/lib/official-api-config";
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
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  const params = await searchParams;
  const okMessage = typeof params.ok === "string" ? params.ok : "";
  const agentCount = membership?.workspace._count.agents ?? 0;
  const channelCount = membership?.workspace._count.channels ?? 0;
  const hasWorkspace = Boolean(membership);
  const officialApiConfig = membership?.workspace.id
    ? await getOfficialApiConfigByWorkspaceId(membership.workspace.id)
    : null;
  const moduleAccess = await getAdminModuleAccess(session.user.id, session.user.role);
  const canSeeOfficialApiModule = session.user.role === "ADMIN" || moduleAccess.client_official_api;
  const officialApiEnabled = officialApiConfig?.status === "CONNECTED";
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

      <div className="grid gap-4 lg:grid-cols-4">
        <DashboardModuleCard
          title="Atencion IA"
          description="Configura personalidad, tono comercial, reglas y activacion de tu asistente de atencion."
          metric={hasWorkspace ? `${agentCount} creados` : "Requiere negocio configurado"}
          href={hasWorkspace ? "/cliente/agentes" : "/cliente/onboarding?returnTo=/cliente/agentes"}
          cta={hasWorkspace ? "Administrar atencion" : "Comenzar"}
        />
        <DashboardModuleCard
          title="Canales"
          description="Conecta WhatsApp por agente y organiza las entradas de conversacion desde un solo lugar."
          metric={`${channelCount} conectados`}
          href="/cliente/agentes"
          cta="Ver canales"
        />
        <DashboardModuleCard
          title="Marketing IA"
          description="Construye contexto, genera creativos y pasa a anuncios listos para Meta Ads Manager."
          metric={hasWorkspace ? "Creativos + Ads Generator" : "Requiere negocio configurado"}
          href={hasWorkspace ? "/cliente/marketing-ia" : "/cliente/onboarding?returnTo=/cliente/marketing-ia"}
          cta="Abrir modulo"
        />
        {canSeeOfficialApiModule ? (
          <DashboardModuleCard
            title="Api oficial"
            description={
              officialApiEnabled
                ? "Tu canal oficial ya esta activo y listo para operar con resumen y bandeja de chats."
                : "Prepara la base multi-tenant para conectar clientes con WhatsApp Cloud API oficial de Meta."
            }
            metric={
              !hasWorkspace
                ? "Requiere negocio configurado"
                : officialApiEnabled
                  ? "Activo"
                  : "Habla con admin"
            }
            href={hasWorkspace ? "/cliente/api-oficial" : "/cliente/onboarding?returnTo=/cliente/api-oficial"}
            cta="Abrir modulo"
          />
        ) : null}
      </div>
    </section>
  );
}

function DashboardModuleCard({
  title,
  description,
  metric,
  href,
  cta,
}: {
  title: string;
  description: string;
  metric: string;
  href: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-[26px] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.95))] p-5 shadow-[0_24px_54px_-42px_rgba(15,23,42,0.14)] transition hover:-translate-y-0.5 hover:shadow-[0_28px_60px_-42px_rgba(15,23,42,0.18)]"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.06),transparent_24%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.05),transparent_28%)]" />

      <div className="relative flex h-full flex-col gap-4">
        <div className="flex items-start justify-end">
          <span className="inline-flex rounded-full border border-[color:color-mix(in_srgb,var(--primary)_16%,white)] bg-white/88 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {metric}
          </span>
        </div>

        <div className="space-y-2">
          <h2 className="text-[1.05rem] font-semibold tracking-[-0.04em] text-slate-950">{title}</h2>
          <p className="text-sm leading-6 text-slate-600">{description}</p>
        </div>

        <div className="mt-auto inline-flex items-center gap-2 text-sm font-medium text-[var(--primary)]">
          {cta}
          <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}
