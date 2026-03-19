"use client";

import { Check } from "lucide-react";

type ProductFormStep = {
  id: number;
  label: string;
};

type ProductFormStepperProps = {
  steps: readonly ProductFormStep[];
  activeStep: number;
};

export function ProductFormStepper({ steps, activeStep }: ProductFormStepperProps) {
  return (
    <div className="overflow-visible rounded-xl border border-[var(--line)] bg-white px-2 pb-3 pt-4 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.35)]">
      <div className="relative overflow-x-auto overflow-y-visible pb-0.5">
      <div className="pointer-events-none absolute left-7 right-7 top-4.5 h-px bg-[var(--line)]" />
      <div
        className="pointer-events-none absolute left-7 top-4.5 h-px bg-[var(--primary)]/40 transition-all duration-300"
        style={{
          width:
            steps.length > 1
              ? `calc((100% - 3.5rem) * ${Math.max(0, activeStep - 1) / (steps.length - 1)})`
              : "0%",
        }}
      />
      <div className="relative flex items-start justify-between gap-2">
          {steps.map((step) => {
            const isCurrent = activeStep === step.id;
            const isDone = activeStep > step.id;
            return (
              <div key={step.id} className="flex min-w-[4.5rem] flex-1 items-center gap-2">
                <div className="flex min-w-[4.5rem] flex-col items-center text-center">
                  <span
                    className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition ${
                      isCurrent
                        ? "bg-[var(--primary)] text-white shadow-[0_8px_18px_-10px_rgba(88,28,135,0.55)]"
                        : isDone
                          ? "bg-[#e8efff] text-[var(--primary)]"
                          : "bg-white text-slate-500 ring-1 ring-[var(--line)]"
                    }`}
                  >
                    {isDone ? <Check className="h-3.5 w-3.5" /> : step.id}
                  </span>
                  <span
                    className={`mt-1 text-[11px] font-semibold leading-tight ${
                      isCurrent || isDone ? "text-slate-900" : "text-slate-500"
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              </div>
            );
          })}
      </div>
      </div>
    </div>
  );
}
