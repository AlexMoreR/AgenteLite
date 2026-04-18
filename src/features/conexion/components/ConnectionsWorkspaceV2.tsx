import type { ReactNode } from "react";
import Link from "next/link";
import {
  FiLink,
  FiMail,
  FiMessageCircle,
  FiTrash2,
} from "react-icons/fi";
import { HiMiniChartBar } from "react-icons/hi2";
import {
  assignConnectionChannelAction,
  deleteConnectionChannelAction,
  toggleConnectionChannelStatusAction,
} from "@/app/actions/connection-actions";
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
    isActive: boolean;
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
          <div className="inline-flex items-center gap-3">
            <HiMiniChartBar className="h-6 w-6 text-sky-600" />
            <h1 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">Conexion</h1>
          </div>
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
                <FiLink className="h-5 w-5" />
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
                  className="group relative rounded-[22px] border border-[#e5e7eb] bg-white px-4 py-3 shadow-[0_18px_50px_-46px_rgba(15,23,42,0.16)] transition duration-200 hover:-translate-y-0.5 hover:border-[var(--primary)]/30 hover:shadow-[0_24px_70px_-42px_rgba(15,23,42,0.24)]"
                >
                  <Link
                    href={detailHref}
                    aria-label={`Abrir ${item.name}`}
                    className="absolute inset-0 z-0 rounded-[24px]"
                  />

                  <div className="pointer-events-none relative z-10 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5 xl:self-center">
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-transparent text-[#16a34a]">
                        <WhatsAppGlyph className="h-6 w-6" />
                      </span>

                      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <h3 className="text-[15px] font-semibold tracking-[-0.03em] text-slate-950">{item.name}</h3>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-600">
                          {item.phoneNumber ? (
                            <span className="rounded-full bg-slate-50 px-2.5 py-1">Numero: {item.phoneNumber}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5 xl:justify-end">
                      <StatusPill label={item.channelStatusLabel} />
                      <form action={toggleConnectionChannelStatusAction} className="pointer-events-auto relative z-20">
                        <input type="hidden" name="channelId" value={item.id} />
                        <input type="hidden" name="returnTo" value="/cliente/conexion" />
                        <button
                          type="submit"
                          className="inline-flex h-6 items-center justify-center bg-transparent p-0 transition hover:opacity-90"
                          aria-label={item.isActive ? `Apagar ${item.name}` : `Encender ${item.name}`}
                          title={item.isActive ? "Apagar canal" : "Encender canal"}
                        >
                          <span
                            className={`relative inline-flex h-6 w-10 shrink-0 rounded-full transition ${
                              item.isActive ? "bg-emerald-500/90" : "bg-slate-300"
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-[0_2px_10px_-4px_rgba(15,23,42,0.45)] transition-transform ${
                                item.isActive ? "translate-x-4.5" : "translate-x-0.5"
                              }`}
                            />
                          </span>
                        </button>
                      </form>
                      <MetricPill icon={<FiMessageCircle className="h-4 w-4" />} value={String(item.conversationsCount)} />
                      <MetricPill icon={<FiMail className="h-4 w-4" />} value={String(item.messagesCount)} />

                      {canAssignToTargetAgent ? (
                        <form action={assignConnectionChannelAction} className="pointer-events-auto relative z-20">
                          <input type="hidden" name="channelId" value={item.id} />
                          <input type="hidden" name="agentId" value={targetAgent?.id} />
                          <button
                            type="submit"
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-[var(--primary)] px-3.5 text-[13px] font-medium text-white transition hover:bg-[var(--primary-strong)]"
                          >
                            <FiLink className="h-3.5 w-3.5" />
                            Asignar a este agente
                          </button>
                        </form>
                      ) : null}

                      <form action={deleteConnectionChannelAction} className="pointer-events-auto relative z-20">
                        <input type="hidden" name="channelId" value={item.id} />
                        <button
                          type="submit"
                          aria-label={`Eliminar ${item.name}`}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(239,68,68,0.18)] bg-[color-mix(in_srgb,#ef4444_6%,white)] text-[#b91c1c] transition hover:bg-[color-mix(in_srgb,#ef4444_12%,white)]"
                        >
                          <FiTrash2 className="h-3.5 w-3.5" />
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
      ? "text-[#15803d]"
      : label === "Esperando QR"
        ? "text-[#b45309]"
        : "text-slate-600";
  const dotTone =
    label === "Conectado" ? "bg-[#16a34a]" : label === "Esperando QR" ? "bg-[#f59e0b]" : "bg-slate-400";

  return (
    <span className={`inline-flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${tone}`}>
      <span className={`h-2 w-2 rounded-full ${dotTone}`} />
      {label}
    </span>
  );
}

function MetricPill({ icon, value }: { icon: ReactNode; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-1 text-[13px] text-slate-600">
      <span className="text-slate-400">{icon}</span>
      <span>{value}</span>
    </span>
  );
}

function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M19.05 4.94A9.9 9.9 0 0 0 12.02 2C6.51 2 2.02 6.48 2.02 12c0 1.76.46 3.48 1.33 5L2 22l5.15-1.34A9.95 9.95 0 0 0 12.02 22h.01c5.51 0 9.99-4.49 9.99-10 0-2.67-1.04-5.18-2.97-7.06Zm-7.03 15.38h-.01a8.3 8.3 0 0 1-4.23-1.16l-.3-.18-3.06.8.82-2.98-.2-.31a8.27 8.27 0 0 1-1.28-4.43c0-4.58 3.73-8.31 8.32-8.31 2.22 0 4.3.86 5.87 2.43a8.23 8.23 0 0 1 2.43 5.88c0 4.58-3.73 8.31-8.36 8.31Zm4.56-6.2c-.25-.12-1.47-.72-1.7-.8-.23-.08-.4-.12-.57.12-.17.25-.65.8-.8.96-.15.17-.3.19-.55.07-.25-.12-1.05-.39-2-1.24-.74-.66-1.24-1.47-1.39-1.72-.15-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.15.16-.25.24-.42.08-.17.04-.32-.02-.44-.06-.12-.57-1.37-.78-1.87-.2-.49-.4-.42-.57-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1 0 1.23.9 2.43 1.02 2.59.12.17 1.77 2.7 4.29 3.78.6.26 1.08.42 1.44.53.61.19 1.17.16 1.61.1.49-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.15-1.18-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  );
}
