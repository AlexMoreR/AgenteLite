"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, ChevronDown, Target, X } from "lucide-react";
import { updateCrmStageAction } from "@/app/actions/crm-actions";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CRM_LOST_REASONS, CRM_STAGE_META, CRM_STAGE_ORDER } from "@/features/crm/domain/crm-config";
import type { CrmStage } from "@/features/crm/types";

type CrmStageControlProps = {
  contactId: string;
  stage: CrmStage;
};

// Color del punto indicador por etapa (consistente con los acentos del CRM).
const STAGE_DOT_CLASS: Record<CrmStage, string> = {
  NUEVO: "bg-violet-500",
  CALIFICADO: "bg-cyan-500",
  PROPUESTA: "bg-amber-500",
  NEGOCIACION: "bg-rose-500",
  GANADO: "bg-emerald-500",
  PERDIDO: "bg-slate-400",
};

// Color de relleno del botón por etapa.
const STAGE_BUTTON_CLASS: Record<CrmStage, string> = {
  NUEVO: "bg-violet-500 hover:bg-violet-600",
  CALIFICADO: "bg-cyan-500 hover:bg-cyan-600",
  PROPUESTA: "bg-amber-500 hover:bg-amber-600",
  NEGOCIACION: "bg-rose-500 hover:bg-rose-600",
  GANADO: "bg-emerald-500 hover:bg-emerald-600",
  PERDIDO: "bg-slate-400 hover:bg-slate-500",
};

export function CrmStageControl({ contactId, stage }: CrmStageControlProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [currentStage, setCurrentStage] = useState<CrmStage>(stage);
  const [error, setError] = useState<string | null>(null);
  // Segundo paso del modal: eligio "Descartado" y falta el motivo.
  const [askingLostReason, setAskingLostReason] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setCurrentStage(stage);
  }, [stage]);

  const commitStage = useCallback(
    (nextStage: CrmStage, lostReason?: string) => {
      setError(null);
      const previousStage = currentStage;
      setCurrentStage(nextStage);
      setOpen(false);
      setAskingLostReason(false);
      startTransition(async () => {
        const result = await updateCrmStageAction({ contactId, status: nextStage, lostReason });
        if (result?.error) {
          setCurrentStage(previousStage);
          setError(result.error);
          return;
        }
        router.refresh();
      });
    },
    [contactId, currentStage, router],
  );

  const handleSelect = useCallback(
    (nextStage: CrmStage) => {
      if (nextStage === currentStage) {
        setOpen(false);
        return;
      }

      // Descartar pide el motivo en un segundo paso, dentro del mismo modal. Es el unico dato
      // del CRM que no se puede deducir de la conversacion —por que se cayo la venta lo sabe
      // solo quien vende— y sin el, el informe de razones de perdida no existe. Se pregunta
      // aca, en el momento en que ella ya tiene la respuesta en la cabeza, y no despues.
      if (nextStage === "PERDIDO") {
        setError(null);
        setAskingLostReason(true);
        return;
      }

      commitStage(nextStage);
    },
    [commitStage, currentStage],
  );

  const currentLabel = CRM_STAGE_META[currentStage].label;

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setAskingLostReason(false); }}>
      <DialogTrigger
        disabled={isPending}
        title={error ?? `Etapa CRM: ${currentLabel}`}
        className={`inline-flex h-7 max-w-[160px] items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium text-white transition disabled:opacity-60 ${STAGE_BUTTON_CLASS[currentStage]}`}
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-80" />
      </DialogTrigger>

      {/* Modal con header y footer fijos; solo la lista de etapas scrollea. */}
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[80vh] w-[calc(100vw-2rem)] max-w-sm flex-col gap-0 overflow-hidden p-0"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <DialogTitle className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Target className="h-3.5 w-3.5" />
            {askingLostReason ? "¿Por qué se perdió?" : "Etapa del CRM"}
          </DialogTitle>
          <button
            type="button"
            onClick={() => (askingLostReason ? setAskingLostReason(false) : setOpen(false))}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label={askingLostReason ? "Volver" : "Cerrar"}
          >
            {askingLostReason ? <ArrowLeft className="h-4 w-4" /> : <X className="h-4 w-4" />}
          </button>
        </div>

        {askingLostReason ? (
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {CRM_LOST_REASONS.map((reason) => (
              <button
                key={reason.value}
                type="button"
                disabled={isPending}
                onClick={() => commitStage("PERDIDO", reason.value)}
                className="flex w-full items-center px-4 py-2.5 text-left text-[13px] text-foreground transition hover:bg-muted disabled:opacity-50"
              >
                {reason.label}
              </button>
            ))}
          </div>
        ) : (
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {CRM_STAGE_ORDER.map((stageValue) => {
            const selected = stageValue === currentStage;
            return (
              <button
                key={stageValue}
                type="button"
                disabled={isPending}
                onClick={() => handleSelect(stageValue)}
                className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-[13px] text-foreground transition hover:bg-muted disabled:opacity-50"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STAGE_DOT_CLASS[stageValue]}`} />
                  <span className="truncate">{CRM_STAGE_META[stageValue].label}</span>
                </span>
                {selected ? <Check className="h-4 w-4 shrink-0 text-emerald-500" /> : null}
              </button>
            );
          })}
        </div>
        )}

        <div className="flex shrink-0 justify-end border-t border-border p-3">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
