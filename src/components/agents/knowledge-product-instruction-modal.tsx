"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, X } from "lucide-react";
import { saveAgentKnowledgeProductInstructionAction } from "@/app/actions/agent-actions";

type FlowOption = {
  id: string;
  title: string;
  badge: string;
  description: string;
};

type KnowledgeProductInstructionModalProps = {
  agentId: string;
  productId: string;
  productName: string;
  categoryName: string;
  instructions: string;
  isSelected: boolean;
  flows: FlowOption[];
};

function SubmitButton() {
  return (
    <button
      type="submit"
      className="inline-flex h-10 items-center justify-center rounded-xl bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
    >
      Guardar instruccion
    </button>
  );
}

export function KnowledgeProductInstructionModal({
  agentId,
  productId,
  productName,
  categoryName,
  instructions,
  isSelected,
  flows,
}: KnowledgeProductInstructionModalProps) {
  const [open, setOpen] = useState(false);
  const [instructionValue, setInstructionValue] = useState(instructions);
  const [slashSearch, setSlashSearch] = useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const normalizedQuery = slashSearch?.query.trim().toLowerCase() ?? "";
  const filteredFlows = useMemo(() => {
    if (!slashSearch) {
      return [];
    }

    return flows
      .filter((flow) => {
        if (!normalizedQuery) {
          return true;
        }

        return `${flow.title} ${flow.description} ${flow.badge}`.toLowerCase().includes(normalizedQuery);
      })
      .slice(0, 6);
  }, [flows, normalizedQuery, slashSearch]);

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

  const updateSlashSearch = (nextValue: string, caretPosition: number | null) => {
    if (caretPosition === null) {
      setSlashSearch(null);
      return;
    }

    const beforeCaret = nextValue.slice(0, caretPosition);
    const slashIndex = beforeCaret.lastIndexOf("/");
    if (slashIndex < 0) {
      setSlashSearch(null);
      return;
    }

    const previousCharacter = slashIndex > 0 ? beforeCaret[slashIndex - 1] : "";
    const query = beforeCaret.slice(slashIndex + 1);
    if ((previousCharacter && !/\s/.test(previousCharacter)) || query.includes("\n")) {
      setSlashSearch(null);
      return;
    }

    setSlashSearch({
      start: slashIndex,
      end: caretPosition,
      query,
    });
  };

  const insertFlowReference = (flow: FlowOption) => {
    if (!slashSearch) {
      return;
    }

    const reference = `/${flow.title}`;
    const prefix = instructionValue.slice(0, slashSearch.start);
    const suffix = instructionValue.slice(slashSearch.end);
    const needsSpace = suffix.startsWith(" ") || suffix.startsWith("\n") || suffix.length === 0 ? "" : " ";
    const nextValue = `${prefix}${reference}${needsSpace}${suffix}`;
    const nextCaret = prefix.length + reference.length + needsSpace.length;

    setInstructionValue(nextValue);
    setSlashSearch(null);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setInstructionValue(instructions);
          setSlashSearch(null);
          setOpen(true);
        }}
        className="min-w-0 flex-1 rounded-lg px-1 py-1 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color-mix(in_srgb,var(--primary)_14%,white)]"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-[15px] font-semibold text-slate-900">{productName}</p>
          <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200">
            {categoryName}
          </span>
          {isSelected ? (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_8%,white)] px-2 py-0.5 text-[10px] font-medium text-[var(--primary)]">
              Seleccionado
            </span>
          ) : null}
          {instructions.trim() ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-100">
              <FileText className="h-3 w-3" />
              Instruccion
            </span>
          ) : null}
        </div>
      </button>

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
                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--primary)]">Conocimiento del producto</p>
                    <h2 id={titleId} className="mt-1 text-lg font-semibold tracking-[-0.03em] text-slate-950">
                      {productName}
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

                <form action={saveAgentKnowledgeProductInstructionAction} className="min-h-0 overflow-y-auto px-5 py-5">
                  <input type="hidden" name="agentId" value={agentId} />
                  <input type="hidden" name="productId" value={productId} />

                  <label className="block">
                    <span className="text-sm font-semibold text-slate-900">Instruccion:</span>
                    {slashSearch ? (
                      <div className="mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_40px_-28px_rgba(15,23,42,0.35)]">
                        {flows.length === 0 ? (
                          <div className="px-3 py-3 text-sm text-slate-500">Todavia no hay flujos creados.</div>
                        ) : filteredFlows.length > 0 ? (
                          filteredFlows.map((flow) => (
                            <button
                              key={flow.id}
                              type="button"
                              onClick={() => insertFlowReference(flow)}
                              className="flex w-full items-start gap-3 border-b border-slate-100 px-3 py-2.5 text-left transition last:border-b-0 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color-mix(in_srgb,var(--primary)_12%,white)]"
                            >
                              <span className="mt-0.5 rounded-full bg-[color-mix(in_srgb,var(--primary)_8%,white)] px-2 py-0.5 text-[10px] font-semibold text-[var(--primary)]">
                                {flow.badge}
                              </span>
                              <span className="min-w-0">
                                <span className="block text-sm font-semibold text-slate-900">/{flow.title}</span>
                                <span className="line-clamp-1 block text-xs text-slate-500">{flow.description}</span>
                              </span>
                            </button>
                          ))
                        ) : (
                          <div className="px-3 py-3 text-sm text-slate-500">No hay flujos con ese nombre.</div>
                        )}
                      </div>
                    ) : null}
                    <textarea
                      ref={textareaRef}
                      name="instructions"
                      value={instructionValue}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setInstructionValue(nextValue);
                        updateSlashSearch(nextValue, event.target.selectionStart);
                      }}
                      onClick={(event) => updateSlashSearch(instructionValue, event.currentTarget.selectionStart)}
                      onKeyUp={(event) => updateSlashSearch(instructionValue, event.currentTarget.selectionStart)}
                      rows={10}
                      placeholder="Entrena tu agente con la informacion de tu producto"
                      className="mt-2 min-h-56 w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)] focus:ring-4 focus:ring-[color-mix(in_srgb,var(--primary)_12%,white)]"
                    />
                  </label>

                  <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300"
                    >
                      Cancelar
                    </button>
                    <SubmitButton />
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
