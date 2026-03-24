"use client";

import { useState } from "react";
import { TrainingHelpPopover } from "@/components/agents/training-help-popover";
import {
  getResponseLengthFromValue,
  getResponseLengthLabel,
  getResponseLengthSliderValue,
  type ResponseLength,
} from "@/lib/agent-training";

type TrainingResponseLengthFieldProps = {
  defaultValue: ResponseLength;
  helpText?: string;
};

export function TrainingResponseLengthField({ defaultValue, helpText }: TrainingResponseLengthFieldProps) {
  const [responseLengthValue, setResponseLengthValue] = useState(getResponseLengthSliderValue(defaultValue));

  return (
    <label className="space-y-2">
      <span className="flex items-center justify-between gap-3 text-sm font-medium text-slate-700">
        <span className="inline-flex items-center gap-2">
          <span>Longitud de respuesta</span>
          {helpText ? <TrainingHelpPopover title="Longitud de respuesta" description={helpText} /> : null}
        </span>
        <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_10%,white)] px-3 py-1 text-xs font-semibold text-[var(--primary)]">
          {getResponseLengthLabel(getResponseLengthFromValue(responseLengthValue))}
        </span>
      </span>
      <input
        type="range"
        name="responseLengthValue"
        min="0"
        max="100"
        step="50"
        value={responseLengthValue}
        onChange={(event) => setResponseLengthValue(Number(event.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-[var(--primary)]"
      />
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
        <span>Muy corto</span>
        <span>Equilibrado</span>
        <span>Detallado</span>
      </div>
    </label>
  );
}
