"use client";

import { useState } from "react";
import { Check } from "lucide-react";

type KnowledgeSelectionCheckboxProps = {
  name: string;
  value: string;
  defaultChecked: boolean;
  ariaLabel: string;
  className?: string;
};

export function KnowledgeSelectionCheckbox({
  name,
  value,
  defaultChecked,
  ariaLabel,
  className = "",
}: KnowledgeSelectionCheckboxProps) {
  const [checked, setChecked] = useState(defaultChecked);

  return (
    <label className={`inline-flex cursor-pointer items-center ${className}`}>
      <input
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        onChange={(event) => setChecked(event.target.checked)}
        aria-label={ariaLabel}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`inline-flex h-5 w-5 items-center justify-center rounded-[6px] border transition peer-focus-visible:ring-4 peer-focus-visible:ring-[color-mix(in_srgb,var(--primary)_18%,white)] ${
          checked
            ? "border-[var(--primary)] bg-[var(--primary)] text-white"
            : "border-slate-300 bg-white text-transparent hover:border-[var(--primary)]"
        }`}
      >
        <Check className="h-3.5 w-3.5 stroke-[3]" />
      </span>
    </label>
  );
}
