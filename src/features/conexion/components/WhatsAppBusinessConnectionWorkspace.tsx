import Link from "next/link";
import { Bot, CheckCircle2, Smartphone } from "lucide-react";
import { toggleAgentStatusAction } from "@/app/actions/agent-actions";
import { assignConnectionChannelAction, toggleConnectionChannelStatusAction } from "@/app/actions/connection-actions";
import { WhatsappQrAutoRefresh } from "@/components/agents/whatsapp-qr-auto-refresh";
import { WhatsappQrCountdown } from "@/components/agents/whatsapp-qr-countdown";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";

type WhatsAppBusinessConnectionWorkspaceProps = {
  connection: {
    id: string;
    name: string;
    provider: string;
    isActive: boolean;
    agentId: string | null;
    agentName: string;
    agentIsActive: boolean;
    agentStatus: string | null;
  };
  isConnected: boolean;
  qrDataUrl: string;
  pairingCode: string;
  hasQrCode: boolean;
  channelStatus: string | null | undefined;
  okMessage: string;
  errorMessage: string;
  availableAgents: Array<{
    id: string;
    name: string;
    status: string;
  }>;
};

export function WhatsAppBusinessConnectionWorkspace({
  connection,
  isConnected,
  qrDataUrl,
  pairingCode,
  hasQrCode,
  channelStatus,
  okMessage,
  errorMessage,
  availableAgents,
}: WhatsAppBusinessConnectionWorkspaceProps) {
  const effectiveErrorMessage = hasQrCode || channelStatus === "QRCODE" || isConnected ? "" : errorMessage;
  const providerLabel = connection.provider === "OFFICIAL_API" ? "API oficial" : "QR";

  return (
    <section className="space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={effectiveErrorMessage}
        okTitle="WhatsApp listo"
        errorTitle="No pudimos completar la conexion"
      />

      {!isConnected ? <WhatsappQrAutoRefresh isConnected={isConnected} /> : null}

      <div className={`grid gap-4 ${isConnected ? "" : "xl:grid-cols-[320px_minmax(0,1fr)]"}`}>
        {!isConnected ? (
          <div className="rounded-[24px] border border-[rgba(148,163,184,0.14)] bg-white p-4 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.3)] sm:rounded-[28px] sm:p-5">
            <div className="flex flex-col items-center">
              <div className="flex aspect-square w-full max-w-[248px] items-center justify-center rounded-[24px] bg-slate-50">
                {qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrDataUrl} alt="QR de conexion de WhatsApp" className="h-auto w-[90%] max-w-[220px]" />
                ) : (
                  <p className="text-sm text-slate-500">Esperando QR...</p>
                )}
              </div>

              {pairingCode ? (
                <div className="mt-4 w-full rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Codigo alterno</p>
                  <p className="mt-2 font-mono text-sm font-semibold text-slate-900">{pairingCode}</p>
                </div>
              ) : null}

              <div className="mt-4 w-full">
                <WhatsappQrCountdown isConnected={isConnected} cycleSeconds={40} />
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-[24px] border border-[rgba(148,163,184,0.14)] bg-white p-4 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.24)] sm:rounded-[28px] sm:p-5">
          {isConnected ? (
            <div className="px-1 py-1 sm:px-0 sm:py-0">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                  <div className="min-w-0 space-y-1">
                    <h2 className="truncate text-[1.2rem] font-semibold tracking-[-0.05em] text-slate-950">{connection.name}</h2>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
                      <div className="inline-flex items-center gap-2">
                        <Smartphone className="h-4 w-4 text-slate-500" />
                        <span>{providerLabel}</span>
                      </div>
                      <div className="inline-flex items-center gap-2">
                        <Bot className="h-4 w-4 text-[var(--primary)]" />
                        <span className="truncate">{connection.agentName || "Sin agente"}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <form action={toggleConnectionChannelStatusAction}>
                    <input type="hidden" name="channelId" value={connection.id} />
                    <input type="hidden" name="returnTo" value={`/cliente/conexion/whatsapp-business/${connection.id}`} />
                    <button
                      type="submit"
                      className="inline-flex h-9 items-center gap-2 rounded-full px-1 text-sm font-medium text-slate-700 transition hover:text-emerald-700"
                      aria-label={connection.isActive ? `Apagar ${connection.name}` : `Encender ${connection.name}`}
                    >
                      <span
                        className={`relative inline-flex h-4.5 w-8 shrink-0 rounded-full transition ${
                          connection.isActive ? "bg-emerald-500/90" : "bg-slate-300"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-[0_2px_10px_-4px_rgba(15,23,42,0.45)] transition-transform ${
                            connection.isActive ? "translate-x-4" : "translate-x-0.5"
                          }`}
                        />
                      </span>
                      {connection.isActive ? "Activo" : "Apagado"}
                    </button>
                  </form>

                  {connection.agentId ? (
                    <Link
                      href={`/cliente/agentes/${connection.agentId}`}
                      className="inline-flex h-9 items-center justify-center rounded-full bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
                    >
                      Ir al agente
                    </Link>
                  ) : null}
                </div>
              </div>

              {availableAgents.length ? (
                <div className="mt-4 space-y-3">
                  <form action={assignConnectionChannelAction} className="flex flex-col gap-2 sm:flex-row">
                    <input type="hidden" name="channelId" value={connection.id} />
                    <input type="hidden" name="returnTo" value={`/cliente/conexion/whatsapp-business/${connection.id}`} />
                    <select
                      name="agentId"
                      defaultValue={connection.agentId || ""}
                      className="h-9 min-w-0 flex-1 rounded-full border border-[rgba(148,163,184,0.18)] bg-white px-3.5 text-sm text-slate-700 outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[color:color-mix(in_srgb,var(--primary)_10%,white)]"
                      aria-label="Seleccionar agente para el canal"
                    >
                      <option value="" disabled>
                        Seleccionar agente
                      </option>
                      {availableAgents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-white transition hover:bg-[var(--primary-strong)]"
                      aria-label="Guardar agente del canal"
                    >
                      <Bot className="h-4 w-4" />
                    </button>
                  </form>

                  {connection.agentId ? (
                    <div className="flex flex-col gap-2 rounded-2xl border border-slate-200/80 bg-slate-50/70 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">Responder al escribir</p>
                        <p className="text-xs text-slate-500">
                          {connection.agentIsActive && connection.agentStatus === "ACTIVE"
                            ? "El agente responde cuando entra un mensaje."
                            : "El agente no respondera hasta que lo actives."}
                        </p>
                      </div>
                      <form action={toggleAgentStatusAction}>
                        <input type="hidden" name="agentId" value={connection.agentId} />
                        <input type="hidden" name="returnTo" value={`/cliente/conexion/whatsapp-business/${connection.id}`} />
                        <button
                          type="submit"
                          className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
                          aria-label={connection.agentIsActive ? `Apagar agente ${connection.agentName}` : `Encender agente ${connection.agentName}`}
                        >
                          <span
                            className={`relative inline-flex h-4.5 w-8 shrink-0 rounded-full transition ${
                              connection.agentIsActive ? "bg-emerald-500/90" : "bg-slate-300"
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-[0_2px_10px_-4px_rgba(15,23,42,0.45)] transition-transform ${
                                connection.agentIsActive ? "translate-x-4" : "translate-x-0.5"
                              }`}
                            />
                          </span>
                          {connection.agentIsActive ? "Agente activo" : "Agente apagado"}
                        </button>
                      </form>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
                  <Smartphone className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-[1.05rem] font-semibold tracking-[-0.04em] text-slate-950">Escanea el QR</h2>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <StepCard step="1" title="Abre WhatsApp" description="En tu telefono, abre la app principal." />
                <StepCard
                  step="2"
                  title="Ve a dispositivos vinculados"
                  description="Entra al menu y toca la opcion para vincular un dispositivo."
                />
                <StepCard
                  step="3"
                  title="Escanea el codigo QR"
                  description="Apunta la camara y espera la confirmacion de conexion."
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function StepCard({ step, title, description }: { step: string; title: string; description: string }) {
  return (
    <div className="rounded-[20px] border border-[rgba(148,163,184,0.12)] bg-slate-50/70 px-4 py-4">
      <div className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-semibold text-[var(--primary)] shadow-sm">
        {step}
      </div>
      <p className="mt-3 text-sm font-semibold leading-5 text-slate-900">{title}</p>
      <p className="mt-2 text-sm leading-5 text-slate-600">{description}</p>
    </div>
  );
}
