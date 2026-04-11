import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CheckCircle2, Clock3, MessageSquareText, Smartphone } from "lucide-react";

type WhatsAppBusinessWorkspaceProps = {
  summary: {
    totalAgents: number;
    connectedAgents: number;
    pendingAgents: number;
    disconnectedAgents: number;
  };
  items: Array<{
    id: string;
    name: string;
    provider: string;
    providerLabel: string;
    linkedAgentName: string;
    linkedAgentStatus: string;
    channelStatus: string | null;
    channelStatusLabel: string;
    phoneNumber: string;
    lastConnectionAt: Date | null;
    conversationsCount: number;
    messagesCount: number;
  }>;
};

export function WhatsAppBusinessWorkspace({ summary, items }: WhatsAppBusinessWorkspaceProps) {
  return (
    <section className="space-y-5">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Conexion</p>
        <h1 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">WhatsApp Business</h1>
        <p className="max-w-3xl text-sm leading-6 text-slate-600">
          Aqui administras los canales de WhatsApp que se crean dentro del modulo de conexion.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="Canales" value={String(summary.totalAgents)} icon={<MessageSquareText className="h-4 w-4" />} />
        <SummaryCard label="Conectados" value={String(summary.connectedAgents)} icon={<CheckCircle2 className="h-4 w-4" />} />
        <SummaryCard label="Esperando QR" value={String(summary.pendingAgents)} icon={<Clock3 className="h-4 w-4" />} />
        <SummaryCard label="Sin conectar" value={String(summary.disconnectedAgents)} icon={<Smartphone className="h-4 w-4" />} />
      </div>

      <div className="grid gap-4">
        {items.length ? (
          items.map((item) => {
            const isConnected = item.channelStatus === "CONNECTED";
            const isPending = item.channelStatus === "QRCODE";

            return (
              <Link
                key={item.id}
                href={`/cliente/conexion/whatsapp-business/${item.id}`}
                className="group rounded-[24px] border border-[rgba(148,163,184,0.14)] bg-white p-5 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_60px_-44px_rgba(15,23,42,0.22)]"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">{item.name}</h2>
                      <StatusPill
                        label={item.channelStatusLabel}
                        tone={isConnected ? "success" : isPending ? "warning" : "neutral"}
                      />
                    </div>

                    <div className="flex flex-wrap gap-2 text-sm text-slate-600">
                      {item.linkedAgentName ? (
                        <span className="rounded-full bg-slate-50 px-3 py-1">
                          Agente: {item.linkedAgentName} ({item.linkedAgentStatus})
                        </span>
                      ) : null}
                      {item.phoneNumber ? (
                        <span className="rounded-full bg-slate-50 px-3 py-1">Numero: {item.phoneNumber}</span>
                      ) : null}
                      <span className="rounded-full bg-slate-50 px-3 py-1">{item.conversationsCount} conversaciones</span>
                      <span className="rounded-full bg-slate-50 px-3 py-1">{item.messagesCount} mensajes</span>
                    </div>
                  </div>

                  <div className="inline-flex items-center gap-2 text-sm font-medium text-[var(--primary)]">
                    Abrir conexion
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </div>
                </div>
              </Link>
            );
          })
        ) : (
          <div className="rounded-[24px] border border-dashed border-[rgba(148,163,184,0.3)] bg-white px-5 py-8 text-sm text-slate-600">
            Aun no hay canales creados. Usa el boton de nuevo canal para crear una conexion.
          </div>
        )}
      </div>
    </section>
  );
}

function SummaryCard({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-[22px] border border-[rgba(148,163,184,0.14)] bg-white p-4 shadow-[0_16px_40px_-38px_rgba(15,23,42,0.24)]">
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
        {icon}
      </div>
      <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{value}</p>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "success" | "warning" | "neutral" }) {
  const className =
    tone === "success"
      ? "border-[rgba(22,163,74,0.14)] bg-[color-mix(in_srgb,#16a34a_8%,white)] text-[#15803d]"
      : tone === "warning"
        ? "border-[rgba(217,119,6,0.16)] bg-[color-mix(in_srgb,#f59e0b_10%,white)] text-[#b45309]"
        : "border-[rgba(148,163,184,0.16)] bg-slate-50 text-slate-600";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${className}`}>
      {label}
    </span>
  );
}
