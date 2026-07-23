"use client";

import { useCallback, useEffect, useState, useTransition, type FormEvent } from "react";
import { LoaderCircle, MessageSquareText, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  createQuickReplyAction,
  deleteQuickReplyAction,
  getQuickRepliesAction,
  updateQuickReplyAction,
  type QuickReplyItem,
} from "@/app/actions/chats-actions";

type Props = {
  open: boolean;
  onClose: () => void;
  // Inserta el contenido elegido en el cuadro de mensaje (no envía).
  onSelect: (content: string) => void;
};

export function QuickRepliesDialog({ open, onClose, onSelect }: Props) {
  const [items, setItems] = useState<QuickReplyItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "form">("list");
  const [editing, setEditing] = useState<QuickReplyItem | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  // Carga robusta: SIEMPRE termina (loaded=true) aunque la acción falle o lance. Antes, si
  // getQuickRepliesAction lanzaba (o había un bache), no había catch y el diálogo giraba para
  // siempre sin reintentar. Ahora, ante error, se muestra un aviso con botón de reintento.
  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await getQuickRepliesAction();
      if (result.error) {
        setLoadError(result.error);
        setItems([]);
      } else {
        setItems(result.items ?? []);
      }
    } catch {
      setLoadError("No se pudieron cargar las respuestas rápidas.");
      setItems([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    setLoadError(null);
    void refresh();
  }, [open, refresh]);

  const handleSave = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const editingId = editing?.id ?? null;
      setFormError(null);
      startTransition(async () => {
        const result = editingId
          ? await updateQuickReplyAction(editingId, formData)
          : await createQuickReplyAction({}, formData);
        if (result?.error) {
          setFormError(result.error);
          return;
        }
        await refresh();
        setMode("list");
        setEditing(null);
      });
    },
    [editing, refresh],
  );

  const handleDelete = useCallback(
    (id: string) => {
      startTransition(async () => {
        const result = await deleteQuickReplyAction(id);
        if (result?.error) {
          toast.error(result.error);
          return;
        }
        setItems((prev) => prev.filter((item) => item.id !== id));
      });
    },
    [],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
          setMode("list");
          setEditing(null);
          setFormError(null);
        }
      }}
    >
      <DialogContent className="w-[min(94vw,30rem)] max-w-none gap-0 overflow-hidden border border-border bg-popover p-0 shadow-[0_30px_80px_-36px_rgba(15,23,42,0.45)]">
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle className="text-sm">Respuestas rápidas</DialogTitle>
        </DialogHeader>

        {mode === "list" ? (
          <>
            <div className="max-h-[50vh] min-h-0 overflow-y-auto px-3 py-2">
              {!loaded ? (
                <div className="flex justify-center py-8">
                  <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : loadError ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <p className="text-sm font-medium text-foreground">{loadError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setLoaded(false);
                      void refresh();
                    }}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
                  >
                    Reintentar
                  </button>
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                    <MessageSquareText className="h-5 w-5" />
                  </span>
                  <p className="text-sm font-medium text-foreground">Aún no hay respuestas rápidas</p>
                  <p className="text-xs text-muted-foreground">Creá la primera para reutilizar mensajes frecuentes.</p>
                </div>
              ) : (
                <ul className="space-y-1">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="group flex items-start gap-1 rounded-xl border border-transparent p-1 transition hover:border-border hover:bg-muted/60"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(item.content);
                          onClose();
                        }}
                        className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left transition"
                        title="Insertar en el mensaje"
                      >
                        <p className="truncate text-[13px] font-medium text-foreground">{item.title}</p>
                        <p className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">{item.content}</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(item);
                          setFormError(null);
                          setMode("form");
                        }}
                        disabled={busy}
                        className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
                        aria-label={`Editar ${item.title}`}
                        title="Editar"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id)}
                        disabled={busy}
                        className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        aria-label={`Eliminar ${item.title}`}
                        title="Eliminar"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-border p-3">
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setFormError(null);
                  setMode("form");
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-3 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90"
              >
                <Plus className="h-4 w-4" />
                Crear respuesta rápida
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSave} className="space-y-3 px-5 py-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Título</label>
              <input
                name="title"
                autoFocus
                defaultValue={editing?.title ?? ""}
                placeholder="Ej. Saludo inicial"
                maxLength={80}
                className="h-9 w-full rounded-[12px] border border-border bg-background px-3 text-[13px] text-foreground outline-none transition focus:border-[var(--primary)]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Mensaje</label>
              <textarea
                name="content"
                rows={4}
                defaultValue={editing?.content ?? ""}
                placeholder="Escribe el mensaje que se insertará en el chat…"
                maxLength={2000}
                className="w-full resize-none rounded-[12px] border border-border bg-background px-3 py-2 text-[13px] leading-snug text-foreground outline-none transition focus:border-[var(--primary)]"
              />
            </div>
            {formError ? <p className="text-xs text-rose-500">{formError}</p> : null}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setMode("list");
                  setEditing(null);
                  setFormError(null);
                }}
                className="h-9 flex-1 rounded-[10px] border border-border text-[13px] text-muted-foreground transition hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--primary)] text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                {editing ? "Guardar cambios" : "Crear"}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
