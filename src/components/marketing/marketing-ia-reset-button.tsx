"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { RotateCcw } from "lucide-react";
import { resetMarketingIaConfigurationAction } from "@/app/actions/marketing-actions";

const MARKETING_HISTORY_KEY = "marketing-ia:facebook-ads-history:v1";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-red-200 bg-white px-4 text-sm font-medium text-red-600 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <RotateCcw className="h-4 w-4" />
      {pending ? "Reiniciando..." : "Empezar de 0"}
    </button>
  );
}

export function MarketingIaResetButton() {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={resetMarketingIaConfigurationAction}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          "Esto eliminara el contexto comercial, el logo de marketing y el historial del Ads Generator. Esta accion no se puede deshacer.",
        );

        if (!confirmed) {
          event.preventDefault();
          return;
        }

        window.localStorage.removeItem(MARKETING_HISTORY_KEY);
      }}
    >
      <SubmitButton />
    </form>
  );
}
