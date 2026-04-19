"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SendHorizonal, Sparkles } from "lucide-react";
import {
  applyAgentPromptCopilotChangesAction,
  runAgentPromptCopilotAction,
} from "@/app/actions/agent-actions";

type AgentCopilotPatch = {
  businessName?: string;
  businessDescription?: string;
  targetAudiences?: string[];
  priceRangeMin?: string;
  priceRangeMax?: string;
  salesTone?: string;
  responseLength?: string;
  useEmojis?: boolean;
  useExpressivePunctuation?: boolean;
  useTuteo?: boolean;
  useCustomerName?: boolean;
  askNameFirst?: boolean;
  offerBestSeller?: boolean;
  handlePriceObjections?: boolean;
  askForOrder?: boolean;
  sendPaymentLink?: boolean;
  handoffToHuman?: boolean;
  forbiddenRules?: string[];
  customRules?: string;
};

type CopilotMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

type PendingSuggestion = {
  changes: AgentCopilotPatch;
  changeSummary: string[];
  promptPreview: string | null;
};

let copilotMessageSequence = 0;

function createCopilotMessageId(prefix: string) {
  copilotMessageSequence += 1;
  return `${prefix}-${copilotMessageSequence}`;
}

export function AgentPromptCopilot({
  agentId,
}: {
  agentId: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<CopilotMessage[]>([
    {
      id: "assistant-welcome",
      role: "assistant",
      content:
        "Soy tu copiloto del agente. Puedes pedirme que mejore el tono, agregue reglas, quite comportamientos o restructure el prompt para tu negocio.",
    },
  ]);
  const [pendingSuggestion, setPendingSuggestion] = useState<PendingSuggestion | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSending, startSendTransition] = useTransition();
  const [isApplying, startApplyTransition] = useTransition();

  function handleSend(prefilled?: string) {
    const message = (prefilled ?? draft).trim();
    if (!message) return;

    setFeedback(null);
    if (!prefilled) setDraft("");

    const nextUserMessage: CopilotMessage = {
      id: createCopilotMessageId("user"),
      role: "user",
      content: message,
    };

    setMessages((current) => [...current, nextUserMessage]);

    const historyForAction = messages.map((item) => ({
      role: item.role,
      content: item.content,
    }));

    startSendTransition(async () => {
      const result = await runAgentPromptCopilotAction({
        agentId,
        message,
        history: historyForAction,
      });

      if (!result.ok) {
        setMessages((current) => [
          ...current,
          {
            id: createCopilotMessageId("assistant-error"),
            role: "assistant",
            content: result.error,
          },
        ]);
        setPendingSuggestion(null);
        return;
      }

      setMessages((current) => [
        ...current,
        {
          id: createCopilotMessageId("assistant"),
          role: "assistant",
          content: result.reply,
        },
      ]);

      if (result.changeSummary.length > 0) {
        setPendingSuggestion({
          changes: result.changes,
          changeSummary: result.changeSummary,
          promptPreview: result.promptPreview,
        });
      } else {
        setPendingSuggestion(null);
      }
    });
  }

  function handleApplySuggestion() {
    if (!pendingSuggestion) return;

    setFeedback(null);
    startApplyTransition(async () => {
      const result = await applyAgentPromptCopilotChangesAction({
        agentId,
        changes: pendingSuggestion.changes,
      });

      if (!result.ok) {
        setFeedback(result.error);
        return;
      }

      setFeedback(result.message);
      setPendingSuggestion(null);
      router.refresh();
    });
  }

  return (
    <div className="rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-4 shadow-[0_24px_54px_-42px_rgba(15,23,42,0.14)] sm:p-5">
      <div className="space-y-4">
        <div className="max-h-[420px] space-y-3 overflow-y-auto rounded-[24px] border border-[rgba(148,163,184,0.12)] bg-slate-50/70 p-3 sm:p-4">
          {messages.map((message) => (
            <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[88%] rounded-[22px] px-4 py-3 text-sm leading-6 shadow-[0_10px_24px_-22px_rgba(15,23,42,0.18)] ${
                  message.role === "user"
                    ? "rounded-br-md bg-[linear-gradient(180deg,#1d4ed8_0%,#1e40af_100%)] text-white"
                    : "rounded-bl-md border border-[rgba(148,163,184,0.12)] bg-white text-slate-800"
                }`}
              >
                {message.content}
              </div>
            </div>
          ))}

          {isSending ? (
            <div className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(148,163,184,0.12)] bg-white px-4 py-2 text-sm text-slate-500">
                <Sparkles className="h-4 w-4 animate-pulse" />
                Pensando cambios...
              </div>
            </div>
          ) : null}

          {pendingSuggestion ? (
            <div className="rounded-[22px] border border-[color:color-mix(in_srgb,var(--primary)_16%,white)] bg-[color:color-mix(in_srgb,var(--primary)_4%,white)] px-4 py-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--primary)]">
                Sugerencia lista para aplicar
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {pendingSuggestion.changeSummary.map((item) => (
                  <span
                    key={item}
                    className="inline-flex rounded-full border border-[color:color-mix(in_srgb,var(--primary)_16%,white)] bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700"
                  >
                    {item}
                  </span>
                ))}
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={handleApplySuggestion}
                  disabled={isApplying}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)] disabled:opacity-50"
                >
                  {isApplying ? "Aplicando..." : "Aplicar cambios al agente"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingSuggestion(null);
                    setFeedback(null);
                  }}
                  disabled={isApplying}
                  className="inline-flex h-11 items-center justify-center rounded-2xl border border-[rgba(148,163,184,0.16)] px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Descartar sugerencia
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-3"
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={1}
            placeholder="Ej. Haz que el agente hable mas formal, quite emojis y agregue una regla para no prometer tiempos de entrega."
            className="h-12 min-h-12 flex-1 resize-none rounded-[24px] border border-[rgba(148,163,184,0.16)] bg-white px-4 py-[0.8rem] text-sm leading-5 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)]"
            disabled={isSending || isApplying}
          />
          <button
            type="submit"
            disabled={isSending || isApplying || !draft.trim()}
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary)] text-white transition hover:bg-[var(--primary-strong)] disabled:opacity-50"
            aria-label="Enviar instruccion al copiloto"
          >
            <SendHorizonal className="h-4.5 w-4.5" />
          </button>
        </form>

        {feedback ? (
          <div className="rounded-[18px] bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{feedback}</div>
        ) : null}
      </div>
    </div>
  );
}
