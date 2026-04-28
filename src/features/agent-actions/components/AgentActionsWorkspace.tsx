"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";
import { BellRing, EllipsisVertical, Pencil, PhoneCall, Sparkles, Trash2, X, Zap } from "lucide-react";
import { deleteAgentActionsAction, saveAgentActionsAction } from "@/app/actions/agent-actions";
import { defaultAgentTrainingConfig, type AgentTrainingConfig } from "@/lib/agent-training";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type AgentActionsWorkspaceProps = {
  agentId: string;
  training: AgentTrainingConfig;
};

type ActionType = "notify";
type ModalMode = "create" | "edit";

function getActionDraft(training: AgentTrainingConfig) {
  const notifyAction = training.actions?.notify ?? defaultAgentTrainingConfig.actions.notify;

  return {
    actionType: "notify" as ActionType,
    instruction: notifyAction.instruction,
    phoneNumber: notifyAction.destinationPhoneNumber,
  };
}

export function AgentActionsWorkspace({ agentId, training }: AgentActionsWorkspaceProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ModalMode>("create");
  const [actionType, setActionType] = useState<ActionType>("notify");
  const [instruction, setInstruction] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const deleteFormRef = useRef<HTMLFormElement>(null);
  const notifyAction = training.actions?.notify ?? defaultAgentTrainingConfig.actions.notify;
  const titleId = useId();
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const hasExistingAction =
    Boolean(notifyAction.enabled) || Boolean(notifyAction.instruction.trim()) || Boolean(notifyAction.destinationPhoneNumber.trim());

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const openModal = (nextMode: ModalMode) => {
    const actionDraft = nextMode === "edit" ? getActionDraft(training) : {
      actionType: "notify" as ActionType,
      instruction: "",
      phoneNumber: "",
    };

    setActionType(actionDraft.actionType);
    setInstruction(actionDraft.instruction);
    setPhoneNumber(actionDraft.phoneNumber);
    setMode(nextMode);
    setOpen(true);
  };

  return (
    <>
      <Card className="border border-[rgba(148,163,184,0.14)] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] sm:p-5 lg:p-6">
        <div className="space-y-5">
          <div className="min-w-0 -mt-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex items-center gap-3">
                <BellRing className="h-6 w-6 text-[var(--primary)]" />
                <h1 className="text-[18px] font-semibold tracking-[-0.04em] text-slate-950">Acciones</h1>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => openModal("create")}
                className="h-10 rounded-xl border-[rgba(148,163,184,0.18)] bg-white px-4 text-sm font-medium text-slate-700 shadow-[0_8px_24px_rgba(15,23,42,0.03)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
              >
                <Zap className="h-4 w-4" />
                Agregar accion
              </Button>
            </div>
            <p className="max-w-3xl text-sm text-slate-600">
              Gestiona acciones automáticas que se ejecutan cuando el cliente expresa una intención concreta.
            </p>
          </div>

          <div className="overflow-hidden rounded-[20px] border border-[rgba(148,163,184,0.14)] bg-white">
            {hasExistingAction ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-white">
                    <tr className="text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                      <th className="px-4 py-3">Función</th>
                      <th className="px-4 py-3">Instrucción</th>
                      <th className="px-4 py-3">Destino</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    <tr className="align-top">
                      <td className="px-4 py-4">
                        <div className="text-sm font-semibold text-slate-900">Notificar</div>
                      </td>
                      <td className="px-4 py-4">
                        <p className="max-w-xl text-sm leading-6 text-slate-600">
                          {notifyAction.instruction.trim() || "Sin instrucción"}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-sm leading-6 text-slate-600">
                          {notifyAction.destinationPhoneNumber.trim() || "Sin número"}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,white)] px-3 py-1 text-xs font-medium text-[var(--primary)]">
                          <Sparkles className="h-3.5 w-3.5" />
                          {notifyAction.enabled ? "Activa" : "Inactiva"}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
                              aria-label="Abrir acciones"
                            >
                              <EllipsisVertical className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-44">
                            <DropdownMenuItem
                              className="cursor-pointer gap-2"
                              onSelect={() => openModal("edit")}
                            >
                              <Pencil className="h-4 w-4" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="cursor-pointer gap-2 text-rose-700 focus:text-rose-700"
                              onSelect={(event) => {
                                event.preventDefault();
                                if (!window.confirm("¿Quieres eliminar esta accion?")) {
                                  return;
                                }

                                deleteFormRef.current?.requestSubmit();
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                              Eliminar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-10 text-center">
                <p className="text-sm font-medium text-slate-900">Todavia no hay acciones creadas</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Usa el boton de arriba para crear la primera accion de este agente.
                </p>
              </div>
            )}
          </div>

          <form
            ref={deleteFormRef}
            action={deleteAgentActionsAction}
            className="hidden"
          >
            <input type="hidden" name="agentId" value={agentId} />
          </form>
        </div>
      </Card>

      {portalTarget && open
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setOpen(false);
                }
              }}
            >
              <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_32px_90px_-42px_rgba(15,23,42,0.55)]">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--primary)]">
                      {mode === "edit" ? "Editar acción" : "Nueva acción"}
                    </p>
                    <h2 id={titleId} className="mt-1 text-lg font-semibold tracking-[-0.03em] text-slate-950">
                      {mode === "edit" ? "Editar accion" : "Crear accion"}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
                    aria-label="Cerrar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <form action={saveAgentActionsAction} className="min-h-0 overflow-y-auto px-5 py-5">
                  <input type="hidden" name="agentId" value={agentId} />
                  <input type="hidden" name="notifyEnabled" value={actionType === "notify" ? "on" : "off"} />

                  <div className="space-y-4">
                    <label className="block space-y-2">
                      <span className="text-sm font-semibold text-slate-900">Instrucción</span>
                      <p className="text-sm leading-6 text-slate-500">
                        Describe la intención que disparará la acción. Ejemplo: cuando pidan hablar con una persona.
                      </p>
                      <textarea
                        name="notifyInstruction"
                        value={instruction}
                        onChange={(event) => setInstruction(event.target.value)}
                        rows={5}
                        placeholder="Escribe la intención que debe detectar el agente"
                        className="min-h-36 w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)] focus:ring-4 focus:ring-[color-mix(in_srgb,var(--primary)_12%,white)]"
                        required={actionType === "notify"}
                      />
                    </label>

                    <label className="block space-y-2">
                      <span className="text-sm font-semibold text-slate-900">Función</span>
                      <select
                        value={actionType}
                        onChange={(event) => setActionType(event.target.value as ActionType)}
                        className="field-select h-11 w-full rounded-[16px] border-[rgba(148,163,184,0.14)] bg-slate-50 text-[13px] focus:border-[var(--primary)]"
                      >
                        <option value="notify">Notificar</option>
                      </select>
                    </label>

                    {actionType === "notify" ? (
                      <label className="block space-y-2">
                        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                          Numero de celular
                          <PhoneCall className="h-3.5 w-3.5 text-slate-400" />
                        </span>
                        <input
                          name="notifyPhoneNumber"
                          type="tel"
                          value={phoneNumber}
                          onChange={(event) => setPhoneNumber(event.target.value)}
                          placeholder="Ej. 573001112233"
                          className="field-select h-11 rounded-[16px] border-[rgba(148,163,184,0.14)] bg-slate-50 text-[13px] focus:border-[var(--primary)]"
                          required={actionType === "notify"}
                        />
                        <p className="text-xs leading-5 text-slate-500">
                          Recibe la alerta por WhatsApp en este número cuando se detecte la intención.
                        </p>
                      </label>
                    ) : null}
                  </div>

                  <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
                    >
                      {mode === "edit" ? "Guardar cambios" : "Guardar la accion"}
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            portalTarget,
          )
        : null}
    </>
  );
}
