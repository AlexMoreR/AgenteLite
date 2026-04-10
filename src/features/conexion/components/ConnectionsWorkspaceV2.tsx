import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock3, MessageSquareText, Smartphone, Trash2 } from "lucide-react";
import { deleteConnectionChannelAction } from "@/app/actions/connection-actions";
import { NewConnectionChannelModal } from "./NewConnectionChannelModal";

type ConnectionsWorkspaceProps = {
  officialApiEnabled: boolean;
  canSeeOfficialApiModule: boolean;
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
    conversationsCount: number;
    messagesCount: number;
  }>;
};

export function ConnectionsWorkspaceV2({
  officialApiEnabled,
  canSeeOfficialApiModule,
  items,
}: ConnectionsWorkspaceProps) {
  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">Conexion</h1>
          <p className="max-w-3xl text-sm text-slate-600">Crea y administra tus canales de conexion.</p>
        </div>

        <NewConnectionChannelModal
          canSeeOfficialApiModule={canSeeOfficialApiModule}
          officialApiEnabled={officialApiEnabled}
        />
      </div>

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
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Conexiones creadas</h2>
            <p className="text-sm text-slate-600">Aqui aparecen todas las conexiones creadas dentro del modulo.</p>
          </div>
        </div>

        {items.length ? (
          <div className="grid gap-4">
            {items.map((item) => {
              const detailHref =
                item.provider === "OFFICIAL_API" ? "/cliente/api-oficial" : `/cliente/conexion/whatsapp-business/${item.id}`;

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
    <div className="rounded-[22px] border border-[rgba(148,163,184,0.14)] bg-white p-4 shadow-[0_16px_40px_-38px_rgba(15,23,42,0.24)]">
      <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
        {icon}
      </div>
      <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{value}</p>
    </div>
  );
}
