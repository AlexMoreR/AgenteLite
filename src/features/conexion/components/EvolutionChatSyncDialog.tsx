"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, History, Loader2, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { applyEvolutionChatSyncAction, scanEvolutionChatSyncAction } from "@/app/actions/evolution-chat-sync-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type EvolutionChatSyncDialogProps = {
  channelId: string;
};

type SyncState =
  | {
      phase: "idle";
      error: string | null;
      scanMessage: string | null;
    }
  | {
      phase: "none";
      error: string | null;
      scanMessage: string;
    }
  | {
      phase: "candidate";
      error: string | null;
      scanMessage: string;
      candidate: {
        fingerprint: string;
        kind: "CONTACT" | "CONVERSATION";
        remotePhoneNumber: string;
        remoteDisplayName: string | null;
        remoteJid: string | null;
        remoteJidAlt: string | null;
      remoteItemId: string | null;
      summary: string;
      needsContact: boolean;
      needsConversation: boolean;
      needsMessages: boolean;
      messagePreview: Array<{
        id: string;
        direction: "INBOUND" | "OUTBOUND";
        type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM";
        content: string | null;
        createdAt: string;
        mediaUrl: string | null;
      }>;
    };
};

function initialState(): SyncState {
  return {
    phase: "idle",
    error: null,
    scanMessage: null,
  };
}

export function EvolutionChatSyncDialog({ channelId }: EvolutionChatSyncDialogProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SyncState>(initialState);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function runScan() {
    setState((current) => ({
      ...current,
      error: null,
      scanMessage: null,
    }));

    startTransition(async () => {
      const result = await scanEvolutionChatSyncAction({ channelId });

      if (!result.ok) {
        setState({
          phase: "idle",
          error: result.error,
          scanMessage: null,
        });
        return;
      }

      if (result.kind === "none") {
        setState({
          phase: "none",
          error: null,
          scanMessage: result.message,
        });
        return;
      }

      setState({
        phase: "candidate",
        error: null,
        scanMessage: result.message,
        candidate: result.candidate,
      });
    });
  }

  function runApply() {
    if (state.phase !== "candidate") {
      return;
    }

    setState((current) => ({
      ...current,
      error: null,
    }));

    startTransition(async () => {
      const result = await applyEvolutionChatSyncAction({
        channelId,
        candidate: state.candidate,
      });

      if (!result.ok) {
        setState({
          phase: "candidate",
          error: result.error,
          scanMessage: state.scanMessage,
          candidate: state.candidate,
        });
        return;
      }

      toast.success(result.message);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-[color:color-mix(in_srgb,var(--primary)_18%,white)] bg-white px-4 py-2.5 shadow-[0_18px_48px_-40px_rgba(37,99,235,0.45)]">
      <div className="space-y-2">
        <div className="space-y-0.5">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-slate-900">
            <History className="h-4 w-4 text-[var(--primary)]" />
            <span>Sincronizar chats</span>
          </p>
          <p className="text-[13px] text-slate-500">Compara Evolution con los chats locales y detiene el proceso en la primera diferencia.</p>
        </div>

        <Dialog
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) {
              setState(initialState());
            }
          }}
        >
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="inline-flex h-9 w-full justify-center rounded-xl border border-[rgba(148,163,184,0.18)] bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
            >
              Sincronizar chats
            </Button>
          </DialogTrigger>

          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-5xl lg:max-w-6xl">
            <DialogHeader>
              <DialogTitle>Sincronizar chats</DialogTitle>
            </DialogHeader>

            <div className="max-h-[calc(90vh-6rem)] space-y-4 overflow-y-auto pr-1">
              {state.error ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-700">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>{state.error}</p>
                  </div>
                </div>
              ) : null}

              {state.phase === "idle" ? (
                <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
                    <Users className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-base font-semibold tracking-[-0.03em] text-slate-950">Listo para comparar</p>
                    <p className="text-sm leading-6 text-slate-600">
                      Presiona sincronizar para revisar si Evolution tiene un chat o contacto que aun no existe en la BD local.
                    </p>
                  </div>
                  <Button
                    type="button"
                    onClick={runScan}
                    disabled={isPending}
                    className="min-w-48 rounded-xl"
                  >
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Sincronizar chats
                  </Button>
                </div>
              ) : null}

              {state.phase === "none" ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-emerald-900">Sin cambios</p>
                      <p className="text-sm leading-6 text-emerald-800">{state.scanMessage}</p>
                    </div>
                  </div>
                </div>
              ) : null}

              {state.phase === "candidate" ? (
                <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-4">
                  <div className="flex items-start gap-3">
                    <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-amber-950">Primera coincidencia detectada</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-amber-200 bg-white px-4 py-4">
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-slate-900">
                          {state.candidate.remoteDisplayName || "Contacto sin nombre"}
                        </p>
                        <p className="text-sm text-slate-600">{state.candidate.remotePhoneNumber}</p>
                      </div>

                      <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                        <div className="rounded-lg bg-slate-50 px-3 py-2">
                          <span className="block text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Tipo</span>
                          <span>{state.candidate.kind === "CONTACT" ? "Contacto faltante" : "Conversacion faltante"}</span>
                        </div>
                        <div className="rounded-lg bg-slate-50 px-3 py-2">
                          <span className="block text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Accion</span>
                          <span>
                            {state.candidate.needsContact
                              ? "Crear contacto, conversacion y mensajes"
                              : state.candidate.needsConversation
                                ? "Crear conversacion y mensajes"
                                : state.candidate.needsMessages
                                  ? "Traer mensajes faltantes"
                                  : "Sin cambios"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 border-t border-slate-100 pt-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Vista previa de la conversacion</p>
                          <p className="text-xs text-slate-500">
                            {state.candidate.messagePreview.length > 0
                              ? `Mostramos ${state.candidate.messagePreview.length} mensajes detectados para revisar antes de agregar.`
                              : "Todavia no pudimos leer mensajes visibles desde Evolution para este chat."}
                          </p>
                        </div>
                        <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-500">
                          {state.candidate.remoteJidAlt || state.candidate.remoteJid || state.candidate.remotePhoneNumber}
                        </span>
                      </div>

                      <div className="max-h-[34vh] space-y-3 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                        {state.candidate.messagePreview.length > 0 ? (
                          state.candidate.messagePreview.map((message) => {
                            const isOutbound = message.direction === "OUTBOUND";
                            const bubbleClasses = isOutbound
                              ? "ml-auto border-blue-200 bg-blue-600 text-white"
                              : "mr-auto border-slate-200 bg-white text-slate-800";
                            const labelClasses = isOutbound ? "text-blue-100/80" : "text-slate-500";

                            return (
                              <div
                                key={message.id}
                                className={`flex max-w-[88%] ${isOutbound ? "justify-end" : "justify-start"}`}
                              >
                                <div className={`rounded-2xl border px-4 py-3 shadow-sm ${bubbleClasses}`}>
                                  <div className={`mb-1 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.14em] ${labelClasses}`}>
                                    <span>{message.direction === "OUTBOUND" ? "Nosotros" : "Cliente"}</span>
                                    <span>{message.type}</span>
                                  </div>
                                  <p className="whitespace-pre-wrap text-sm leading-6">
                                    {message.content?.trim() || (message.mediaUrl ? "Archivo o medio adjunto" : "Sin contenido visible")}
                                  </p>
                                  <p className={`mt-2 text-[11px] ${isOutbound ? "text-blue-100/75" : "text-slate-400"}`}>
                                    {new Date(message.createdAt).toLocaleString("es-CO", {
                                      dateStyle: "medium",
                                      timeStyle: "short",
                                    })}
                                  </p>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white/70 px-4 py-6 text-center text-sm text-slate-500">
                            No pudimos construir una vista previa de mensajes, pero podemos seguir con la importacion si deseas.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {state.phase === "candidate" ? (
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={isPending}>
                    Ignorar
                  </Button>
                </DialogClose>
                <Button type="button" onClick={runApply} disabled={isPending}>
                  {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Agregar
                </Button>
              </DialogFooter>
            ) : state.phase === "none" ? (
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Cerrar
                  </Button>
                </DialogClose>
                <Button type="button" onClick={runScan} disabled={isPending}>
                  {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Volver a revisar
                </Button>
              </DialogFooter>
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
