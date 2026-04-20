"use client";

import { useState } from "react";
import { TrainingHelpPopover } from "@/components/agents/training-help-popover";
import {
  getResponseLengthFromValue,
  getResponseLengthLabel,
  getResponseLengthSliderValue,
  responseLengthOptions,
  type ResponseLength,
} from "@/lib/agent-training";

type TrainingResponseLengthFieldProps = {
  defaultValue: ResponseLength;
  helpText?: string;
};

const responseLengthSteps = [
  { value: 0, label: "Muy corto", align: "left" as const },
  { value: 50, label: "Equilibrado", align: "center" as const },
  { value: 100, label: "Detallado", align: "right" as const },
];

export function TrainingResponseLengthField({
  defaultValue,
  helpText,
}: TrainingResponseLengthFieldProps) {
  const [responseLengthValue, setResponseLengthValue] = useState(getResponseLengthSliderValue(defaultValue));
  const selectedResponseLength = getResponseLengthFromValue(responseLengthValue);
  const selectedResponseLengthPrompt =
    responseLengthOptions.find((option) => option.value === selectedResponseLength)?.prompt ?? responseLengthOptions[1].prompt;
  const sliderProgress = `${responseLengthValue}%`;

  const handleStepSelect = (value: number) => {
    if (value === responseLengthValue) {
      return;
    }

    setResponseLengthValue(value);
  };

  return (
    <label className="space-y-2.5 rounded-[18px] border border-[rgba(148,163,184,0.12)] bg-[linear-gradient(180deg,#ffffff_0%,#fafbfc_100%)] px-3.5 py-3">
      <span className="flex items-center justify-between gap-3 text-[13px] font-medium text-slate-700">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-4 w-1 rounded-full bg-[var(--primary)]" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Longitud de respuesta</span>
          {helpText ? <TrainingHelpPopover title="Longitud de respuesta" description={helpText} /> : null}
        </span>
        <span className="rounded-full border border-[color-mix(in_srgb,var(--primary)_18%,white)] bg-[color-mix(in_srgb,var(--primary)_8%,white)] px-2.5 py-1 text-[11px] font-semibold text-[var(--primary)]">
          {getResponseLengthLabel(selectedResponseLength)}
        </span>
      </span>
      <input type="hidden" name="responseLengthValue" value={responseLengthValue} />
      <div className="relative pt-1">
        <div
          className="pointer-events-none absolute inset-x-0 top-[0.6875rem] h-1.5 rounded-full bg-slate-200/95"
        />
        <div
          className="pointer-events-none absolute left-0 top-[0.6875rem] h-1.5 rounded-full bg-[color-mix(in_srgb,var(--primary)_95%,white)]"
          style={{
            width: sliderProgress,
          }}
        />
        <div
          className="pointer-events-none absolute top-1/2 z-10 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--primary)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_28%,white),0_8px_18px_-10px_color-mix(in_srgb,var(--primary)_72%,black)]"
          style={{
            left: `calc(${sliderProgress} - 0.5rem)`,
          }}
        />
        <div className="relative z-20 grid grid-cols-3">
          {responseLengthSteps.map((step) => (
            <button
              key={step.value}
              type="button"
              onClick={() => handleStepSelect(step.value)}
              data-autosave-trigger="true"
              className={`flex h-6 items-center ${step.align === "left" ? "justify-start" : step.align === "right" ? "justify-end" : "justify-center"}`}
              aria-label={`Seleccionar ${step.label}`}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full border transition ${
                  responseLengthValue >= step.value
                    ? "border-[var(--primary)] bg-[var(--primary)]"
                    : "border-slate-300 bg-white"
                }`}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-3 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">
        <span>Muy corto</span>
        <span className="text-center">Equilibrado</span>
        <span className="text-right">Detallado</span>
      </div>
      <p className="text-[12px] leading-5 text-slate-600">{selectedResponseLengthPrompt}</p>
    </label>
  );
}
