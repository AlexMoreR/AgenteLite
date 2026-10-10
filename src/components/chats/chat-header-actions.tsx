"use client";

import { InterruptorDeIA } from "./interruptor-ia";
import { Skeleton } from "@/components/ui/skeleton";
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
  /** Ya no se usan (el interruptor de la IA no navega): quedan opcionales por compatibilidad. */
  returnTo?: string;
  toggleAutomationAction?: (formData: FormData) => void | Promise<void>;
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
  source = "agent",
}: ChatHeaderActionsProps) {
  return (
    <>
      {/* Variante EN LÍNEA — solo visible cuando la cabecera es ancha (≥520px de contenedor). */}
      <div className="hidden items-center gap-1 @min-[520px]/chathdr:flex">
        {/* Llamar va primero: es la accion que se toma leyendo la conversacion, no al cerrarla. */}
        <BotonLlamar telefono={telefono} nombre={nombreContacto} avatarUrl={avatarUrl} channelId={channelId} />
        {contactId ? <CrmStageControl contactId={contactId} stage={stage} /> : null}
        <InterruptorDeIA conversationId={conversationId} automationPaused={automationPaused} source={source} />
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
 * La barra en silueta, mientras llegan los datos del chat (la fila de la lista no los traia).
 *
 * Mismas piezas y mismo alto que BarraDeAccionesDelChat (etapa, agente, asignar y, al final,
 * resolver/posponer), para que al llegar los datos reales la barra no salte ni empuje los mensajes.
 */
export function BarraDeAccionesEnSilueta() {
  return (
    <div className="contents" aria-hidden="true">
      <Skeleton className="h-5 w-14 rounded-full" />
      <Skeleton className="h-[1.15rem] w-8 rounded-full" />
      <span className="mx-0.5 h-5 w-px bg-border" />
      <Skeleton className="size-8 rounded-lg" />
      <div className="order-last flex items-center gap-1.5">
        <span className="mx-0.5 h-5 w-px bg-border" />
        <Skeleton className="h-8 w-11 rounded-lg" />
      </div>
    </div>
  );
}

/**
 * La barra de abajo de la cabecera, cuando la cabecera es angosta (celular, o ficha abierta).
 *
 * Antes todo esto vivia en tres puntos: para pausar al agente o cambiar la etapa habia que abrir
 * un menu, y desde el celular -donde mas se usa- nadie lo encontraba. Aca queda a la vista y a un
 * toque, como los botones de primera accion de los CRM de chat (Alex, 03-10-2026).
 *
 * Esta parte trae lo del chat (etapa, agente, asignar, y al final resolver y posponer). Las de la
 * conversacion que viven en el panel -nota, seguimiento, etiquetas- las agrega el panel en el medio.
 */
export function BarraDeAccionesDelChat({
  contactId,
  stage,
  conversationId,
  automationPaused,
  status,
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
  /*
    `contents`: los hijos se acomodan directo en la fila del panel. Asi Resolver y Posponer -las
    dos salidas del chat- quedan AL FINAL, despues de nota, seguimiento y etiquetas que agrega el
    panel (order-last), y no en el medio (Alex, 03-10-2026).
  */
  return (
    <div className="contents">
      {contactId ? <CrmStageControl contactId={contactId} stage={stage} variant="chip" /> : null}
      {/* Con la etiqueta "IA" a la vista: en el celular el interruptor solo no se entendia. */}
      <InterruptorDeIA conversationId={conversationId} automationPaused={automationPaused} source={source} conEtiqueta />
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
      <AssignChatControl conversationId={conversationId} assignee={assignee} source={source} compacto />
      <div className="order-last flex items-center gap-1.5">
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
        {/* Resolver y Posponer en UN boton con menu. Sin ficha del CRM no se puede posponer:
            ahi queda solo el de resolver. */}
        {contactId ? (
          <SnoozeChatControl
            contactId={contactId}
            conversationId={conversationId}
            source={source}
            estado={status}
            compacto
          />
        ) : (
          <ResolveChatControl conversationId={conversationId} status={status} source={source} compacto />
        )}
      </div>
    </div>
  );
}
