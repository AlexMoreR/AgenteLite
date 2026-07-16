"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, CheckCircle2, History, Loader2, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import {
  applyEvolutionChatSyncAction,
  scanEvolutionChatSyncAction,
  scanEvolutionChatSyncByPhoneAction,
} from "@/app/actions/evolution-chat-sync-actions";
import type { EvolutionChatSyncCandidate, EvolutionChatSyncScanResult } from "@/lib/evolution-chat-sync";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

const IMPORT_LIMIT_OPTIONS = [
  { value: "all", label: "Todas" },
  { value: "1000", label: "1000" },
  { value: "100", label: "100" },
  { value: "50", label: "50" },
  { value: "10", label: "10" },
] as const;

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
      phase: "batch";
      error: string | null;
      scanMessage: string;
      candidates: EvolutionChatSyncCandidate[];
      selectedFingerprint: string;
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
  const [phoneInput, setPhoneInput] = useState("");
  const [importLimit, setImportLimit] = useState<string>("10");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const candidateList =
    state.phase === "batch"
      ? state.candidates.filter((candidate): candidate is EvolutionChatSyncCandidate => Boolean(candidate))
      : [];
  const selectedCandidate =
    state.phase === "batch"
      ? candidateList.find((candidate) => candidate.fingerprint === state.selectedFingerprint) ?? candidateList[0] ?? null
      : null;

  function applyScanResult(
    result: EvolutionChatSyncScanResult | { ok: false; error: string },
  ) {
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
      phase: "batch",
      error: null,
      scanMessage: result.message,
      candidates: Array.isArray(result.candidates)
        ? result.candidates.filter((candidate): candidate is EvolutionChatSyncCandidate => Boolean(candidate))
        : [],
      selectedFingerprint:
        Array.isArray(result.candidates) && result.candidates[0]?.fingerprint ? result.candidates[0].fingerprint : "",
    });
  }

  function runScan() {
    setState({
      phase: "idle",
      error: null,
      scanMessage: null,
    });

    startTransition(async () => {
      const result = await scanEvolutionChatSyncAction({ channelId });
      applyScanResult(result);
    });
  }

  function runScanByPhone() {
    const phoneNumber = phoneInput.trim();
    if (!phoneNumber) {
      setState({
        phase: "idle",
        error: "Ingresa un numero de telefono para sincronizar.",
        scanMessage: null,
      });
      return;
    }

    setState({
      phase: "idle",
      error: null,
      scanMessage: null,
    });

    startTransition(async () => {
      const result = await scanEvolutionChatSyncByPhoneAction({ channelId, phoneNumber });
      applyScanResult(result);
    });
  }

  function runApply() {
    if (state.phase !== "batch") {
      return;
    }

    const selectedCandidate =
      candidateList.find((candidate) => candidate.fingerprint === state.selectedFingerprint) ?? candidateList[0];

    if (!selectedCandidate) {
      return;
    }

    setState((current) => ({
      ...current,
      error: null,
    }));

    startTransition(async () => {
      const result = await applyEvolutionChatSyncAction({
        channelId,
        candidate: selectedCandidate,
        importLimit: importLimit === "all" ? null : Number(importLimit),
      });

      if (!result.ok) {
        setState({
          phase: "batch",
          error: result.error,
          scanMessage: state.scanMessage,
          candidates: state.candidates,
          selectedFingerprint: selectedCandidate.fingerprint,
        });
        return;
      }

      toast.success(result.message);
      setOpen(false);
      router.refresh();
    });
  }

  const limitSelect = (
    <Select
      value={importLimit}
      onValueChange={(value) => {
        if (value) {
          setImportLimit(value);
        }
      }}
      disabled={isPending}
    >
      <SelectTrigger className="h-10 rounded-xl sm:w-32" aria-label="Cantidad de mensajes a importar">
        <SelectValue placeholder="Cantidad" />
      </SelectTrigger>
      <SelectContent>
        {IMPORT_LIMIT_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Card>
      <CardContent className="space-y-2">
        <p className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
          <History className="size-4 text-primary" />
          <span>Sincronizar chats</span>
        </p>

        <Dialog
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) {
              setState(initialState());
              setPhoneInput("");
            }
          }}
        >
          <Button type="button" variant="outline" onClick={() => setOpen(true)} className="w-full">
            Sincronizar chats
          </Button>

          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-5xl lg:max-w-6xl">
            <DialogHeader>
              <DialogTitle>Sincronizar chats</DialogTitle>
            </DialogHeader>

            <div className="max-h-[calc(90vh-6rem)] space-y-4 overflow-y-auto pr-1">
              {state.error ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>{state.error}</p>
                  </div>
                </div>
              ) : null}

              {state.phase === "idle" ? (
                <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-muted/40 px-5 py-8 text-center">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Users className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-base font-semibold tracking-[-0.03em] text-foreground">Listo para comparar</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <Button
                      type="button"
                      onClick={runScan}
                      disabled={isPending}
                      className="min-w-48 rounded-xl"
                    >
                      {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Sincronizar chats
                    </Button>

                    <div className="flex items-center gap-2">
                      <Label className="text-muted-foreground">Importar</Label>
                      {limitSelect}
                      <Label className="text-muted-foreground">mensajes recientes</Label>
                    </div>
                  </div>

                  <div className="flex w-full items-center gap-3">
                    <Separator className="flex-1" />
                    <span className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">o por numero</span>
                    <Separator className="flex-1" />
                  </div>

                  <div className="w-full space-y-2">
                    <Label htmlFor="chat-sync-phone" className="text-muted-foreground">
                      Sincroniza un contacto especifico sin escanear toda la lista. Ingresa el numero con codigo de pais.
                    </Label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        id="chat-sync-phone"
                        type="tel"
                        inputMode="numeric"
                        value={phoneInput}
                        onChange={(event) => setPhoneInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !isPending) {
                            event.preventDefault();
                            runScanByPhone();
                          }
                        }}
                        placeholder="573001234567"
                        disabled={isPending}
                        className="flex-1"
                      />
                      {limitSelect}
                      <Button
                        type="button"
                        onClick={runScanByPhone}
                        disabled={isPending || !phoneInput.trim()}
                        className="rounded-xl"
                      >
                        {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Sincronizar numero
                      </Button>
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Cantidad de mensajes mas recientes a importar. &quot;Todas&quot; trae el historial completo (puede tardar).
                    </p>
                  </div>
                </div>
              ) : null}

              {state.phase === "none" ? (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-foreground">Sin cambios</p>
                      <p className="text-sm leading-6 text-muted-foreground">{state.scanMessage}</p>
                    </div>
                  </div>
                </div>
              ) : null}

              {state.phase === "batch" ? (
                <div className="h-fit space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-foreground">Coincidencias detectadas</p>
                      <p className="text-xs text-muted-foreground">{state.scanMessage}</p>
                    </div>
                  </div>

                  <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                    <div className="space-y-2 self-start">
                      {candidateList.map((candidate) => {
                        const isSelected = candidate.fingerprint === selectedCandidate?.fingerprint;

                        return (
                          <button
                            key={candidate.fingerprint}
                            type="button"
                            onClick={() =>
                              setState((current) =>
                                current.phase === "batch"
                                  ? {
                                      ...current,
                                      selectedFingerprint: candidate.fingerprint,
                                    }
                                  : current,
                              )
                            }
                            className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                              isSelected
                                ? "border-primary bg-card ring-1 ring-primary"
                                : "border-border bg-card hover:border-primary/40 hover:bg-accent"
                            }`}
                          >
                            <p className="text-sm font-medium text-foreground">
                              {candidate.remoteDisplayName || "Contacto sin nombre"}
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">{candidate.remotePhoneNumber}</p>
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex h-full flex-col rounded-xl border border-border bg-card px-4 py-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">Vista previa de la conversacion</p>
                          <p className="text-xs text-muted-foreground">
                            {selectedCandidate?.messagePreview.length
                              ? `${selectedCandidate.messagePreview.length} Mensajes detectados`
                              : "Todavia no pudimos leer mensajes visibles desde Evolution para este chat."}
                          </p>
                        </div>
                        <Badge variant="secondary" className="shrink-0">
                          {selectedCandidate?.remoteJidAlt || selectedCandidate?.remoteJid || selectedCandidate?.remotePhoneNumber}
                        </Badge>
                      </div>

                      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-border bg-muted/40 p-3">
                        {selectedCandidate?.messagePreview.length ? (
                          selectedCandidate.messagePreview.map((message) => {
                            const isOutbound = message.direction === "OUTBOUND";
                            const bubbleClasses = isOutbound
                              ? "ml-auto border-transparent bg-primary text-primary-foreground"
                              : "mr-auto border-border bg-card text-foreground";
                            const labelClasses = isOutbound ? "text-primary-foreground/80" : "text-muted-foreground";

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
                                  <p className={`mt-2 text-[11px] ${isOutbound ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
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
                          <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
                            No pudimos construir una vista previa de mensajes, pero podemos seguir con la importacion si deseas.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {state.phase === "batch" ? (
              <>
                {/* "Todas" trae el historial COMPLETO del chat: en un cliente viejo son miles
                    de mensajes, y cada foto y PDF se descarga al servidor. El resto de las
                    opciones tienen techo. Se avisa solo en ese caso para que el aviso
                    signifique algo y no se vuelva ruido que nadie lee. */}
                {importLimit === "all" ? (
                  <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>
                      Vas a traer <strong>todo el historial</strong> de este chat. Si es un cliente antiguo pueden
                      ser miles de mensajes, y sus fotos y PDF se descargan al servidor. Para completar un chat
                      alcanza con las últimas 50 o 100.
                    </span>
                  </p>
                ) : null}
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                    Ignorar
                  </Button>
                  <Button type="button" onClick={runApply} disabled={isPending}>
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Agregar
                  </Button>
                </DialogFooter>
              </>
            ) : state.phase === "none" ? (
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cerrar
                </Button>
                <Button type="button" onClick={runScan} disabled={isPending}>
                  {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Volver a revisar
                </Button>
              </DialogFooter>
            ) : null}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
