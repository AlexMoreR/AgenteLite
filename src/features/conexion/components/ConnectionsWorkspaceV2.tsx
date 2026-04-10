import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Cable, MessageSquare } from "lucide-react";
import { NewConnectionChannelModal } from "./NewConnectionChannelModal";

type ConnectionsWorkspaceProps = {
  agentCount: number;
  channelCount: number;
  officialApiEnabled: boolean;
  canSeeOfficialApiModule: boolean;
};

export function ConnectionsWorkspaceV2({
  agentCount,
  channelCount,
  officialApiEnabled,
  canSeeOfficialApiModule,
}: ConnectionsWorkspaceProps) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">Conexion</h1>
          <p className="max-w-3xl text-sm text-slate-600">Crea y administra tus canales de conexion.</p>
        </div>

        <NewConnectionChannelModal canSeeOfficialApiModule={canSeeOfficialApiModule} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ConnectionCard
          title="WhatsApp Business"
          description="Administra los canales por agente conectados con Evolution API y entra directo al QR o al estado actual de cada numero."
          metric={`${channelCount} canales / ${agentCount} agentes`}
          href="/cliente/conexion/whatsapp-business"
          cta="Gestionar conexiones"
          icon={<Cable className="h-5 w-5" />}
        />

        {canSeeOfficialApiModule ? (
          <ConnectionCard
            title="API oficial"
            description={
              officialApiEnabled
                ? "Tu canal oficial esta activo y listo para operar desde la bandeja y los flujos."
                : "Centraliza aqui el acceso a la API oficial de WhatsApp sin mezclarla con las conexiones de agentes."
            }
            metric={officialApiEnabled ? "Activo" : "Pendiente de configuracion"}
            href="/cliente/api-oficial"
            cta="Abrir API oficial"
            icon={<MessageSquare className="h-5 w-5" />}
          />
        ) : null}
      </div>
    </section>
  );
}

function ConnectionCard({
  title,
  description,
  metric,
  href,
  cta,
  icon,
}: {
  title: string;
  description: string;
  metric: string;
  href: string;
  cta: string;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-[28px] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.95))] p-5 shadow-[0_24px_54px_-42px_rgba(15,23,42,0.14)] transition hover:-translate-y-0.5 hover:shadow-[0_28px_60px_-42px_rgba(15,23,42,0.18)]"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.06),transparent_24%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.05),transparent_28%)]" />

      <div className="relative flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
            {icon}
          </div>
          <span className="inline-flex rounded-full border border-[color:color-mix(in_srgb,var(--primary)_16%,white)] bg-white/88 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {metric}
          </span>
        </div>

        <div className="space-y-2">
          <h2 className="text-[1.1rem] font-semibold tracking-[-0.04em] text-slate-950">{title}</h2>
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
