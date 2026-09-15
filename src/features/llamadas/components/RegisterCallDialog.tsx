"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CALL_RESULTS,
  CALL_RESULT_LOST,
  CRM_LOST_REASONS,
  LARGO_DEL_OTRO_MOTIVO,
  MOTIVO_OTRO,
  motivoOtroConDetalle,
} from "@/features/crm/domain/crm-config";
import {
  registerCallAttemptAction,
  searchContactsForCallAction,
  sugerenciaDeLlamadaAction,
  type CallContactSearchItem,
} from "@/app/actions/call-actions";
import type { SugerenciaDeLlamada } from "@/lib/llamada-transcripcion";

/*
  El formulario de "¿Como quedo la llamada?" vive aparte porque se abre desde DOS lugares: la
  pantalla de Llamadas y el aviso de arriba del chat (14-sep-2026).
*/

export type PresetContact = {
  contactId: string;
  name: string;
  phoneNumber?: string;
  /**
   * Cuando viene, el diálogo COMPLETA esa llamada en vez de anotar una nueva.
   *
   * Es la llamada que WaCalls ya registró sola y a la que solo le falta el resultado. Sin esto,
   * clasificarla crearía un segundo intento y el lead figuraría con el doble de llamadas.
   */
  pendingAttemptId?: string | null;
  recordingUrl?: string | null;
};

function todayInputValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

// ── Diálogo de registro de llamada ────────────────────────────────────────────────────────────

export function RegisterCallDialog({
  open,
  onOpenChange,
  preset,
  alGuardar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset: PresetContact | null;
  /** Despues de guardar: el aviso del chat lo usa para mostrar el resultado nuevo. */
  alGuardar?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Contacto elegido: el preset (desde una tarjeta) o el que se busca (registro retroactivo).
  const [selected, setSelected] = useState<PresetContact | null>(preset);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<CallContactSearchItem[]>([]);
  const [searching, setSearching] = useState(false);

  const [result, setResult] = useState<string>(CALL_RESULTS[0].value);
  const [summary, setSummary] = useState("");
  const [nextContact, setNextContact] = useState("");
  const [lostReason, setLostReason] = useState<string>(CRM_LOST_REASONS[0].value);
  const [otroDetalle, setOtroDetalle] = useState("");
  const [calledAt, setCalledAt] = useState(todayInputValue());
  const [verTranscripcion, setVerTranscripcion] = useState(false);

  /*
    Sugerencia de la IA a partir de la grabacion: resultado, resumen y proximo contacto ya puestos,
    para que confirmar sea un toque. `sugerencia.attemptId` dice de que llamada es; mientras no
    coincida con la abierta, se esta escuchando.
  */
  const [sugerencia, setSugerencia] = useState<{
    attemptId: string;
    datos: SugerenciaDeLlamada | null;
    error: string | null;
  } | null>(null);
  const idPendiente = open ? preset?.pendingAttemptId ?? null : null;
  const escuchando = Boolean(idPendiente) && sugerencia?.attemptId !== idPendiente;

  useEffect(() => {
    if (!idPendiente) {
      return;
    }
    let vigente = true;
    sugerenciaDeLlamadaAction(idPendiente)
      .then((respuesta) => {
        if (!vigente) return;
        if ("error" in respuesta) {
          setSugerencia({ attemptId: idPendiente, datos: null, error: respuesta.error });
          return;
        }
        const datos = respuesta.sugerencia;
        setSugerencia({ attemptId: idPendiente, datos, error: null });
        if (datos?.resultado) setResult(datos.resultado);
        if (datos?.motivoPerdida) setLostReason(datos.motivoPerdida);
        if (datos?.resumen) setSummary((actual) => actual || datos.resumen);
        if (datos?.proximoContacto) setNextContact((actual) => actual || datos.proximoContacto || "");
      })
      .catch(() => {
        if (vigente) setSugerencia({ attemptId: idPendiente, datos: null, error: "No se pudo escuchar la grabación" });
      });
    return () => {
      vigente = false;
    };
  }, [idPendiente]);

  // Sincroniza el preset cuando se abre desde otra tarjeta.
  const effectivePreset = preset;
  const resetAndSelect = useCallback((contact: PresetContact | null) => {
    setSelected(contact);
    setResult(CALL_RESULTS[0].value);
    setSummary("");
    setNextContact("");
    setLostReason(CRM_LOST_REASONS[0].value);
    setOtroDetalle("");
    setCalledAt(todayInputValue());
    setSearchTerm("");
    setSearchResults([]);
  }, []);

  // Al ABRIR (sea por interacción o porque el padre lo abre para otra tarjeta), reinicia el
  // formulario con el contacto correcto. El open programático del padre no dispara onOpenChange,
  // por eso el sync va en un efecto sobre [open, preset].
  useEffect(() => {
    if (open) {
      resetAndSelect(effectivePreset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, effectivePreset]);

  const handleOpenChange = useCallback((next: boolean) => onOpenChange(next), [onOpenChange]);

  const runSearch = useCallback((term: string) => {
    setSearchTerm(term);
    if (term.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    searchContactsForCallAction(term)
      .then((res) => setSearchResults(res.items))
      .catch(() => setSearchResults([]))
      .finally(() => setSearching(false));
  }, []);

  const isLost = result === CALL_RESULT_LOST;

  const handleSubmit = useCallback(() => {
    if (!selected) {
      toast.error("Elegí un contacto primero.");
      return;
    }
    if (isLost && (!lostReason || (lostReason === MOTIVO_OTRO && !otroDetalle.trim()))) {
      toast.error("Elegí el motivo de pérdida.");
      return;
    }
    startTransition(async () => {
      const res = await registerCallAttemptAction({
        contactId: selected.contactId,
        result,
        summary: summary.trim() || undefined,
        nextContactAt: nextContact || undefined,
        lostReason: isLost ? (lostReason === MOTIVO_OTRO ? motivoOtroConDetalle(otroDetalle) : lostReason) : undefined,
        calledAt: calledAt || undefined,
        completeAttemptId: selected.pendingAttemptId || undefined,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(selected.pendingAttemptId ? "Llamada clasificada" : "Llamada registrada");
      onOpenChange(false);
      alGuardar?.();
      router.refresh();
    });
  }, [selected, isLost, lostReason, otroDetalle, result, summary, nextContact, calledAt, onOpenChange, router, alGuardar]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {selected?.pendingAttemptId ? "¿Cómo quedó la llamada?" : "Registrar llamada"}
          </DialogTitle>
          <DialogDescription>
            {selected ? selected.name : "Buscá el contacto al que llamaste."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Buscador de contacto (solo cuando no vino de una tarjeta). */}
          {!effectivePreset ? (
            <div className="space-y-2">
              {selected ? (
                <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                  <span className="font-medium">{selected.name}</span>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                    Cambiar
                  </Button>
                </div>
              ) : (
                <div>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchTerm}
                      onChange={(event) => runSearch(event.target.value)}
                      placeholder="Buscar por nombre o teléfono…"
                      className="pl-8"
                    />
                  </div>
                  {searching ? (
                    <p className="mt-1 px-1 text-xs text-muted-foreground">Buscando…</p>
                  ) : null}
                  {searchResults.length > 0 ? (
                    <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-border">
                      {searchResults.map((item) => (
                        <button
                          key={item.contactId}
                          type="button"
                          onClick={() =>
                            setSelected({ contactId: item.contactId, name: item.name, phoneNumber: item.phoneNumber })
                          }
                          className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
                        >
                          <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{item.phoneNumber}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          {idPendiente ? (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px]">
              {escuchando ? (
                <p className="text-muted-foreground">Escuchando la grabación…</p>
              ) : sugerencia?.datos ? (
                <div className="space-y-1.5">
                  <p className="text-foreground">
                    <span className="font-medium">Sugerido por la IA</span>
                    <span className="text-muted-foreground"> según la grabación. Revisalo antes de guardar.</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setVerTranscripcion((valor) => !valor)}
                    className="text-[12px] font-medium text-[var(--primary)] hover:underline"
                  >
                    {verTranscripcion ? "Ocultar transcripción" : "Ver transcripción"}
                  </button>
                  {verTranscripcion ? (
                    <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-[12px] leading-5 text-muted-foreground">
                      {sugerencia.datos.transcripcion || "(La grabación no tiene voz que se entienda)"}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  {sugerencia?.error ?? "Esta llamada no tiene grabación para escuchar."}
                </p>
              )}
            </div>
          ) : null}

          {/* Resultado (lista fija). */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Resultado</label>
            <NativeSelect value={result} onChange={(event) => setResult(event.target.value)}>
              {CALL_RESULTS.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          {/* Motivo de pérdida (obligatorio solo si Perdido). */}
          {isLost ? (
            <div className="space-y-1">
              <label className="text-xs font-medium text-rose-600">Motivo de pérdida (obligatorio)</label>
              <NativeSelect value={lostReason} onChange={(event) => setLostReason(event.target.value)}>
                {CRM_LOST_REASONS.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {lostReason === MOTIVO_OTRO ? (
                <input
                  value={otroDetalle}
                  maxLength={LARGO_DEL_OTRO_MOTIVO}
                  onChange={(event) => setOtroDetalle(event.target.value)}
                  placeholder="¿Cuál fue la razón?"
                  className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[16px] text-foreground outline-none focus:border-[var(--primary)] md:text-sm"
                />
              ) : null}
            </div>
          ) : null}

          {/* Resumen breve. */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Resumen (qué dijo)</label>
            <Textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="Ej: pide fotos del combo negro, llamar el lunes."
              rows={2}
            />
          </div>

          {/*
            Al clasificar una llamada que el sistema ya anotó, la fecha no se ofrece: la hora real
            la puso WaCalls cuando la llamada ocurrió y se conserva. Un campo editable que el
            servidor ignora es peor que no tenerlo.
          */}
          <div className={selected?.pendingAttemptId ? "" : "grid grid-cols-2 gap-3"}>
            {/* Próximo contacto. */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Próximo contacto</label>
              <Input type="date" value={nextContact} onChange={(event) => setNextContact(event.target.value)} />
            </div>
            {/* Fecha de la llamada (editable para registro retroactivo). */}
            {selected?.pendingAttemptId ? null : (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Fecha de la llamada</label>
                <Input type="date" value={calledAt} onChange={(event) => setCalledAt(event.target.value)} />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !selected}>
            {isPending ? "Guardando…" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
