"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Copy, Check } from "lucide-react";
import { saveAgentAdvancedPromptAction } from "@/app/actions/agent-actions";
import { Switch } from "@/components/ui/switch";

type AgentAdvancedPromptFormProps = {
  agentId: string;
  generatedSystemPrompt: string;
  useCustomPrompt: boolean;
  customSystemPrompt: string;
  successMessage?: string;
};

export function AgentAdvancedPromptForm({
  agentId,
  generatedSystemPrompt,
  useCustomPrompt: initialUseCustom,
  customSystemPrompt: initialCustomPrompt,
  successMessage,
}: AgentAdvancedPromptFormProps) {
  const [useCustom, setUseCustom] = useState(initialUseCustom);
  const [showGenerated, setShowGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    formData.set("useCustomPrompt", String(useCustom));
    startTransition(async () => {
      await saveAgentAdvancedPromptAction(formData);
    });
  }

  async function copyGenerated() {
    await navigator.clipboard.writeText(generatedSystemPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <input type="hidden" name="agentId" value={agentId} />

      {successMessage && (
        <div className="rounded-[16px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-700">
          {successMessage}
        </div>
      )}

      <div className="rounded-[22px] border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcfd_100%)] p-4 shadow-[0_20px_44px_-38px_rgba(15,23,42,0.18)] sm:p-5 space-y-4">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 flex items-center gap-2">
            <span className="h-4 w-1 rounded-full bg-[var(--primary)]" />
            Modo avanzado
          </p>
          <p className="text-[12px] text-slate-500 pl-3">
            Escribe el prompt completo del agente manualmente. Anula el sistema de entrenamiento automatico.
          </p>
        </div>

        <label className="group flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-[18px] border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcfd_100%)] px-3.5 py-3 transition hover:border-[color-mix(in_srgb,var(--primary)_34%,white)]">
          <span className="min-w-0 space-y-0.5">
            <span className="block text-[13px] font-semibold text-slate-900">Usar prompt personalizado</span>
            <span className="block text-[12px] leading-5 text-slate-500">
              {useCustom
                ? "Activo — el agente usara exactamente el prompt que escribiste abajo."
                : "Inactivo — el agente usa el prompt generado automaticamente desde Entrenamiento."}
            </span>
          </span>
          <Switch
            checked={useCustom}
            onCheckedChange={setUseCustom}
            aria-label="Usar prompt personalizado"
            className="h-6 w-11 shrink-0 bg-slate-200 data-[state=checked]:bg-[var(--primary)]"
          />
        </label>

        {useCustom ? (
          <div className="space-y-2">
            <label className="block text-[13px] font-medium text-slate-700">
              Prompt personalizado
            </label>
            <textarea
              name="customSystemPrompt"
              rows={20}
              defaultValue={initialCustomPrompt}
              placeholder="Escribe aqui el prompt completo del agente. Puedes copiar el prompt generado de abajo como punto de partida."
              className="flex w-full rounded-[20px] border border-[rgba(148,163,184,0.16)] bg-white px-3.5 py-3 font-mono text-[12px] leading-5 text-slate-800 shadow-[0_18px_32px_-34px_rgba(15,23,42,0.18)] outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)] resize-y"
            />
            <p className="text-[11px] text-slate-400">
              Tip: copia el prompt generado de la seccion de abajo como punto de partida y modificalo a tu gusto.
            </p>
          </div>
        ) : (
          <input type="hidden" name="customSystemPrompt" value={initialCustomPrompt} />
        )}
      </div>

      <div className="rounded-[22px] border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcfd_100%)] shadow-[0_20px_44px_-38px_rgba(15,23,42,0.18)] overflow-hidden">
        <button
          type="button"
          onClick={() => setShowGenerated((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3.5 sm:px-5 text-left transition hover:bg-slate-50/60"
        >
          <span className="space-y-0.5">
            <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <span className="h-4 w-1 rounded-full bg-slate-300" />
              Prompt generado automaticamente
            </span>
            <span className="block text-[12px] text-slate-500 pl-3">
              El que se usa cuando el modo avanzado esta desactivado. Usalo como base.
            </span>
          </span>
          {showGenerated ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
          )}
        </button>

        {showGenerated && (
          <div className="border-t border-[rgba(148,163,184,0.12)] px-4 py-3.5 sm:px-5 space-y-2">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={copyGenerated}
                className="inline-flex items-center gap-1.5 rounded-[12px] border border-[rgba(148,163,184,0.2)] bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:border-[var(--primary)] hover:text-[var(--primary)]"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copiado" : "Copiar"}
              </button>
            </div>
            <pre className="whitespace-pre-wrap rounded-[16px] border border-[rgba(148,163,184,0.12)] bg-slate-50 px-3.5 py-3 font-mono text-[11px] leading-5 text-slate-700 overflow-x-auto">
              {generatedSystemPrompt || "(prompt vacio — configura el entrenamiento primero)"}
            </pre>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-11 items-center justify-center rounded-[16px] bg-[var(--primary)] px-5 text-[13px] font-semibold text-white shadow-[0_18px_32px_-20px_color-mix(in_srgb,var(--primary)_58%,black)] transition hover:bg-[var(--primary-strong)] disabled:opacity-60"
        >
          {pending ? "Guardando..." : "Guardar configuracion avanzada"}
        </button>
      </div>
    </form>
  );
}
