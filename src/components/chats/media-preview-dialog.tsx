"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { FileText, SendHorizonal, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { quitarArchivo } from "@/components/chats/quitar-archivo-de-la-vista-previa";

type Props = {
  files: File[];
  onCancel: () => void;
  // Envía los archivos con el texto/caption escrito (puede ir vacío).
  onSend: (caption: string) => void;
  // Saca de la selección el archivo en esa posición. Si no queda ninguno, la bandeja cierra la ventana.
  onRemove: (index: number) => void;
};

type MediaKind = "image" | "video" | "audio" | "file";

function kindOf(file: File): MediaKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

function formatSize(bytes: number) {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaPreviewDialog({ files, onCancel, onSend, onRemove }: Props) {
  const [caption, setCaption] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  // El componente se monta solo cuando hay archivos, así que crear las object URLs acá es
  // estable; se revocan al desmontar.
  const previews = useMemo(
    () => files.map((file) => ({ file, url: URL.createObjectURL(file), kind: kindOf(file) })),
    [files],
  );

  useEffect(() => {
    return () => {
      previews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [previews]);

  const activePosition = Math.max(0, Math.min(activeIndex, previews.length - 1));
  const active = previews[activePosition];

  const handleSend = () => onSend(caption.trim());

  // Quita un archivo y deja en grande el que toca (la siguiente, o la anterior si era la última).
  const handleRemove = (index: number) => {
    setActiveIndex(quitarArchivo(previews, index, activePosition).activo);
    onRemove(index);
  };

  const handleCaptionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <Dialog
      open={files.length > 0}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        showCloseButton
        className="flex max-h-[88vh] w-[min(94vw,30rem)] max-w-none flex-col gap-0 overflow-hidden border border-border bg-popover p-0 shadow-[0_30px_80px_-36px_rgba(15,23,42,0.45)]"
      >
        <DialogTitle className="border-b border-border px-5 py-3 text-sm">
          {files.length > 1 ? `Enviar ${files.length} archivos` : "Enviar archivo"}
        </DialogTitle>

        <div className="flex min-h-0 flex-1 flex-col">
          {/* Vista previa principal */}
          <div className="relative flex min-h-[180px] flex-1 items-center justify-center overflow-hidden bg-muted/40 p-3">
            {active ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleRemove(activePosition);
                }}
                className="absolute top-2 right-2 z-10 inline-flex size-11 items-center justify-center rounded-full bg-black/60 text-white shadow-md transition hover:bg-black/75"
                aria-label="Quitar este archivo"
                title="Quitar este archivo"
              >
                <X className="size-5" />
              </button>
            ) : null}
            {active?.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={active.url} alt={active.file.name} className="max-h-[44vh] max-w-full rounded-lg object-contain" />
            ) : active?.kind === "video" ? (
              <video src={active.url} controls className="max-h-[44vh] max-w-full rounded-lg" />
            ) : active?.kind === "audio" ? (
              <div className="w-full px-2">
                <audio src={active.url} controls className="w-full" />
              </div>
            ) : (
              <div className="flex w-full items-center gap-3 rounded-xl border border-border bg-background p-3">
                <FileText className="size-9 shrink-0 text-[#e2433a]" />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-foreground">{active?.file.name}</p>
                  <p className="text-[11px] text-muted-foreground">{formatSize(active?.file.size ?? 0)}</p>
                </div>
              </div>
            )}
          </div>

          {/* Tira de miniaturas cuando hay varios archivos. pt-3 y gap-3 dejan lugar para la X, que
              sale por fuera de la esquina de cada miniatura. */}
          {previews.length > 1 ? (
            <div className="flex shrink-0 gap-3 overflow-x-auto border-t border-border px-3 pt-3 pb-2">
              {previews.map((preview, index) => (
                <div key={preview.url} className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    className={`flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border transition ${
                      index === activeIndex ? "border-[var(--primary)] ring-1 ring-[var(--primary)]" : "border-border opacity-70 hover:opacity-100"
                    }`}
                    title={preview.file.name}
                  >
                    {preview.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={preview.url} alt={preview.file.name} className="h-full w-full object-cover" />
                    ) : (
                      <FileText className="size-5 text-muted-foreground" />
                    )}
                  </button>
                  {/* El área que se toca es de 32 px; el círculo que se ve es más chico. Sale por fuera de
                      la esquina para no tapar el centro de la miniatura, que es para verla en grande. */}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleRemove(index);
                    }}
                    className="absolute -top-3 -right-3 z-10 inline-flex size-8 items-center justify-center"
                    aria-label="Quitar este archivo"
                    title="Quitar este archivo"
                  >
                    <span className="inline-flex size-5 items-center justify-center rounded-full bg-black/70 text-white shadow ring-1 ring-white/80">
                      <X className="size-3" />
                    </span>
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {/* Caption + enviar */}
          <div className="flex shrink-0 items-end gap-2 border-t border-border p-3">
            <textarea
              autoFocus
              rows={1}
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              onKeyDown={handleCaptionKeyDown}
              placeholder="Añadir un mensaje… (opcional)"
              className="max-h-28 min-h-[42px] flex-1 resize-none rounded-2xl border border-border bg-background px-3 py-2.5 text-[14px] text-foreground outline-none transition focus:border-[var(--primary)]"
            />
            <button
              type="button"
              onClick={handleSend}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-white transition hover:opacity-90"
              aria-label="Enviar"
              title="Enviar"
            >
              <SendHorizonal className="size-5" />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
