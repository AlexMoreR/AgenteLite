import Link from "next/link";
import { Bot, CheckCircle2, MessageSquareReply, Power, Smartphone, TimerReset, UserRound } from "lucide-react";
import {
  saveAgentReactivationMessageAction,
  saveAgentResponseDelayAction,
  toggleAgentStatusAction,
} from "@/app/actions/agent-actions";
import { assignConnectionChannelAction, toggleConnectionChannelStatusAction } from "@/app/actions/connection-actions";
import { WhatsappQrAutoRefresh } from "@/components/agents/whatsapp-qr-auto-refresh";
import { WhatsappQrCountdown } from "@/components/agents/whatsapp-qr-countdown";
import { FormActionSwitch } from "@/components/ui/form-action-switch";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AgentAssignAutosaveForm, ReactivationAutosaveForm, ResponseDelayAutosaveForm } from "./ConnectionAutosaveControls";

type WhatsAppBusinessConnectionWorkspaceProps = {
  connection: {
    id: string;
    name: string;
    provider: string;
    phoneNumber: string;
    isActive: boolean;
    agentId: string | null;
    agentName: string;
    agentIsActive: boolean;
    agentStatus: string | null;
    agentReactivationMessage: string;
    agentResponseDelaySeconds: number;
    logoUrl: string | null;
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
  const providerLabel =
    connection.provider === "OFFICIAL_API"
      ? connection.phoneNumber || "API oficial"
      : connection.phoneNumber || "QR";

  return (
    <section className="space-y-5">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={effectiveErrorMessage}
        okTitle="WhatsApp listo"
        errorTitle="No pudimos completar la conexion"
      />

      {!isConnected ? <WhatsappQrAutoRefresh isConnected={isConnected} /> : null}

      {isConnected ? (
        <div className="rounded-lg border border-[rgba(148,163,184,0.14)] bg-white p-4 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.24)] sm:rounded-lg sm:p-5">
          <div className="px-1 py-1 sm:px-0 sm:py-0">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-3">
                <Avatar className="h-10 w-10 rounded-lg border border-emerald-100 bg-emerald-50">
                  {connection.logoUrl ? <AvatarImage src={connection.logoUrl} alt={`Logo de ${connection.name}`} className="object-cover" /> : null}
                  <AvatarFallback className="rounded-lg bg-emerald-50 text-emerald-600">
                    <CheckCircle2 className="h-5 w-5" />
                  </AvatarFallback>
                </Avatar>
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
                <FormActionSwitch
                  action={toggleConnectionChannelStatusAction}
                  checked={connection.isActive}
                  ariaLabel={connection.isActive ? `Apagar ${connection.name}` : `Encender ${connection.name}`}
                  hiddenFields={[
                    { name: "channelId", value: connection.id },
                    { name: "returnTo", value: `/cliente/conexion/whatsapp-business/${connection.id}` },
                  ]}
                />

                {connection.agentId ? (
                  <Link
                    href={`/cliente/agentes/${connection.agentId}`}
                    className="inline-flex h-9 items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
                  >
                    Ir al agente
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className={`grid gap-4 ${isConnected ? "" : "xl:grid-cols-[320px_minmax(0,1fr)]"}`}>
        {!isConnected ? (
          <div className="rounded-lg border border-[rgba(148,163,184,0.14)] bg-white p-4 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.3)] sm:rounded-lg sm:p-5">
            <div className="flex flex-col items-center">
              <div className="flex aspect-square w-full max-w-[248px] items-center justify-center rounded-lg bg-slate-50">
                {qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrDataUrl} alt="QR de conexion de WhatsApp" className="h-auto w-[90%] max-w-[220px]" />
                ) : (
                  <p className="text-sm text-slate-500">Esperando QR...</p>
                )}
              </div>

              {pairingCode ? (
                <div className="mt-4 w-full rounded-lg bg-slate-50 px-4 py-3">
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

        <div
          className={
            isConnected
              ? "bg-transparent p-0 shadow-none"
              : "rounded-lg border border-[rgba(148,163,184,0.14)] bg-white p-4 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.24)] sm:rounded-lg sm:p-5"
          }
        >
          {isConnected ? (
            <div className="px-1 py-1 sm:px-0 sm:py-0">
              {availableAgents.length ? (
                <div className="mt-2.5 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-[color:color-mix(in_srgb,var(--primary)_18%,white)] bg-white px-4 py-2.5 shadow-[0_18px_48px_-40px_rgba(37,99,235,0.45)]">
                    <div className="space-y-1">
                      <div className="space-y-0.5">
                        <p className="inline-flex items-center gap-2 text-sm font-medium text-slate-900">
                          <UserRound className="h-4 w-4 text-[var(--primary)]" />
                          <span>Agente vinculado</span>
                        </p>
                        <p className="text-[13px] text-slate-500">Selecciona el agente que respondera en este canal.</p>
                      </div>
                      <AgentAssignAutosaveForm
                        action={assignConnectionChannelAction}
                        channelId={connection.id}
                        returnTo={`/cliente/conexion/whatsapp-business/${connection.id}`}
                        defaultValue={connection.agentId || ""}
                        availableAgents={availableAgents.map((agent) => ({ id: agent.id, name: agent.name }))}
                      />
                    </div>
                  </div>

                  {connection.agentId ? (
                    <>
                      <div className="rounded-lg border border-[color:color-mix(in_srgb,var(--primary)_18%,white)] bg-white px-4 py-2.5 shadow-[0_18px_48px_-40px_rgba(37,99,235,0.45)]">
                        <div className="space-y-2.5">
                          <div className="min-w-0">
                            <p className="inline-flex items-center gap-2 text-sm font-medium text-slate-900">
                              <Power className="h-4 w-4 text-[var(--primary)]" />
                              <span>Agente activo</span>
                            </p>
                            <p className="mt-0.5 text-[13px] text-slate-500">
                              {connection.agentIsActive && connection.agentStatus === "ACTIVE"
                                ? "Las respuestas automaticas del agente estan habilitadas para este canal."
                                : "Las respuestas automaticas del agente estan detenidas en este canal."}
                            </p>
                          </div>
                          <FormActionSwitch
                            action={toggleAgentStatusAction}
                            checked={connection.agentIsActive}
                            ariaLabel={connection.agentIsActive ? `Apagar agente ${connection.agentName}` : `Encender agente ${connection.agentName}`}
                            hiddenFields={[
                              { name: "agentId", value: connection.agentId },
                              { name: "returnTo", value: `/cliente/conexion/whatsapp-business/${connection.id}` },
                            ]}
                            wrapperClassName="flex w-full items-center justify-start"
                          />
                        </div>
                      </div>

                      <div className="rounded-lg border border-[color:color-mix(in_srgb,var(--primary)_18%,white)] bg-white px-4 py-2.5 shadow-[0_18px_48px_-40px_rgba(37,99,235,0.45)]">
                        <div className="space-y-2">
                          <div className="space-y-0.5">
                            <p className="inline-flex items-center gap-2 text-sm font-medium text-slate-900">
                              <MessageSquareReply className="h-4 w-4 text-[var(--primary)]" />
                              <span>Frase de reactivacion</span>
                            </p>
                            <p className="text-[13px] text-slate-500">Mensaje enviado al reactivar una conversacion.</p>
                          </div>
                          <ReactivationAutosaveForm
                            action={saveAgentReactivationMessageAction}
                            agentId={connection.agentId}
                            returnTo={`/cliente/conexion/whatsapp-business/${connection.id}`}
                            defaultValue={connection.agentReactivationMessage || "Somos tu socio aliado."}
                          />
                        </div>
                      </div>

                      <div className="rounded-lg border border-[color:color-mix(in_srgb,var(--primary)_18%,white)] bg-white px-4 py-2.5 shadow-[0_18px_48px_-40px_rgba(37,99,235,0.45)]">
                        <div className="space-y-2">
                          <div className="space-y-0.5">
                            <p className="inline-flex items-center gap-2 text-sm font-medium text-slate-900">
                              <TimerReset className="h-4 w-4 text-[var(--primary)]" />
                              <span>Retraso de respuesta IA</span>
                            </p>
                            <p className="text-[13px] text-slate-500">Espera antes de enviar cada respuesta.</p>
                          </div>
                          <ResponseDelayAutosaveForm
                            action={saveAgentResponseDelayAction}
                            agentId={connection.agentId}
                            returnTo={`/cliente/conexion/whatsapp-business/${connection.id}`}
                            defaultValue={connection.agentResponseDelaySeconds}
                          />
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
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
    <div className="rounded-lg border border-[rgba(148,163,184,0.12)] bg-slate-50/70 px-4 py-4">
      <div className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white text-xs font-semibold text-[var(--primary)] shadow-sm">
        {step}
      </div>
      <p className="mt-3 text-sm font-semibold leading-5 text-slate-900">{title}</p>
      <p className="mt-2 text-sm leading-5 text-slate-600">{description}</p>
    </div>
  );
}
