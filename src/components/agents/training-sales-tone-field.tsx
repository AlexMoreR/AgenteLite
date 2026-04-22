"use client";

import { useState } from "react";
import { TrainingHelpPopover } from "@/components/agents/training-help-popover";
import { toneOptions, type SalesTone } from "@/lib/agent-training";

type TrainingSalesToneFieldProps = {
  defaultValue: SalesTone;
  helpText?: string;
};

export function TrainingSalesToneField({
  defaultValue,
  helpText,
}: TrainingSalesToneFieldProps) {
  const [salesTone, setSalesTone] = useState<SalesTone>(defaultValue);

  return (
    <div className="rounded-[18px] border border-[color-mix(in_srgb,var(--primary)_12%,white)] bg-[color-mix(in_srgb,var(--primary)_5%,white)] px-3.5 py-3">
      <input type="hidden" name="salesTone" value={salesTone} />
      <div className="flex items-center gap-2">
        <span className="h-4 w-1 rounded-full bg-[var(--primary)]" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Personalidad</span>
        {helpText ? <TrainingHelpPopover title="Personalidad" description={helpText} /> : null}
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {toneOptions.map((option) => {
          const isActive = salesTone === option.value;

          return (
            <button
              key={option.value}
              type="button"
              data-autosave-trigger="true"
              onClick={() => setSalesTone(option.value)}
              className={`flex min-h-[74px] flex-col justify-between rounded-[16px] border px-3 py-2.5 text-left transition duration-200 ${
                isActive
                  ? "border-[color-mix(in_srgb,var(--primary)_88%,white)] bg-[color-mix(in_srgb,var(--primary)_8%,white)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_24%,white),0_16px_28px_-28px_color-mix(in_srgb,var(--primary)_88%,black)]"
                  : "border-[rgba(148,163,184,0.16)] bg-white hover:border-[color-mix(in_srgb,var(--primary)_34%,white)]"
              }`}
              aria-pressed={isActive}
            >
              <span className="text-[13px] font-semibold leading-5 text-slate-900">{option.label}</span>
              <span className="text-[11px] leading-4.5 text-slate-500">{option.prompt}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
