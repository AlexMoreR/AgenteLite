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

const responseLengthSelectItems = responseLengthOptions.map((option) => ({
  label: option.label,
  value: option.value,
}));

export function TrainingResponseLengthField({
  defaultValue,
  helpText,
}: TrainingResponseLengthFieldProps) {
  const [responseLengthValue, setResponseLengthValue] =
    useState<ResponseLength>(defaultValue);

  const selectedResponseLength = responseLengthValue;

  return (
    <label className="">
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
        
        <span className="rounded-full border border-[color-mix(in_srgb,var(--primary)_18%,white)] bg-[color-mix(in_srgb,var(--primary)_8%,white)] px-2.5 py-1 text-[11px] font-semibold text-[var(--primary)]">
          {getResponseLengthLabel(selectedResponseLength)}
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
        items={responseLengthSelectItems}
      >
        <SelectTrigger className="h-11 w-full   bg-white px-3.5 text-[13px] text-slate-800 shadow-[0_18px_32px_-34px_rgba(15,23,42,0.18)]">
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
