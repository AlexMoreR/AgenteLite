"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Target } from "lucide-react";
import { updateCrmStageAction } from "@/app/actions/crm-actions";
import { CRM_STAGE_META, CRM_STAGE_ORDER } from "@/features/crm/domain/crm-config";
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

export function CrmStageControl({ contactId, stage }: CrmStageControlProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [currentStage, setCurrentStage] = useState<CrmStage>(stage);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setCurrentStage(stage);
  }, [stage]);

  const handleToggle = useCallback(() => {
    setOpen((value) => !value);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const handleSelect = useCallback(
    (nextStage: CrmStage) => {
      if (nextStage === currentStage) {
        setOpen(false);
        return;
      }
      setError(null);
      const previousStage = currentStage;
      setCurrentStage(nextStage);
      setOpen(false);
      startTransition(async () => {
        const result = await updateCrmStageAction({ contactId, status: nextStage });
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

  const currentLabel = CRM_STAGE_META[currentStage].label;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        disabled={isPending}
        className="inline-flex h-7 max-w-[160px] items-center gap-1.5 rounded-md border border-border bg-card px-2 text-[12px] font-medium text-foreground transition hover:bg-muted disabled:opacity-60"
        title={error ?? `Etapa CRM: ${currentLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${STAGE_DOT_CLASS[currentStage]}`} />
        <span className="truncate">{currentLabel}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-popover shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)]">
          <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Target className="h-3.5 w-3.5" />
            Etapa del CRM
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {CRM_STAGE_ORDER.map((stageValue) => {
              const selected = stageValue === currentStage;
              return (
                <button
                  key={stageValue}
                  type="button"
                  disabled={isPending}
                  onClick={() => handleSelect(stageValue)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-muted disabled:opacity-50"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${STAGE_DOT_CLASS[stageValue]}`} />
                    <span className="truncate">{CRM_STAGE_META[stageValue].label}</span>
                  </span>
                  {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
