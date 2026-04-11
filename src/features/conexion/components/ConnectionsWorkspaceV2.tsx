import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock3, Link2, MessageSquareText, Smartphone, Trash2 } from "lucide-react";
import { assignConnectionChannelAction, deleteConnectionChannelAction } from "@/app/actions/connection-actions";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { NewConnectionChannelModal } from "./NewConnectionChannelModal";

type ConnectionsWorkspaceProps = {
  officialApiEnabled: boolean;
  canSeeOfficialApiModule: boolean;
  okMessage?: string;
  errorMessage?: string;
  targetAgent?: {
    id: string;
    name: string;
    status: string;
  } | null;
  items: Array<{
    id: string;
    name: string;
    provider: string;
    providerLabel: string;
    linkedAgentId: string;
    linkedAgentName: string;
    linkedAgentStatus: string;
    channelStatus: string | null;
    channelStatusLabel: string;
    phoneNumber: string;
    conversationsCount: number;
    messagesCount: number;
  }>;
};

export function ConnectionsWorkspaceV2({
  officialApiEnabled,
  canSeeOfficialApiModule,
  okMessage,
  errorMessage,
  targetAgent,
  items,
}: ConnectionsWorkspaceProps) {
  return (
    <section className="space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Agente listo"
        errorTitle="No pudimos continuar"
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">Conexion</h1>
          <p className="max-w-3xl text-sm text-slate-600">Crea y administra tus canales de conexion.</p>
        </div>

        <NewConnectionChannelModal
          canSeeOfficialApiModule={canSeeOfficialApiModule}
          officialApiEnabled={officialApiEnabled}
          targetAgent={targetAgent}
        />
      </div>

      {targetAgent ? (
        <div className="rounded-[24px] border border-[rgba(37,99,235,0.14)] bg-[linear-gradient(180deg,rgba(239,246,255,0.84),rgba(255,255,255,0.98))] px-5 py-4 shadow-[0_16px_40px_-32px_rgba(37,99,235,0.28)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                <Link2 className="h-5 w-5" />
              </span>
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--primary)]">Agente seleccionado</p>
                <p className="text-base font-semibold tracking-[-0.03em] text-slate-950">{targetAgent.name}</p>
                <p className="text-sm text-slate-600">Crea un canal nuevo o usa uno existente para vincularlo a este agente.</p>
              </div>
            </div>

            <Link
              href={`/cliente/agentes/${targetAgent.id}`}
              className="inline-flex h-10 items-center justify-center rounded-full border border-[rgba(148,163,184,0.18)] bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
            >
              Ver agente
            </Link>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Canales" value={String(items.length)} icon={<MessageSquareText className="h-4 w-4" />} />
        <SummaryCard
          label="Conectados"
          value={String(items.filter((item) => item.channelStatus === "CONNECTED").length)}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <SummaryCard
          label="Esperando QR"
          value={String(items.filter((item) => item.channelStatus === "QRCODE").length)}
          icon={<Clock3 className="h-4 w-4" />}
        />
        <SummaryCard
          label="Sin conectar"
          value={String(items.filter((item) => item.channelStatus === "DISCONNECTED").length)}
          icon={<Smartphone className="h-4 w-4" />}
        />
      </div>

      <div className="space-y-3">

        {items.length ? (
          <div className="grid gap-4">
            {items.map((item) => {
              const detailHref =
                item.provider === "OFFICIAL_API" ? "/cliente/api-oficial" : `/cliente/conexion/whatsapp-business/${item.id}`;
              const canAssignToTargetAgent = Boolean(targetAgent && item.linkedAgentId !== targetAgent.id);

              return (
                <div
                  key={item.id}
                  className="rounded-[24px] border border-[rgba(148,163,184,0.14)] bg-white p-5 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.18)]"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">{item.name}</h3>
                        <StatusPill label={item.channelStatusLabel} />
                      </div>

                      <div className="flex flex-wrap gap-2 text-sm text-slate-600">
                        <span className="rounded-full bg-slate-50 px-3 py-1">Proveedor: {item.providerLabel}</span>
                        {item.linkedAgentName ? (
                          <span className="rounded-full bg-slate-50 px-3 py-1">
                            Agente: {item.linkedAgentName} ({item.linkedAgentStatus})
                          </span>
                        ) : null}
                        <span className="rounded-full bg-slate-50 px-3 py-1">
                          {item.phoneNumber ? `Numero: ${item.phoneNumber}` : "Sin numero vinculado"}
                        </span>
                        <span className="rounded-full bg-slate-50 px-3 py-1">{item.conversationsCount} conversaciones</span>
                        <span className="rounded-full bg-slate-50 px-3 py-1">{item.messagesCount} mensajes</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {canAssignToTargetAgent ? (
                        <form action={assignConnectionChannelAction}>
                          <input type="hidden" name="channelId" value={item.id} />
                          <input type="hidden" name="agentId" value={targetAgent?.id} />
                          <button
                            type="submit"
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
                          >
                            <Link2 className="h-4 w-4" />
                            Asignar a este agente
                          </button>
                        </form>
                      ) : null}

                      <Link
                        href={detailHref}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[rgba(148,163,184,0.18)] bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
                      >
                        Abrir
                        <ArrowRight className="h-4 w-4" />
                      </Link>

                      <form action={deleteConnectionChannelAction}>
                        <input type="hidden" name="channelId" value={item.id} />
                        <button
                          type="submit"
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[rgba(239,68,68,0.18)] bg-[color-mix(in_srgb,#ef4444_6%,white)] px-4 text-sm font-medium text-[#b91c1c] transition hover:bg-[color-mix(in_srgb,#ef4444_12%,white)]"
                        >
                          <Trash2 className="h-4 w-4" />
                          Eliminar
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[24px] border border-dashed border-[rgba(148,163,184,0.3)] bg-white px-5 py-8 text-sm text-slate-600">
            Aun no hay conexiones creadas. Usa el boton de nuevo canal para comenzar.
          </div>
        )}
      </div>
    </section>
  );
}

function StatusPill({ label }: { label: string }) {
  const tone =
    label === "Conectado"
      ? "border-[rgba(22,163,74,0.14)] bg-[color-mix(in_srgb,#16a34a_8%,white)] text-[#15803d]"
      : label === "Esperando QR"
        ? "border-[rgba(217,119,6,0.16)] bg-[color-mix(in_srgb,#f59e0b_10%,white)] text-[#b45309]"
        : "border-[rgba(148,163,184,0.16)] bg-slate-50 text-slate-600";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${tone}`}>
      {label}
    </span>
  );
}

function SummaryCard({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="group relative overflow-hidden rounded-[20px] border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,247,255,0.9))] px-4 py-3 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_44px_-32px_rgba(15,23,42,0.22)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.07),transparent_28%),linear-gradient(180deg,transparent,rgba(226,232,240,0.22))]" />

      <div className="relative flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className="mt-3 text-[2rem] font-semibold leading-none tracking-[-0.07em] text-slate-950">{value}</p>
        </div>

        <div className="relative shrink-0">
          <div className="absolute inset-0 translate-y-1 rounded-[18px] bg-[linear-gradient(180deg,rgba(37,99,235,0.08),rgba(37,99,235,0.02))] blur-md transition group-hover:opacity-100" />
          <div className="relative inline-flex h-12 w-12 items-center justify-center rounded-[18px] border border-white/70 bg-[linear-gradient(180deg,rgba(227,235,255,1),rgba(216,228,255,0.88))] text-[var(--primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.78)]">
            {icon}
          </div>
        </div>
      </div>
    </div>
  );
}
