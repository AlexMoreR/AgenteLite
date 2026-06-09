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

  return (
    <section className="space-y-5 p-6">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={effectiveErrorMessage}
        okTitle="WhatsApp listo"
        errorTitle="No pudimos completar la conexion"
      />

      {!isConnected ? <WhatsappQrAutoRefresh isConnected={isConnected} /> : null}

      {isConnected ? (
        <>
          <Card>
            <CardContent className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-2.5">
                <Avatar className="size-10 rounded-md">
                  {connection.logoUrl ? (
                    <AvatarImage src={connection.logoUrl} alt={`Logo de ${connection.name}`} className="object-cover" />
                  ) : null}
                  <AvatarFallback className="rounded-md bg-emerald-500/10 text-emerald-600">
                    <CheckCircle2 className="size-5" />
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 space-y-0.5">
                  <h2 className="truncate text-sm font-semibold text-foreground">{connection.name}</h2>
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
                    { name: "returnTo", value: `/cliente/conexion/whatsapp-business/${connection.id}` },
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

          <ConnectionTabs
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
            ajustes={
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
                    returnTo={`/cliente/conexion/whatsapp-business/${connection.id}`}
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
                          { name: "returnTo", value: `/cliente/conexion/whatsapp-business/${connection.id}` },
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
                        returnTo={`/cliente/conexion/whatsapp-business/${connection.id}`}
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
                        returnTo={`/cliente/conexion/whatsapp-business/${connection.id}`}
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
