import { BellRing, Bot, Cpu, MessageSquareReply, Power, Smartphone, TimerReset, UserRound, Volume2 } from "lucide-react";
import {
  saveAgentReactivationMessageAction,
  saveAgentResponseDelayAction,
  toggleAgentStatusAction,
} from "@/app/actions/agent-actions";
import { assignConnectionChannelAction, toggleConnectionChannelStatusAction } from "@/app/actions/connection-actions";
import { WhatsappQrAutoRefresh } from "@/components/agents/whatsapp-qr-auto-refresh";
import { WhatsappQrCountdown } from "@/components/agents/whatsapp-qr-countdown";
import { Card, CardContent } from "@/components/ui/card";
import { FormActionSwitch } from "@/components/ui/form-action-switch";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ConnectionTabs } from "./ConnectionTabs";
import { EvolutionChatSyncDialog } from "./EvolutionChatSyncDialog";
import { AgentAssignAutosaveForm, ReactivationAutosaveForm, ResponseDelayAutosaveForm } from "./ConnectionAutosaveControls";
import { NotificationSoundSelect } from "@/components/chats/notification-sound-select";
import { NotificationPermissionToggle } from "@/components/chats/notification-permission-toggle";
import { ChannelCollaboratorsForm } from "./ChannelCollaboratorsForm";
import { OfficialApiConnectionSetupCard } from "./OfficialApiConnectionSetupCard";
import { RegenerateInstanceButton } from "./RegenerateInstanceButton";

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
  officialApiConfig?: {
    accessToken: string | null;
    phoneNumberId: string | null;
    wabaId: string | null;
    webhookVerifyToken: string | null;
    appSecret: string | null;
  } | null;
  officialApiProviderAppId?: string;
  officialApiProviderAppSecret?: string;
  officialApiWebhookCallbackUrl?: string;
  okMessage: string;
  errorMessage: string;
  availableAgents: Array<{
    id: string;
    name: string;
    status: string;
  }>;
  collaboratorMembers?: Array<{ id: string; name: string | null; email: string }>;
  collaboratorIds?: string[];
};

export function WhatsAppBusinessConnectionWorkspace({
  connection,
  isConnected,
  qrDataUrl,
  pairingCode,
  hasQrCode,
  channelStatus,
  officialApiConfig,
  officialApiProviderAppId = "",
  officialApiProviderAppSecret = "",
  officialApiWebhookCallbackUrl = "",
  okMessage,
  errorMessage,
  availableAgents,
  collaboratorMembers = [],
  collaboratorIds = [],
}: WhatsAppBusinessConnectionWorkspaceProps) {
  const effectiveErrorMessage = hasQrCode || channelStatus === "QRCODE" || isConnected ? "" : errorMessage;
  const providerLabel =
    connection.provider === "OFFICIAL_API"
      ? connection.phoneNumber || "API oficial"
      : connection.phoneNumber || "QR";
  const connectionReturnTo = `/cliente/conexion/whatsapp-business/${connection.id}`;
  const connectionStatusLabel = isConnected ? "Conectado" : "Sin conectar";

  const headerCard = (
    <Card className="relative overflow-hidden py-0">
      <span
        className={`absolute inset-y-0 left-0 w-1 ${isConnected ? "bg-emerald-500" : "bg-muted-foreground/25"}`}
        aria-hidden="true"
      />
      <CardContent className="relative flex flex-col gap-3 py-3.5 pl-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-11 shrink-0 rounded-full ring-1 ring-emerald-100">
            {connection.logoUrl ? (
              <AvatarImage src={connection.logoUrl} alt={`Logo de ${connection.name}`} className="rounded-full object-cover" />
            ) : null}
            <AvatarFallback className="rounded-full bg-emerald-50 text-emerald-600">
              <WhatsAppGlyph className="size-6" />
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-foreground">{connection.name}</h2>
              {connection.agentName ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  <Bot className="size-3" />
                  {connection.agentName}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  <Cpu className="size-3" />
                  Sin agente
                </span>
              )}
            </div>

            {providerLabel ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Smartphone className="size-3 shrink-0" />
                <span className="tabular-nums">{providerLabel}</span>
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <StatusPill label={connectionStatusLabel} />
          <FormActionSwitch
            action={toggleConnectionChannelStatusAction}
            checked={connection.isActive}
            ariaLabel={connection.isActive ? `Apagar ${connection.name}` : `Encender ${connection.name}`}
            hiddenFields={[
              { name: "channelId", value: connection.id },
              { name: "returnTo", value: connectionReturnTo },
            ]}
          />
        </div>
      </CardContent>
    </Card>
  );

  const agentTabContent = (
    <div className="grid gap-4 md:grid-cols-2">
      {availableAgents.length ? (
        <>
          <Card>
            <CardContent className="space-y-2">
              <p className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                <UserRound className="size-4 text-primary" />
                <span>Agente vinculado</span>
              </p>
              <AgentAssignAutosaveForm
                action={assignConnectionChannelAction}
                channelId={connection.id}
                returnTo={connectionReturnTo}
                defaultValue={connection.agentId || ""}
                availableAgents={availableAgents.map((agent) => ({ id: agent.id, name: agent.name }))}
              />
            </CardContent>
          </Card>

          {connection.agentId ? (
            <>
              <Card>
                <CardContent className="space-y-2.5">
                  <p className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                    <Power className="size-4 text-primary" />
                    <span>Agente activo</span>
                  </p>
                  <FormActionSwitch
                    action={toggleAgentStatusAction}
                    checked={connection.agentIsActive}
                    ariaLabel={
                      connection.agentIsActive
                        ? `Apagar agente ${connection.agentName}`
                        : `Encender agente ${connection.agentName}`
                    }
                    hiddenFields={[
                      { name: "agentId", value: connection.agentId },
                      { name: "returnTo", value: connectionReturnTo },
                    ]}
                    wrapperClassName="flex w-full items-center justify-start"
                  />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-2">
                  <p className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                    <MessageSquareReply className="size-4 text-primary" />
                    <span>Frase de reactivacion</span>
                  </p>
                  <ReactivationAutosaveForm
                    action={saveAgentReactivationMessageAction}
                    agentId={connection.agentId}
                    returnTo={connectionReturnTo}
                    defaultValue={connection.agentReactivationMessage || "Somos tu socio aliado."}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-2">
                  <p className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                    <TimerReset className="size-4 text-primary" />
                    <span>Retraso de respuesta IA</span>
                  </p>
                  <ResponseDelayAutosaveForm
                    action={saveAgentResponseDelayAction}
                    agentId={connection.agentId}
                    returnTo={connectionReturnTo}
                    defaultValue={connection.agentResponseDelaySeconds}
                  />
                </CardContent>
              </Card>
            </>
          ) : null}
        </>
      ) : null}

      <Card>
        <CardContent className="space-y-2">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
            <Volume2 className="size-4 text-primary" />
            <span>Sonido</span>
          </p>
          <NotificationSoundSelect />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
            <BellRing className="size-4 text-primary" />
            <span>Notificaciones del dispositivo</span>
          </p>
          <NotificationPermissionToggle />
        </CardContent>
      </Card>

      {connection.provider === "EVOLUTION" ? <EvolutionChatSyncDialog channelId={connection.id} /> : null}
    </div>
  );

  const settingsTabContent =
    connection.provider === "OFFICIAL_API" ? (
      <OfficialApiConnectionSetupCard
        channelId={connection.id}
        appId={officialApiProviderAppId}
        appSecret={officialApiProviderAppSecret || officialApiConfig?.appSecret || ""}
        initialAccessToken={officialApiConfig?.accessToken ?? ""}
        initialPhoneNumberId={officialApiConfig?.phoneNumberId ?? ""}
        initialWabaId={officialApiConfig?.wabaId ?? ""}
        initialWebhookVerifyToken={officialApiConfig?.webhookVerifyToken ?? ""}
        webhookCallbackUrl={officialApiWebhookCallbackUrl}
      />
    ) : undefined;

  return (
    <section className="space-y-5 p-6">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={effectiveErrorMessage}
        okTitle="WhatsApp listo"
        errorTitle="No pudimos completar la conexion"
      />

      {!isConnected && connection.provider === "EVOLUTION" ? <WhatsappQrAutoRefresh isConnected={isConnected} /> : null}

      {isConnected ? (
        <>
          {headerCard}

          <ConnectionTabs
            agente={agentTabContent}
            ajustes={settingsTabContent}
            colaboradores={
              <Card>
                <CardContent>
                  <ChannelCollaboratorsForm
                    channelId={connection.id}
                    members={collaboratorMembers}
                    collaboratorIds={collaboratorIds}
                  />
                </CardContent>
              </Card>
            }
          />
        </>
      ) : connection.provider === "OFFICIAL_API" ? (
        <>
          {headerCard}
          <ConnectionTabs
            agente={agentTabContent}
            ajustes={settingsTabContent}
            colaboradores={
              <Card>
                <CardContent>
                  <ChannelCollaboratorsForm
                    channelId={connection.id}
                    members={collaboratorMembers}
                    collaboratorIds={collaboratorIds}
                  />
                </CardContent>
              </Card>
            }
          />
        </>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <Card>
            <CardContent className="flex flex-col items-center">
              <div className="flex aspect-square w-full max-w-[248px] items-center justify-center rounded-lg bg-muted">
                {qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrDataUrl} alt="QR de conexion de WhatsApp" className="h-auto w-[90%] max-w-[220px]" />
                ) : (
                  <p className="text-sm text-muted-foreground">Esperando QR...</p>
                )}
              </div>

              {pairingCode ? (
                <div className="mt-4 w-full rounded-lg bg-muted px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Codigo alterno</p>
                  <p className="mt-2 font-mono text-sm font-semibold text-foreground">{pairingCode}</p>
                </div>
              ) : null}

              <div className="mt-4 w-full">
                <WhatsappQrCountdown isConnected={isConnected} cycleSeconds={40} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="inline-flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Smartphone className="size-5" />
                </div>
                <h2 className="text-lg font-semibold text-foreground">Escanea el QR</h2>
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

              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4">
                <p className="text-sm font-medium text-foreground">¿El QR no funciona o no aparece?</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Crea una cuenta nueva para este canal con un QR nuevo. Tus chats, contactos, CRM,
                  etiquetas y el agente vinculado se conservan; solo tendrás que volver a escanear.
                </p>
                <div className="mt-3">
                  <RegenerateInstanceButton channelId={connection.id} returnTo={connectionReturnTo} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
}

function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M19.05 4.94A9.9 9.9 0 0 0 12.02 2C6.51 2 2.02 6.48 2.02 12c0 1.76.46 3.48 1.33 5L2 22l5.15-1.34A9.95 9.95 0 0 0 12.02 22h.01c5.51 0 9.99-4.49 9.99-10 0-2.67-1.04-5.18-2.97-7.06Zm-7.03 15.38h-.01a8.3 8.3 0 0 1-4.23-1.16l-.3-.18-3.06.8.82-2.98-.2-.31a8.27 8.27 0 0 1-1.28-4.43c0-4.58 3.73-8.31 8.32-8.31 2.22 0 4.3.86 5.87 2.43a8.23 8.23 0 0 1 2.43 5.88c0 4.58-3.73 8.31-8.36 8.31Zm4.56-6.2c-.25-.12-1.47-.72-1.7-.8-.23-.08-.4-.12-.57.12-.17.25-.65.8-.8.96-.15.17-.3.19-.55.07-.25-.12-1.05-.39-2-1.24-.74-.66-1.24-1.47-1.39-1.72-.15-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.15.16-.25.24-.42.08-.17.04-.32-.02-.44-.06-.12-.57-1.37-.78-1.87-.2-.49-.4-.42-.57-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1 0 1.23.9 2.43 1.02 2.59.12.17 1.77 2.7 4.29 3.78.6.26 1.08.42 1.44.53.61.19 1.17.16 1.61.1.49-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.15-1.18-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  );
}

function StatusPill({ label }: { label: string }) {
  const connected = label === "Conectado";
  const waiting = label === "Esperando QR";
  const tone = connected
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : waiting
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-border bg-muted text-muted-foreground";
  const dotTone = connected ? "bg-emerald-500" : waiting ? "bg-amber-500" : "bg-muted-foreground";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${tone}`}
    >
      <span className={`size-1.5 rounded-full ${dotTone}`} />
      {label}
    </span>
  );
}

function StepCard({ step, title, description }: { step: string; title: string; description: string }) {
  return (
    <div className="rounded-lg border bg-muted/50 p-4">
      <div className="inline-flex size-7 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
        {step}
      </div>
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
