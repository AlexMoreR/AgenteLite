"use client";

import { useEffect, useActionState, useState, useCallback, useTransition } from "react";
import { X, Plus, Check } from "lucide-react";
import { BsFillTagFill } from "react-icons/bs";
import {
  getEtiquetasAction,
  createEtiquetaAction,
  getContactTagIdsAction,
  toggleContactTagAction,
  type EtiquetaItem,
} from "@/app/actions/chats-actions";

const PRESET_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#64748b",
];

type Props = {
  open: boolean;
  onClose: () => void;
  contactId?: string | null;
};

const createInitialState: { error?: string; success?: boolean } = {};

export function EtiquetaModal({ open, onClose, contactId }: Props) {
  const [etiquetas, setEtiquetas] = useState<EtiquetaItem[]>([]);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);
  const [state, formAction, isPending] = useActionState(createEtiquetaAction, createInitialState);
  const [toggling, startToggle] = useTransition();

  const loadAll = useCallback(async () => {
    const [tagsResult, assignedResult] = await Promise.all([
      getEtiquetasAction(),
      contactId ? getContactTagIdsAction(contactId) : Promise.resolve({ tagIds: [] }),
    ]);

    return {
      etiquetas: tagsResult.items ?? [],
      assignedIds: new Set(assignedResult.tagIds ?? []),
    };
  }, [contactId]);

  useEffect(() => {
    if (open) {
      void loadAll().then((next) => {
        setEtiquetas(next.etiquetas);
        setAssignedIds(next.assignedIds);
        setShowForm(false);
        setSelectedColor(PRESET_COLORS[0]);
      });
    }
  }, [open, loadAll]);

  useEffect(() => {
    if (state.success) {
      void loadAll().then((next) => {
        setEtiquetas(next.etiquetas);
        setAssignedIds(next.assignedIds);
        setShowForm(false);
        setSelectedColor(PRESET_COLORS[0]);
      });
    }
  }, [state.success, loadAll]);

  const handleToggle = (tagId: string) => {
    if (!contactId || toggling) return;
    startToggle(async () => {
      const nextAssignedIds = new Set(assignedIds);
      if (nextAssignedIds.has(tagId)) nextAssignedIds.delete(tagId);
      else nextAssignedIds.add(tagId);

      setAssignedIds((prev) => {
        const next = new Set(prev);
        if (next.has(tagId)) next.delete(tagId);
        else next.add(tagId);
        return next;
      });
      const result = await toggleContactTagAction(contactId, tagId);
      if (result.error) {
        setAssignedIds((prev) => {
          const next = new Set(prev);
          if (next.has(tagId)) next.delete(tagId);
          else next.add(tagId);
          return next;
        });
        return;
      }

      const nextTags = etiquetas
        .filter((tag) => nextAssignedIds.has(tag.id))
        .map((tag) => ({
          label: tag.name,
          color: tag.color,
        }));

      window.dispatchEvent(
        new CustomEvent("chat-tags-updated", {
          detail: {
            contactId,
            tags: nextTags,
            assignedTagIds: Array.from(nextAssignedIds),
          },
        }),
      );
    });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-xs flex-col rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative flex items-center justify-center border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Etiquetas</h2>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-5 inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Lista */}
        <div className="min-h-0 max-h-64 overflow-y-auto px-3 py-2">
          {etiquetas.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-400">Sin etiquetas aún</p>
          ) : (
            <ul className="space-y-0.5">
              {etiquetas.map((tag) => {
                const isAssigned = assignedIds.has(tag.id);
                return (
                  <li key={tag.id}>
                    <button
                      type="button"
                      onClick={() => handleToggle(tag.id)}
                      disabled={!contactId || toggling}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <BsFillTagFill
                        className="h-3.5 w-3.5 shrink-0"
                        style={{ color: tag.color }}
                      />
                      <span className="flex-1 text-left text-[13px] text-slate-700">{tag.name}</span>
                      {isAssigned ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-[var(--primary)]" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Formulario de creación */}
        {showForm ? (
          <div className="border-t border-slate-100 px-4 pb-4 pt-3">
            <form
              action={(fd) => {
                fd.set("color", selectedColor);
                formAction(fd);
              }}
              className="space-y-3"
            >
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  Nombre
                </label>
                <input
                  name="name"
                  autoFocus
                  placeholder="Nombre de la etiqueta"
                  className="h-9 w-full rounded-[12px] border border-slate-200 bg-white px-3 text-[13px] text-slate-800 outline-none transition focus:border-[var(--primary)]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  Color
                </label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setSelectedColor(color)}
                      className="h-6 w-6 rounded-full transition-transform hover:scale-110"
                      style={{
                        backgroundColor: color,
                        outline: selectedColor === color ? `2px solid ${color}` : "none",
                        outlineOffset: "2px",
                      }}
                      aria-label={color}
                    />
                  ))}
                </div>
              </div>
              {state.error ? (
                <p className="text-xs text-rose-500">{state.error}</p>
              ) : null}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="h-8 flex-1 rounded-[10px] border border-slate-200 text-[12px] text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="h-8 flex-1 rounded-[10px] bg-[var(--primary)] text-[12px] font-semibold text-white disabled:opacity-60"
                >
                  {isPending ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="border-t border-slate-100 p-3">
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <Plus className="h-4 w-4 text-slate-400" />
              Crear etiqueta
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
