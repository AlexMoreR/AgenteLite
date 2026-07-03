import Link from "next/link";
import { Bot, CheckCircle2, MessageSquareReply, Power, Smartphone, TimerReset, UserRound, Volume2 } from "lucide-react";
import {
  saveAgentReactivationMessageAction,
  saveAgentResponseDelayAction,
  toggleAgentStatusAction,
} from "@/app/actions/agent-actions";
import { assignConnectionChannelAction, toggleConnectionChannelStatusAction } from "@/app/actions/connection-actions";
import { WhatsappQrAutoRefresh } from "@/components/agents/whatsapp-qr-auto-refresh";
import { WhatsappQrCountdown } from "@/components/agents/whatsapp-qr-countdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormActionSwitch } from "@/components/ui/form-action-switch";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ConnectionTabs } from "./ConnectionTabs";
import { EvolutionChatSyncDialog } from "./EvolutionChatSyncDialog";
import { AgentAssignAutosaveForm, ReactivationAutosaveForm, ResponseDelayAutosaveForm } from "./ConnectionAutosaveControls";
import { NotificationSoundSelect } from "@/components/chats/notification-sound-select";
import { ChannelCollaboratorsForm } from "./ChannelCollaboratorsForm";
import { OfficialApiConnectionSetupCard } from "./OfficialApiConnectionSetupCard";

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
  const connectionStatusLabel = isConnected ? "Conectado" : "Desconectado";

  const headerCard = (
    <Card>
      <CardContent className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-2.5">
          <Avatar className="size-10 rounded-md">
            {connection.logoUrl ? (
              <AvatarImage src={connection.logoUrl} alt={`Logo de ${connection.name}`} className="object-cover" />
            ) : null}
            <AvatarFallback
              className={
                isConnected
                  ? "rounded-md bg-emerald-500/10 text-emerald-600"
                  : "rounded-md bg-primary/10 text-primary"
              }
            >
              {isConnected ? <CheckCircle2 className="size-5" /> : <Smartphone className="size-5" />}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-foreground">{connection.name}</h2>
              <StatusPill label={connectionStatusLabel} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
              <div className="inline-flex items-center gap-1.5">
                <Smartphone className="size-3.5" />
                <span>{providerLabel}</span>
              </div>
              <div className="inline-flex items-center gap-1.5">
                <Bot className="size-3.5 text-primary" />
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
              { name: "returnTo", value: connectionReturnTo },
            ]}
          />

          {connection.agentId ? (
            <Button asChild>
              <Link href={`/cliente/agentes/${connection.agentId}`}>Ir al agente</Link>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );

  const agentTabContent = (
    <div className="space-y-4">
      {availableAgents.length ? (
        <div className="grid gap-4 md:grid-cols-2">
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
        </div>
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
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
}

function StatusPill({ label }: { label: string }) {
  const dotTone = label === "Conectado" ? "bg-emerald-500" : "bg-muted-foreground";

  return (
    <Badge variant="outline" className="gap-1.5">
      <span className={`size-1.5 rounded-full ${dotTone}`} />
      {label}
    </Badge>
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
