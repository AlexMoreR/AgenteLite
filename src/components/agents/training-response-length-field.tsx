"use client";

import { useState } from "react";

import { TrainingHelpPopover } from "@/components/agents/training-help-popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getResponseLengthLabel,
  getResponseLengthSliderValue,
  responseLengthOptions,
  type ResponseLength,
} from "@/lib/agent-training";

type TrainingResponseLengthFieldProps = {
  defaultValue: ResponseLength;
  helpText?: string;
};

export function TrainingResponseLengthField({
  defaultValue,
  helpText,
}: TrainingResponseLengthFieldProps) {
  const [responseLengthValue, setResponseLengthValue] =
    useState<ResponseLength>(defaultValue);

  return (
    <label className="space-y-2.5 rounded-[18px] border border-[rgba(148,163,184,0.12)] bg-[linear-gradient(180deg,#ffffff_0%,#fafbfc_100%)] px-3.5 py-3">
      <span className="flex items-center justify-between gap-3 text-[13px] font-medium text-slate-700">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-4 w-1 rounded-full bg-[var(--primary)]" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Longitud de respuesta
          </span>
          {helpText ? (
            <TrainingHelpPopover
              title="Longitud de respuesta"
              description={helpText}
            />
          ) : null}
        </span>
        <span className="rounded-full border border-[color-mix(in_srgb,var(--primary)_18%,white)] bg-[color-mix(in_srgb,var(--primary)_8%,white)] px-2.5 py-1 text-[11px] font-semibold text-[var(--primary)]">
          {getResponseLengthLabel(responseLengthValue)}
        </span>
      </span>

      <input
        type="hidden"
        name="responseLengthValue"
        value={getResponseLengthSliderValue(responseLengthValue)}
      />

      <Select
        value={responseLengthValue}
        onValueChange={(value) => setResponseLengthValue(value as ResponseLength)}
      >
        <SelectTrigger className="h-11 w-full rounded-[16px] border-[rgba(148,163,184,0.14)] bg-white px-3.5 text-[13px] text-slate-800 shadow-[0_18px_32px_-34px_rgba(15,23,42,0.18)]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {responseLengthOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
