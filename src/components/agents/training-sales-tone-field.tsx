"use client";

import { useState } from "react";
import { TrainingHelpPopover } from "@/components/agents/training-help-popover";
import { toneOptions, type SalesTone } from "@/lib/agent-training";

type TrainingSalesToneFieldProps = {
  defaultValue: SalesTone;
  helpText?: string;
  showHeader?: boolean;
};

const toneEmojiMap = {
  "muy-formal": "💼",
  "amigable-profesional": "✅",
  "cercano-casual": "😊",
  entusiasta: "✨",
} as const;

export function TrainingSalesToneField({
  defaultValue,
  helpText,
  showHeader = true,
}: TrainingSalesToneFieldProps) {
  const [salesTone, setSalesTone] = useState<SalesTone>(defaultValue);

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/10 px-3.5 py-3">
      <input type="hidden" name="salesTone" value={salesTone} />
      {showHeader ? (
        <div className="flex items-center gap-2">
          <span className="h-4 w-1 rounded-full bg-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Personalidad</span>
          {helpText ? <TrainingHelpPopover title="Personalidad" description={helpText} /> : null}
        </div>
      ) : null}
      <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-4">
        {toneOptions.map((option) => {
          const isActive = salesTone === option.value;

          return (
            <button
              key={option.value}
              type="button"
              data-autosave-trigger="true"
              onClick={() => setSalesTone(option.value)}
              className={`flex min-h-[74px] flex-col justify-between rounded-xl border px-3 py-2.5 text-left transition duration-200 ${
                isActive
                  ? "border-primary bg-primary/10 shadow-sm"
                  : "border-border bg-background hover:border-primary"
              }`}
              aria-pressed={isActive}
            >
              <span className="inline-flex items-center gap-2">
                <span className="text-[13px] font-semibold leading-5 text-foreground">{option.label}</span>
                <span className="shrink-0 text-base leading-none" aria-hidden="true">
                  {toneEmojiMap[option.value]}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
