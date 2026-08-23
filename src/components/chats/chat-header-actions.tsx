"use client";

import { MoreVertical } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FormActionSwitch } from "@/components/ui/form-action-switch";
import { CrmStageControl } from "./crm-stage-control";
import { ResolveChatControl } from "./resolve-chat-control";
import { SnoozeChatControl } from "./snooze-chat-control";
import type { CrmStage } from "@/features/crm/types";
import { BotonLlamar } from "@/features/llamadas/components/BotonLlamar";

type ChatHeaderActionsProps = {
  contactId: string | null;
  stage: CrmStage;
  /** Numero marcable del cliente. Null cuando solo hay un LID y no se puede llamar. */
  telefono?: string | null;
  nombreContacto?: string;
  avatarUrl?: string | null;
  conversationId: string;
  automationPaused: boolean;
  status: "OPEN" | "PENDING" | "CLOSED" | "ARCHIVED";
  returnTo: string;
  toggleAutomationAction: (formData: FormData) => void | Promise<void>;
  source?: "agent" | "official";
};

// Acciones de la cabecera del chat (Etapa CRM, pausar agente IA, resolver).
// Se muestran EN LÍNEA cuando la cabecera tiene ancho; se colapsan en un menú de 3 puntos
// cuando el espacio es angosto (móvil O panel de contacto abierto que estrecha la cabecera).
// El corte se hace por CONTAINER QUERY (@container/chathdr, definido en chat-conversation-panel)
// y NO por ancho de pantalla: así reacciona al panel abierto, que antes dejaba los controles
// apilados y diminutos. Se renderizan ambas variantes y el CSS muestra solo la que aplica.
export function ChatHeaderActions({
  contactId,
  stage,
  telefono = null,
  nombreContacto = "",
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
        <BotonLlamar telefono={telefono} nombre={nombreContacto} avatarUrl={avatarUrl} />
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

      {/* Variante 3 PUNTOS — visible cuando la cabecera es angosta (panel abierto o móvil). */}
      {/* En el celular "Llamar" NO se esconde en los tres puntos: es la accion mas frecuente
          leyendo un chat, y sepultarla a dos toques la volvia invisible. Va suelta, a la
          izquierda del menu, igual que en WhatsApp. */}
      <div className="flex items-center gap-0.5 @min-[520px]/chathdr:hidden">
        <BotonLlamar telefono={telefono} nombre={nombreContacto} avatarUrl={avatarUrl} />
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-foreground transition hover:opacity-70 focus:outline-none focus:ring-2 focus:ring-ring/50"
              aria-label="Acciones de la conversación"
              title="Acciones"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            side="bottom"
            sideOffset={8}
            className="w-64 rounded-2xl border border-border bg-popover p-2 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.35)]"
          >
            <div className="space-y-0.5">
              {contactId ? (
                <div className="flex items-center justify-between gap-2 rounded-xl px-2 py-2">
                  <span className="text-[13px] font-medium text-foreground">Etapa</span>
                  <CrmStageControl contactId={contactId} stage={stage} />
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2 rounded-xl px-2 py-2">
                <span className="text-[13px] font-medium text-foreground">Pausar agente</span>
                <FormActionSwitch
                  action={toggleAutomationAction}
                  checked={!automationPaused}
                  ariaLabel={switchAriaLabel}
                  hiddenFields={switchHiddenFields}
                />
              </div>
              <div className="flex items-center justify-between gap-2 rounded-xl px-2 py-2">
                <span className="text-[13px] font-medium text-foreground">Conversación</span>
                <ResolveChatControl conversationId={conversationId} status={status} source={source} />
                {contactId ? (
                  <SnoozeChatControl contactId={contactId} conversationId={conversationId} source={source} />
                ) : null}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}
