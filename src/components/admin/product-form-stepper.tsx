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
    <div className="overflow-visible rounded-xl border border-border bg-card px-2 pb-3 pt-4 shadow-sm">
      <div className="relative overflow-x-auto overflow-y-visible pb-0.5">
      <div className="pointer-events-none absolute left-7 right-7 top-4.5 h-px bg-border" />
      <div
        className="pointer-events-none absolute left-7 top-4.5 h-px bg-primary/40 transition-all duration-300"
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
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : isDone
                          ? "bg-primary/10 text-primary"
                          : "bg-card text-muted-foreground ring-1 ring-border"
                    }`}
                  >
                    {isDone ? <Check className="h-3.5 w-3.5" /> : step.id}
                  </span>
                  <span
                    className={`mt-1 text-[11px] font-semibold leading-tight ${
                      isCurrent || isDone ? "text-foreground" : "text-muted-foreground"
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
