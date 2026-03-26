"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import { useFormStatus } from "react-dom";

export function FormSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)] disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? (
        <>
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Generando anuncios...
        </>
      ) : (
        <>
          <Sparkles className="h-4 w-4" />
          Generar 3 anuncios
        </>
      )}
    </button>
  );
}
