"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { FileText, SendHorizonal } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

type Props = {
  files: File[];
  onCancel: () => void;
  // Envía los archivos con el texto/caption escrito (puede ir vacío).
  onSend: (caption: string) => void;
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

export function MediaPreviewDialog({ files, onCancel, onSend }: Props) {
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

  const active = previews[Math.min(activeIndex, previews.length - 1)] ?? previews[0];

  const handleSend = () => onSend(caption.trim());

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
        className="flex max-h-[88vh] w-[min(94vw,30rem)] max-w-none flex-col gap-0 overflow-hidden border border-border bg-popover p-0 shadow-lg"
      >
        <DialogTitle className="border-b border-border px-5 py-3 text-sm">
          {files.length > 1 ? `Enviar ${files.length} archivos` : "Enviar archivo"}
        </DialogTitle>

        <div className="flex min-h-0 flex-1 flex-col">
          {/* Vista previa principal */}
          <div className="flex min-h-[180px] flex-1 items-center justify-center overflow-hidden bg-muted/40 p-3">
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
                <FileText className="size-9 shrink-0 text-red-500" />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-foreground">{active?.file.name}</p>
                  <p className="text-[11px] text-muted-foreground">{formatSize(active?.file.size ?? 0)}</p>
                </div>
              </div>
            )}
          </div>

          {/* Tira de miniaturas cuando hay varios archivos */}
          {previews.length > 1 ? (
            <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-border px-3 py-2">
              {previews.map((preview, index) => (
                <button
                  key={preview.url}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  className={`flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border transition ${
                    index === activeIndex ? "border-primary ring-1 ring-primary" : "border-border opacity-70 hover:opacity-100"
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
              className="max-h-28 min-h-[42px] flex-1 resize-none rounded-2xl border border-border bg-background px-3 py-2.5 text-[14px] text-foreground outline-none transition focus:border-primary"
            />
            <button
              type="button"
              onClick={handleSend}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-white transition hover:opacity-90"
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
