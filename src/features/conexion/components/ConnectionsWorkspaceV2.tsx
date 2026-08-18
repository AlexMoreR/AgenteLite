import Link from "next/link";
// `Link` ya es el de next/link en este archivo, asi que el icono entra con otro nombre.
import { Link as LinkIcon, Smartphone } from "lucide-react";
import { assignConnectionChannelAction } from "@/app/actions/connection-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { QueryFeedbackToast } from "@/components/ui/query-feedback-toast";
import { ConnectionCardMenu } from "./ConnectionCardMenu";

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
                <LinkIcon className="size-5" />
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
              const isConnected = item.channelStatusLabel === "Conectado";

              return (
                <Card
                  key={item.id}
                  className="group relative overflow-hidden py-0 transition hover:shadow-md hover:ring-1 hover:ring-foreground/10"
                >
                  <span
                    className={`absolute inset-y-0 left-0 w-1 ${isConnected ? "bg-emerald-500" : "bg-muted-foreground/25"}`}
                    aria-hidden="true"
                  />
                  <Link
                    href={detailHref}
                    aria-label={`Abrir ${item.name}`}
                    className="absolute inset-0 z-10"
                  />

                  {/* Los tres puntos van a la esquina, fuera de la fila de controles: son
                      acciones sobre la tarjeta entera (renombrar, borrar), no un control mas del
                      canal. En la fila competian con el interruptor, que es lo que se toca todos
                      los dias. z-20 para quedar por encima del Link que cubre la tarjeta. */}
                  <div className="absolute top-2 right-2 z-20">
                    <ConnectionCardMenu channelId={item.id} channelName={item.name} />
                  </div>
                  <CardContent className="relative flex flex-col gap-3 py-3.5 pl-5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 sm:flex-1">
                        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-md">
                          {/* El estado va como punto sobre el avatar, igual que en WhatsApp: se
                              lee de un vistazo y no gasta un renglon de la tarjeta. El texto
                              sigue existiendo para lectores de pantalla. */}
                          <span className="relative shrink-0">
                            <span className="inline-flex size-11 items-center justify-center rounded-full bg-muted text-emerald-600 ring-1 ring-border">
                              <WhatsAppGlyph className="size-6" />
                            </span>
                            <span
                              className={`absolute right-0 bottom-0 size-3.5 rounded-full ring-2 ring-card ${
                                isConnected
                                  ? "bg-emerald-500"
                                  : item.channelStatusLabel === "Esperando QR"
                                    ? "bg-amber-500"
                                    : "bg-muted-foreground/40"
                              }`}
                              title={item.channelStatusLabel}
                              aria-hidden="true"
                            />
                            <span className="sr-only">{item.channelStatusLabel}</span>
                          </span>

                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <h3 className="text-sm font-semibold text-foreground">{item.name}</h3>
                              {item.linkedAgentName ? (
                                <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                                  {item.linkedAgentName}
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                  Sin agente
                                </span>
                              )}
                            </div>

                            {item.phoneNumber ? (
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <Smartphone className="size-3 shrink-0" />
                                <span className="tabular-nums">{item.phoneNumber}</span>
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {/* Sin interruptor aca: prender o apagar un canal corta TODOS los mensajes
                          de ese numero, y en una lista se toca sin querer. Vive en el detalle del
                          canal, que es donde uno entra a propósito a cambiarlo. */}
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      {canAssignToTargetAgent ? (
                        <form action={assignConnectionChannelAction} className="relative z-20">
                          <input type="hidden" name="channelId" value={item.id} />
                          <input type="hidden" name="agentId" value={targetAgent?.id} />
                          <input
                            type="hidden"
                            name="returnTo"
                            value={targetAgent ? `/cliente/conexion?agentId=${targetAgent.id}` : "/cliente/conexion"}
                          />
                          <Button type="submit" size="sm">
                            <LinkIcon />
                            Asignar a este agente
                          </Button>
                        </form>
                      ) : null}

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

function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M19.05 4.94A9.9 9.9 0 0 0 12.02 2C6.51 2 2.02 6.48 2.02 12c0 1.76.46 3.48 1.33 5L2 22l5.15-1.34A9.95 9.95 0 0 0 12.02 22h.01c5.51 0 9.99-4.49 9.99-10 0-2.67-1.04-5.18-2.97-7.06Zm-7.03 15.38h-.01a8.3 8.3 0 0 1-4.23-1.16l-.3-.18-3.06.8.82-2.98-.2-.31a8.27 8.27 0 0 1-1.28-4.43c0-4.58 3.73-8.31 8.32-8.31 2.22 0 4.3.86 5.87 2.43a8.23 8.23 0 0 1 2.43 5.88c0 4.58-3.73 8.31-8.36 8.31Zm4.56-6.2c-.25-.12-1.47-.72-1.7-.8-.23-.08-.4-.12-.57.12-.17.25-.65.8-.8.96-.15.17-.3.19-.55.07-.25-.12-1.05-.39-2-1.24-.74-.66-1.24-1.47-1.39-1.72-.15-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.15.16-.25.24-.42.08-.17.04-.32-.02-.44-.06-.12-.57-1.37-.78-1.87-.2-.49-.4-.42-.57-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1 0 1.23.9 2.43 1.02 2.59.12.17 1.77 2.7 4.29 3.78.6.26 1.08.42 1.44.53.61.19 1.17.16 1.61.1.49-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.15-1.18-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  );
}
