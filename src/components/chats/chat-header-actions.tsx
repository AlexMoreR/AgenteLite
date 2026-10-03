"use client";

import { FormActionSwitch } from "@/components/ui/form-action-switch";
import { CrmStageControl } from "./crm-stage-control";
import { ResolveChatControl } from "./resolve-chat-control";
import { SnoozeChatControl } from "./snooze-chat-control";
import type { CrmStage } from "@/features/crm/types";
import { BotonLlamar } from "@/features/llamadas/components/BotonLlamar";
import { AssignChatControl } from "./assign-chat-control";

type ChatHeaderActionsProps = {
  contactId: string | null;
  stage: CrmStage;
  /** Numero marcable del cliente. Null cuando solo hay un LID y no se puede llamar. */
  telefono?: string | null;
  nombreContacto?: string;
  channelId?: string | null;
  avatarUrl?: string | null;
  conversationId: string;
  automationPaused: boolean;
  status: "OPEN" | "PENDING" | "CLOSED" | "ARCHIVED";
  returnTo: string;
  toggleAutomationAction: (formData: FormData) => void | Promise<void>;
  source?: "agent" | "official";
};

// Acciones de la cabecera del chat (Etapa CRM, pausar agente IA, resolver).
// Se muestran EN LÍNEA cuando la cabecera tiene ancho; cuando es angosta (móvil O panel de
// contacto abierto que estrecha la cabecera) pasan a la barra de abajo (BarraDeAccionesDelChat).
// El corte se hace por CONTAINER QUERY (@container/chathdr, definido en chat-conversation-panel)
// y NO por ancho de pantalla: así reacciona al panel abierto, que antes dejaba los controles
// apilados y diminutos. Se renderizan ambas variantes y el CSS muestra solo la que aplica.
export function ChatHeaderActions({
  contactId,
  stage,
  telefono = null,
  nombreContacto = "",
  channelId = null,
  avatarUrl = null,
  conversationId,
  automationPaused,
  status,
  returnTo,
  toggleAutomationAction,
  source = "agent",
}: ChatHeaderActionsProps) {
  const switchHiddenFields = [
    { name: "conversationId", value: conversationId },
    { name: "returnTo", value: returnTo },
  ];
  const switchAriaLabel = automationPaused ? "Reactivar IA" : "Pausar IA";

  return (
    <>
      {/* Variante EN LÍNEA — solo visible cuando la cabecera es ancha (≥520px de contenedor). */}
      <div className="hidden items-center gap-1 @min-[520px]/chathdr:flex">
        {/* Llamar va primero: es la accion que se toma leyendo la conversacion, no al cerrarla. */}
        <BotonLlamar telefono={telefono} nombre={nombreContacto} avatarUrl={avatarUrl} channelId={channelId} />
        {contactId ? <CrmStageControl contactId={contactId} stage={stage} /> : null}
        <FormActionSwitch
          action={toggleAutomationAction}
          checked={!automationPaused}
          ariaLabel={switchAriaLabel}
          hiddenFields={switchHiddenFields}
        />
        <ResolveChatControl conversationId={conversationId} status={status} source={source} />
        {/* Las dos salidas del chat: resolver es "esto se termino", posponer es "sigue, pero
            no hoy". Por eso van pegados. */}
        {contactId ? (
          <SnoozeChatControl contactId={contactId} conversationId={conversationId} source={source} />
        ) : null}
      </div>

      {/* Variante ANGOSTA (celular, o ficha del contacto abierta): arriba queda solo "Llamar", que
          es la accion mas frecuente leyendo un chat, igual que en WhatsApp. Lo demas -etapa,
          agente, resolver, posponer- va en la barra de abajo de la cabecera
          (BarraDeAccionesDelChat), a un toque y a la vista, en vez de escondido en tres puntos
          (Alex, 03-10-2026). */}
      <div className="flex items-center gap-0.5 @min-[520px]/chathdr:hidden">
        <BotonLlamar telefono={telefono} nombre={nombreContacto} avatarUrl={avatarUrl} channelId={channelId} />
      </div>
    </>
  );
}

/**
 * La barra de abajo de la cabecera, cuando la cabecera es angosta (celular, o ficha abierta).
 *
 * Antes todo esto vivia en tres puntos: para pausar al agente o cambiar la etapa habia que abrir
 * un menu, y desde el celular -donde mas se usa- nadie lo encontraba. Aca queda a la vista y a un
 * toque, como los botones de primera accion de los CRM de chat (Alex, 03-10-2026).
 *
 * Esta parte trae lo del chat (etapa, agente, resolver, posponer, asignar). Las de la
 * conversacion que viven en el panel -nota, seguimiento, etiquetas- las agrega el panel al lado.
 */
export function BarraDeAccionesDelChat({
  contactId,
  stage,
  conversationId,
  automationPaused,
  status,
  returnTo,
  toggleAutomationAction,
  source = "agent",
  assignee,
}: Pick<
  ChatHeaderActionsProps,
  | "contactId"
  | "stage"
  | "conversationId"
  | "automationPaused"
  | "status"
  | "returnTo"
  | "toggleAutomationAction"
  | "source"
> & {
  assignee: { id: string; name: string | null; email: string } | null;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {contactId ? <CrmStageControl contactId={contactId} stage={stage} variant="chip" /> : null}
      <span title={automationPaused ? "Agente apagado en este chat" : "Agente encendido en este chat"} className="inline-flex">
        <FormActionSwitch
          action={toggleAutomationAction}
          checked={!automationPaused}
          ariaLabel={automationPaused ? "Reactivar IA" : "Pausar IA"}
          hiddenFields={[
            { name: "conversationId", value: conversationId },
            { name: "returnTo", value: returnTo },
          ]}
        />
      </span>
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
      <ResolveChatControl conversationId={conversationId} status={status} source={source} compacto />
      {contactId ? (
        <SnoozeChatControl contactId={contactId} conversationId={conversationId} source={source} compacto />
      ) : null}
      <AssignChatControl conversationId={conversationId} assignee={assignee} source={source} compacto />
    </div>
  );
}
