"use client";

import { MoreVertical } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FormActionSwitch } from "@/components/ui/form-action-switch";
import { CrmStageControl } from "./crm-stage-control";
import { ImportHistoryControl } from "./import-history-control";
import { ResolveChatControl } from "./resolve-chat-control";
import type { CrmStage } from "@/features/crm/types";

type ChatHeaderActionsProps = {
  contactId: string | null;
  stage: CrmStage;
  conversationId: string;
  automationPaused: boolean;
  status: "OPEN" | "PENDING" | "CLOSED" | "ARCHIVED";
  returnTo: string;
  toggleAutomationAction: (formData: FormData) => void | Promise<void>;
  source?: "agent" | "official";
  // Solo los canales Evolution API guardan historial: evogo no lo expone (404) porque no
  // guarda mensajes. Sin esto el boton aparece en Ventas y falla en la cara de la asesora.
  canImportHistory?: boolean;
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
  conversationId,
  automationPaused,
  status,
  returnTo,
  toggleAutomationAction,
  source = "agent",
  canImportHistory = false,
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
        {contactId ? <CrmStageControl contactId={contactId} stage={stage} /> : null}
        <FormActionSwitch
          action={toggleAutomationAction}
          checked={!automationPaused}
          ariaLabel={switchAriaLabel}
          hiddenFields={switchHiddenFields}
        />
        {/* Solo WhatsApp: la API oficial no expone historial para traer. */}
        {source === "agent" && canImportHistory ? <ImportHistoryControl conversationId={conversationId} /> : null}
        <ResolveChatControl conversationId={conversationId} status={status} source={source} />
      </div>

      {/* Variante 3 PUNTOS — visible cuando la cabecera es angosta (panel abierto o móvil). */}
      <div className="@min-[520px]/chathdr:hidden">
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
              {source === "agent" && canImportHistory ? (
                <div className="flex items-center justify-between gap-2 rounded-xl px-2 py-2">
                  <span className="text-[13px] font-medium text-foreground">Historial de WhatsApp</span>
                  <ImportHistoryControl conversationId={conversationId} withLabel />
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2 rounded-xl px-2 py-2">
                <span className="text-[13px] font-medium text-foreground">Conversación</span>
                <ResolveChatControl conversationId={conversationId} status={status} source={source} />
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}
