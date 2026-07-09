"use client";

import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { BsFillTagFill } from "react-icons/bs";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { TAG_BADGE_CLASS } from "@/lib/tag-badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  createEtiquetaAction,
  deleteEtiquetaAction,
  getContactTagIdsAction,
  getEtiquetasAction,
  toggleContactTagAction,
  type EtiquetaItem,
} from "@/app/actions/chats-actions";

const PRESET_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#64748b",
];

type DisplayTag = { label: string; color: string };

const createInitialState: { error?: string; success?: boolean } = {};

// Control unificado de etiquetas del chat: muestra las badges asignadas (cada una con un
// mini-menú "Quitar de este chat") y un botón "+" que abre un popover para agregar/crear.
// Reemplaza al modal de etiquetas. Reutiliza el evento `chat-tags-updated` para que las
// badges del header, el panel y la lista se actualicen al instante.
export function ChatTagsControl({
  contactId,
  conversationId,
  tags,
  badgeClassName = "",
  canDelete = false,
  compact = false,
}: {
  contactId?: string | null;
  conversationId: string;
  tags: DisplayTag[];
  badgeClassName?: string;
  // Solo administradores pueden eliminar etiquetas del workspace (acción destructiva global).
  canDelete?: boolean;
  // En móvil, colapsa las etiquetas a una sola fila con un chip "+N" para el resto.
  compact?: boolean;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [etiquetas, setEtiquetas] = useState<EtiquetaItem[]>([]);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);
  // Id de la etiqueta cuyo borrado total está pendiente de confirmar (en la lista del popover).
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [state, formAction, isPending] = useActionState(createEtiquetaAction, createInitialState);
  const [busy, startTransition] = useTransition();

  // ── Colapso en una sola fila (solo móvil) ────────────────────────────────
  // En móvil se muestra SOLO la primera etiqueta y un chip "+N" con el resto.
  const isMobile = useIsMobile();
  const collapsed = compact && isMobile;

  // Devuelve los datos (no hace setState); los efectos los aplican en el `.then` para no
  // disparar setState síncrono dentro del efecto.
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
    if (!popoverOpen) return;
    void loadAll().then((next) => {
      setEtiquetas(next.etiquetas);
      setAssignedIds(next.assignedIds);
      setLoaded(true);
    });
  }, [popoverOpen, loadAll]);

  useEffect(() => {
    if (!state.success) return;
    void loadAll().then((next) => {
      setEtiquetas(next.etiquetas);
      setAssignedIds(next.assignedIds);
      setLoaded(true);
      setShowForm(false);
      setSelectedColor(PRESET_COLORS[0]);
    });
  }, [state.success, loadAll]);

  const emitTags = useCallback(
    (nextAssignedIds: Set<string>, list: EtiquetaItem[]) => {
      const nextTags = list
        .filter((tag) => nextAssignedIds.has(tag.id))
        .map((tag) => ({ label: tag.name, color: tag.color }));
      window.dispatchEvent(
        new CustomEvent("chat-tags-updated", {
          detail: { contactId, tags: nextTags, assignedTagIds: Array.from(nextAssignedIds) },
        }),
      );
    },
    [contactId],
  );

  // Toggle desde el popover (lista completa con ✓).
  const handleToggle = useCallback(
    (tagId: string) => {
      if (!contactId || busy) return;
      const nextAssigned = new Set(assignedIds);
      if (nextAssigned.has(tagId)) nextAssigned.delete(tagId);
      else nextAssigned.add(tagId);
      setAssignedIds(nextAssigned);

      startTransition(async () => {
        const result = await toggleContactTagAction(contactId, tagId);
        if (result.error) {
          setAssignedIds(assignedIds); // revertir
          toast.error(result.error);
          return;
        }
        emitTags(nextAssigned, etiquetas);
      });
    },
    [assignedIds, busy, contactId, emitTags, etiquetas],
  );

  // Quitar una etiqueta directamente desde su badge (mini-menú). Optimista: la badge
  // desaparece al instante; si falla, se revierte.
  const handleRemoveTag = useCallback(
    (label: string) => {
      if (!contactId) return;
      const currentTags = tags;
      const remaining = currentTags.filter((tag) => tag.label !== label);
      window.dispatchEvent(
        new CustomEvent("chat-tags-updated", { detail: { contactId, tags: remaining } }),
      );

      startTransition(async () => {
        try {
          let list = etiquetas;
          if (!loaded || list.length === 0) {
            const result = await getEtiquetasAction();
            list = result.items ?? [];
            setEtiquetas(list);
          }
          const tag = list.find((item) => item.name === label);
          if (!tag) {
            return;
          }
          const result = await toggleContactTagAction(contactId, tag.id);
          if (result.error) {
            window.dispatchEvent(
              new CustomEvent("chat-tags-updated", { detail: { contactId, tags: currentTags } }),
            );
            toast.error(result.error);
            return;
          }
          setAssignedIds((prev) => {
            const next = new Set(prev);
            next.delete(tag.id);
            return next;
          });
        } catch {
          window.dispatchEvent(
            new CustomEvent("chat-tags-updated", { detail: { contactId, tags: currentTags } }),
          );
          toast.error("No se pudo quitar la etiqueta.");
        }
      });
    },
    [contactId, tags, etiquetas, loaded],
  );

  // Elimina la etiqueta del workspace por completo (afecta a TODOS los chats).
  const handleDeleteTag = useCallback(
    (tagId: string) => {
      startTransition(async () => {
        const deleted = etiquetas.find((item) => item.id === tagId);
        const result = await deleteEtiquetaAction(tagId);
        if (result?.error) {
          toast.error(result.error);
          return;
        }
        setEtiquetas((prev) => prev.filter((item) => item.id !== tagId));
        setAssignedIds((prev) => {
          const next = new Set(prev);
          next.delete(tagId);
          return next;
        });
        setConfirmingDeleteId(null);
        toast.success("Etiqueta eliminada");
        // Si estaba puesta en el chat abierto, quitar la badge al instante.
        if (deleted && contactId) {
          const remaining = tags.filter((tag) => tag.label !== deleted.name);
          window.dispatchEvent(
            new CustomEvent("chat-tags-updated", { detail: { contactId, tags: remaining } }),
          );
        }
      });
    },
    [contactId, etiquetas, tags],
  );

  const renderTagBadge = (tag: DisplayTag, key: string) => (
    <DropdownMenu key={key}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="max-w-full focus:outline-none"
          title={tag.label}
          aria-label={`Etiqueta ${tag.label}`}
        >
          <Badge
            className={`max-w-full cursor-pointer ${TAG_BADGE_CLASS} transition hover:opacity-90 ${badgeClassName}`}
            style={{ backgroundColor: tag.color, color: "#ffffff" }}
          >
            <span className="truncate">{tag.label}</span>
          </Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-32">
        <DropdownMenuItem
          variant="destructive"
          disabled={!contactId || busy}
          onClick={() => handleRemoveTag(tag.label)}
          className="gap-1.5 text-[12px]"
        >
          <X className="size-3.5" />
          Quitar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const addTagButton = (
    <Popover
        open={popoverOpen}
        onOpenChange={(open) => {
          setPopoverOpen(open);
          if (open) {
            setShowForm(false);
            setSelectedColor(PRESET_COLORS[0]);
            setConfirmingDeleteId(null);
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-6 items-center justify-center gap-1 rounded-full border border-dashed border-border bg-card px-2 text-[10px] font-medium text-muted-foreground transition hover:border-[var(--primary)] hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
            aria-label="Agregar etiqueta"
            title="Agregar etiqueta"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={8}
          className="w-64 rounded-2xl border border-border bg-popover p-0 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.35)]"
        >
          <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
            <h3 className="text-[13px] font-semibold text-foreground">Etiquetas</h3>
            <button
              type="button"
              onClick={() => setPopoverOpen(false)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Cerrar"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="max-h-60 min-h-0 overflow-y-auto px-2 py-1.5">
            {!loaded ? (
              <p className="py-4 text-center text-xs text-muted-foreground">Cargando…</p>
            ) : etiquetas.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">Sin etiquetas aún</p>
            ) : (
              <ul className="space-y-0.5">
                {etiquetas.map((tag) => {
                  const isAssigned = assignedIds.has(tag.id);
                  const isConfirming = canDelete && confirmingDeleteId === tag.id;
                  return (
                    <li key={tag.id} className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => handleToggle(tag.id)}
                        disabled={!contactId || busy}
                        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-2 transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <BsFillTagFill className="h-3.5 w-3.5 shrink-0" style={{ color: tag.color }} />
                        <span className="flex-1 truncate text-left text-[13px] text-foreground">{tag.name}</span>
                        {isAssigned ? <Check className="h-3.5 w-3.5 shrink-0 text-[var(--primary)]" /> : null}
                      </button>
                      {canDelete ? (
                        isConfirming ? (
                          <div className="flex shrink-0 items-center gap-1 pr-1">
                            <button
                              type="button"
                              onClick={() => handleDeleteTag(tag.id)}
                              disabled={busy}
                              className="rounded-md bg-destructive px-2 py-1 text-[10px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                            >
                              Eliminar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingDeleteId(null)}
                              className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                              aria-label="Cancelar"
                            >
                              <X className="size-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteId(tag.id)}
                            className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground/60 transition hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Eliminar etiqueta ${tag.name}`}
                            title="Eliminar etiqueta"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {showForm ? (
            <div className="border-t border-border px-3.5 pb-3.5 pt-2.5">
              <form
                action={(fd) => {
                  fd.set("color", selectedColor);
                  formAction(fd);
                }}
                className="space-y-2.5"
              >
                <input
                  name="name"
                  autoFocus
                  placeholder="Nombre de la etiqueta"
                  className="h-9 w-full rounded-[12px] border border-border bg-background px-3 text-[13px] text-foreground outline-none transition focus:border-[var(--primary)]"
                />
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
                {state.error ? <p className="text-xs text-rose-500">{state.error}</p> : null}
                <div className="flex gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="h-8 flex-1 rounded-[10px] border border-border text-[12px] text-muted-foreground transition hover:bg-muted"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isPending}
                    className="h-8 flex-1 rounded-[10px] bg-[var(--primary)] text-[12px] font-semibold text-white disabled:opacity-60"
                  >
                    {isPending ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="border-t border-border p-2">
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <Plus className="h-4 w-4" />
                Crear etiqueta
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>
  );

  if (collapsed) {
    const firstTag = tags[0];
    const hiddenTags = tags.slice(1);
    return (
      <div className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden">
        {firstTag ? (
          <div className="flex min-w-0 flex-1">{renderTagBadge(firstTag, `${conversationId}:${firstTag.label}`)}</div>
        ) : null}

        {hiddenTags.length > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex h-6 shrink-0 items-center justify-center rounded-full border border-border bg-card px-2 text-[10px] font-semibold text-muted-foreground transition hover:border-[var(--primary)] hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                aria-label={`Ver ${hiddenTags.length} etiqueta${hiddenTags.length > 1 ? "s" : ""} más`}
                title="Ver más etiquetas"
              >
                +{hiddenTags.length}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              side="bottom"
              sideOffset={8}
              className="w-60 rounded-2xl border border-border bg-popover p-2.5 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.35)]"
            >
              <div className="flex flex-wrap gap-1.5">
                {hiddenTags.map((tag) => renderTagBadge(tag, `overflow:${conversationId}:${tag.label}`))}
              </div>
            </PopoverContent>
          </Popover>
        ) : null}

        {addTagButton}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => renderTagBadge(tag, `${conversationId}:${tag.label}`))}
      {addTagButton}
    </div>
  );
}
