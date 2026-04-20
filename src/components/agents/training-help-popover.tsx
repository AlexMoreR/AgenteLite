"use client";

import { CircleHelp } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type TrainingHelpPopoverProps = {
  title: string;
  description: string;
};

export function TrainingHelpPopover({ title, description }: TrainingHelpPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Ayuda sobre ${title}`}
          className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full text-slate-400 transition hover:text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_22%,white)]"
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="mt-1 text-xs leading-5">{description}</p>
      </PopoverContent>
    </Popover>
  );
}
