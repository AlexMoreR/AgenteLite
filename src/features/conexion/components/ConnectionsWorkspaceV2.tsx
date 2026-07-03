import type { ReactNode } from "react";
import Link from "next/link";
import {
  FiCpu,
  FiLink,
  FiMail,
  FiMessageCircle,
  FiTrash2,
} from "react-icons/fi";
import { Bot, MoreHorizontal } from "lucide-react";
import {
  assignConnectionChannelAction,
  deleteConnectionChannelAction,
  toggleConnectionChannelStatusAction,
} from "@/app/actions/connection-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormActionSwitch } from "@/components/ui/form-action-switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";

type ConnectionsWorkspaceProps = {
  officialApiEmbeddedSignupReady: boolean;
  officialApiProviderAppId: string;
  officialApiProviderConfigId: string;
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
  officialApiEmbeddedSignupReady,
  officialApiProviderAppId,
  officialApiProviderConfigId,
  canSeeOfficialApiModule,
  okMessage,
  errorMessage,
  targetAgent,
  items,
}: ConnectionsWorkspaceProps) {
  return (
    <section className="app-page w-full space-y-5 px-6 pb-6 pt-4">
      <QueryFeedbackToast
        okMessage={okMessage}
        errorMessage={errorMessage}
        okTitle="Agente listo"
        errorTitle="No pudimos continuar"
      />

      {targetAgent ? (
        <Card>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FiLink className="size-5" />
              </span>
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">Agente seleccionado</p>
                <p className="text-base font-semibold text-foreground">{targetAgent.name}</p>
                <p className="text-sm text-muted-foreground">
                  Crea un canal nuevo o usa uno existente para vincularlo a este agente.
                </p>
              </div>
            </div>

            <Button asChild variant="outline">
              <Link href={`/cliente/agentes/${targetAgent.id}`}>Ver agente</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="w-full space-y-3">
        {items.length ? (
          <div className="grid w-full gap-4">
            {items.map((item) => {
              const detailHref = `/cliente/conexion/whatsapp-business/${item.id}`;
              const canAssignToTargetAgent = Boolean(targetAgent && item.linkedAgentId !== targetAgent.id);

              return (
                <Card key={item.id} className="relative py-3 transition hover:ring-foreground/20">
                  <Link href={detailHref} aria-label={`Abrir ${item.name}`} className="absolute inset-0 z-0" />

                  <CardContent className="pointer-events-none relative z-10 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <span className="inline-flex size-8 shrink-0 items-center justify-center text-emerald-600">
                        <WhatsAppGlyph className="size-5" />
                      </span>

                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-foreground">{item.name}</h3>
                          {item.linkedAgentName ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                              <Bot className="size-3" />
                              {item.linkedAgentName}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                              <FiCpu className="size-3" />
                              Sin agente
                            </span>
                          )}
                        </div>

                        {item.phoneNumber ? (
                          <span className="text-xs text-muted-foreground">{item.phoneNumber}</span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5 xl:justify-end">
                      <StatusPill label={item.channelStatusLabel} />
                      <FormActionSwitch
                        action={toggleConnectionChannelStatusAction}
                        checked={item.isActive}
                        ariaLabel={item.isActive ? `Apagar ${item.name}` : `Encender ${item.name}`}
                        hiddenFields={[
                          { name: "channelId", value: item.id },
                          { name: "returnTo", value: "/cliente/conexion" },
                        ]}
                        wrapperClassName="pointer-events-auto relative z-20"
                      />
                      <MetricPill icon={<FiMessageCircle className="size-4" />} value={String(item.conversationsCount)} />
                      <MetricPill icon={<FiMail className="size-4" />} value={String(item.messagesCount)} />

                      {canAssignToTargetAgent ? (
                        <form action={assignConnectionChannelAction} className="pointer-events-auto relative z-20">
                          <input type="hidden" name="channelId" value={item.id} />
                          <input type="hidden" name="agentId" value={targetAgent?.id} />
                          <input
                            type="hidden"
                            name="returnTo"
                            value={targetAgent ? `/cliente/conexion?agentId=${targetAgent.id}` : "/cliente/conexion"}
                          />
                          <Button type="submit" size="sm">
                            <FiLink />
                            Asignar a este agente
                          </Button>
                        </form>
                      ) : null}

                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="pointer-events-auto relative z-20"
                          render={
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Acciones para ${item.name}`} />
                          }
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <form action={deleteConnectionChannelAction}>
                            <input type="hidden" name="channelId" value={item.id} />
                            <DropdownMenuItem variant="destructive" className="w-full" render={<button type="submit" />}>
                              <FiTrash2 />
                              Eliminar
                            </DropdownMenuItem>
                          </form>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="border border-dashed">
            <CardContent className="text-sm text-muted-foreground">
              Aun no hay conexiones creadas. Usa el boton de nuevo canal para comenzar.
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}

function StatusPill({ label }: { label: string }) {
  const dotTone =
    label === "Conectado" ? "bg-emerald-500" : label === "Esperando QR" ? "bg-amber-500" : "bg-muted-foreground";

  return (
    <Badge variant="outline" className="gap-1.5 uppercase">
      <span className={`size-1.5 rounded-full ${dotTone}`} />
      {label}
    </Badge>
  );
}

function MetricPill({ icon, value }: { icon: ReactNode; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      {icon}
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
