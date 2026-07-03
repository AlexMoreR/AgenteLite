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
    <label className="space-y-2.5 rounded-xl border border-border bg-card px-3.5 py-3">
      <span className="flex items-center justify-between gap-3 text-[13px] font-medium text-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-4 w-1 rounded-full bg-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Longitud de respuesta
          </span>
          {helpText ? (
            <TrainingHelpPopover
              title="Longitud de respuesta"
              description={helpText}
            />
          ) : null}
        </span>
        <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
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
        <SelectTrigger className="h-11 w-full rounded-xl border-border bg-background px-3.5 text-[13px] text-foreground">
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
