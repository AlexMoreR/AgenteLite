"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import { useFormStatus } from "react-dom";

type FormSubmitButtonProps = {
  idleLabel: string;
  pendingLabel: string;
};

export function FormSubmitButton({ idleLabel, pendingLabel }: FormSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-5 text-sm font-medium text-white shadow-[0_16px_30px_-20px_color-mix(in_srgb,var(--primary)_65%,black)] transition hover:bg-[var(--primary-strong)] disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      <span>{pending ? pendingLabel : idleLabel}</span>
    </button>
  );
}
