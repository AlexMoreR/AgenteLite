"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, Plus, SendHorizonal, Sparkles } from "lucide-react";
import type { ResponseLength, SalesTone, TargetAudience } from "@/lib/agent-training";
import {
  applyAgentPromptCopilotChangesAction,
  clearAgentCopilotHistoryAction,
  importAgentPromptCopilotHistoryAction,
  runAgentPromptCopilotAction,
} from "@/app/actions/agent-actions";
import { ChatScrollAnchor } from "@/components/agents/chat-scroll-anchor";

type AgentCopilotPatch = {
  businessName?: string;
  businessDescription?: string;
  targetAudiences?: TargetAudience[];
  priceRangeMin?: string;
  priceRangeMax?: string;
  salesTone?: SalesTone;
  responseLength?: ResponseLength;
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

type PersistedCopilotState = {
  draft: string;
  pendingSuggestion: PendingSuggestion | null;
  feedback: string | null;
};

type LegacyPersistedCopilotState = PersistedCopilotState & {
  messages?: CopilotMessage[];
};

let copilotMessageSequence = 0;

const defaultWelcomeMessage: CopilotMessage = {
  id: "assistant-welcome",
  role: "assistant",
  content:
    "Soy tu copiloto del agente. Puedes pedirme que mejore el tono, agregue reglas, quite comportamientos o restructure el prompt para tu negocio.",
};

function createCopilotMessageId(prefix: string) {
  copilotMessageSequence += 1;
  return `${prefix}-${copilotMessageSequence}`;
}

function normalizeCopilotMessages(rawMessages: unknown): CopilotMessage[] {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return [];
  }

  const seenIds = new Set<string>();
  const normalizedMessages = rawMessages
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const rawRole = "role" in item ? item.role : null;
      const rawContent = "content" in item ? item.content : null;
      const rawId = "id" in item ? item.id : null;

      if ((rawRole !== "assistant" && rawRole !== "user") || typeof rawContent !== "string" || !rawContent.trim()) {
        return null;
      }

      const fallbackId = `${rawRole}-${index + 1}`;
      let nextId = typeof rawId === "string" && rawId.trim() ? rawId.trim() : fallbackId;

      if (seenIds.has(nextId)) {
        nextId = `${fallbackId}-${index + 1}`;
      }

      seenIds.add(nextId);

      return {
        id: nextId,
        role: rawRole,
        content: rawContent.trim(),
      } satisfies CopilotMessage;
    })
    .filter((item): item is CopilotMessage => item !== null);

  return normalizedMessages;
}

function withWelcomeMessage(messages: CopilotMessage[]) {
  return messages.length > 0 ? messages : [defaultWelcomeMessage];
}

function stripWelcomeMessage(messages: CopilotMessage[]) {
  return messages.filter((message) => message.id !== defaultWelcomeMessage.id);
}

function syncCopilotMessageSequence(messages: CopilotMessage[]) {
  const highestSuffix = messages.reduce((maxValue, message) => {
    const match = message.id.match(/-(\d+)$/);
    if (!match) {
      return maxValue;
    }

    const parsed = Number.parseInt(match[1] || "0", 10);
    return Number.isFinite(parsed) ? Math.max(maxValue, parsed) : maxValue;
  }, 0);

  copilotMessageSequence = Math.max(copilotMessageSequence, highestSuffix);
}

export function AgentPromptCopilot({
  agentId,
  initialMessages,
}: {
  agentId: string;
  initialMessages: CopilotMessage[];
}) {
  const router = useRouter();
  const storageKey = `agent-prompt-copilot:v3:${agentId}`;
  const legacyStorageKey = `agent-prompt-copilot:v2:${agentId}`;
  const initialMessagesRef = useRef<CopilotMessage[] | null>(null);
  if (initialMessagesRef.current === null) {
    initialMessagesRef.current = normalizeCopilotMessages(initialMessages);
    syncCopilotMessageSequence(initialMessagesRef.current);
  }

  const normalizedInitialMessages = initialMessagesRef.current;
  const hasHydratedRef = useRef(false);
  const hasImportedLegacyRef = useRef(false);
  const initialConversationCountRef = useRef(normalizedInitialMessages.length);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<CopilotMessage[]>(withWelcomeMessage(normalizedInitialMessages));
  const [pendingSuggestion, setPendingSuggestion] = useState<PendingSuggestion | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSending, startSendTransition] = useTransition();
  const [isApplying, startApplyTransition] = useTransition();
  const [isClearing, startClearTransition] = useTransition();
  const [, startImportTransition] = useTransition();
  const lastMessageId = messages[messages.length - 1]?.id ?? "empty";
  const scrollDependencyKey = `${messages.length}-${lastMessageId}-${pendingSuggestion ? "suggestion" : "clean"}-${
    isSending ? "sending" : "idle"
  }`;

  useEffect(() => {
    try {
      const rawState = window.localStorage.getItem(storageKey);
      if (rawState) {
        const parsedState = JSON.parse(rawState) as Partial<PersistedCopilotState>;
        setDraft(typeof parsedState.draft === "string" ? parsedState.draft : "");
        setPendingSuggestion(parsedState.pendingSuggestion ?? null);
        setFeedback(typeof parsedState.feedback === "string" ? parsedState.feedback : null);
      }

      const rawLegacyState = window.localStorage.getItem(legacyStorageKey);
      if (rawLegacyState) {
        const parsedLegacyState = JSON.parse(rawLegacyState) as Partial<LegacyPersistedCopilotState>;
        const normalizedLegacyMessages = normalizeCopilotMessages(parsedLegacyState.messages);
        const legacyConversation = stripWelcomeMessage(normalizedLegacyMessages);

        if (legacyConversation.length > 0 && initialConversationCountRef.current === 0 && !hasImportedLegacyRef.current) {
          hasImportedLegacyRef.current = true;
          syncCopilotMessageSequence(legacyConversation);
          setMessages(withWelcomeMessage(legacyConversation));
          startImportTransition(async () => {
            const result = await importAgentPromptCopilotHistoryAction({
              agentId,
              history: legacyConversation.map((message) => ({
                role: message.role,
                content: message.content,
              })),
            });

            if (result.ok) {
              window.localStorage.removeItem(legacyStorageKey);
              router.refresh();
            } else {
              hasImportedLegacyRef.current = false;
            }
          });
        } else if (initialConversationCountRef.current > 0) {
          window.localStorage.removeItem(legacyStorageKey);
        }
      }
    } catch {
      setDraft("");
      setMessages(withWelcomeMessage(initialMessagesRef.current ?? []));
      setPendingSuggestion(null);
      setFeedback(null);
    } finally {
      hasHydratedRef.current = true;
    }
  }, [agentId, legacyStorageKey, router, storageKey]);

  useEffect(() => {
    if (!hasHydratedRef.current) return;

    const nextState: PersistedCopilotState = {
      draft,
      pendingSuggestion,
      feedback,
    };

    window.localStorage.setItem(storageKey, JSON.stringify(nextState));
  }, [draft, feedback, pendingSuggestion, storageKey]);

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

    startSendTransition(async () => {
      const result = await runAgentPromptCopilotAction({
        agentId,
        message,
        history: [],
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

  function handleClear() {
    startClearTransition(async () => {
      await clearAgentCopilotHistoryAction({ agentId });
      setMessages([defaultWelcomeMessage]);
      setPendingSuggestion(null);
      setFeedback(null);
      setDraft("");
      try {
        window.localStorage.removeItem(storageKey);
      } catch { /* ignore */ }
      router.refresh();
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

  const isEmptyState = messages.length === 1 && messages[0]?.id === defaultWelcomeMessage.id;

  const composerForm = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        handleSend();
      }}
      className="flex items-center gap-2"
    >
      <button
        type="button"
        onClick={handleClear}
        disabled={isEmptyState || isClearing || isSending || isApplying}
        title="Nueva conversación"
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[rgba(148,163,184,0.2)] bg-white text-slate-400 transition hover:border-[color-mix(in_srgb,var(--primary)_40%,white)] hover:text-[var(--primary)] disabled:opacity-30"
      >
        <Plus className="h-4 w-4" />
      </button>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={1}
        placeholder="Pregunta lo que quieras"
        className={`h-12 min-h-12 flex-1 resize-none border border-transparent px-4 py-[0.8rem] text-sm leading-5 outline-none transition placeholder:text-slate-500 focus:border-[color-mix(in_srgb,var(--primary)_18%,white)] ${
          isEmptyState
            ? "rounded-full bg-white text-slate-800 shadow-[0_2px_12px_rgba(15,23,42,0.08)] placeholder:text-slate-400 focus:border-[color-mix(in_srgb,var(--primary)_30%,white)]"
            : "rounded-full bg-[#eef1f5] text-slate-800 focus:bg-white"
        }`}
        disabled={isSending || isApplying}
      />
      <button
        type="submit"
        disabled={isSending || isApplying || !draft.trim()}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-white transition hover:bg-[var(--primary-strong)]"
        aria-label="Enviar instruccion al copiloto"
      >
        <SendHorizonal className="h-4 w-4" />
      </button>
    </form>
  );

  if (isEmptyState) {
    return (
      <div className="chat-app-layout flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] border border-[color-mix(in_srgb,var(--primary)_20%,white)] bg-[linear-gradient(160deg,color-mix(in_srgb,var(--primary)_8%,white)_0%,white_60%)] p-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_0_0_1px_rgba(226,232,240,0.92),0_4px_10px_rgba(15,23,42,0.06),0_18px_38px_-18px_rgba(15,23,42,0.16)]">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6 pb-8">
          <style>{`@keyframes copilot-float{0%,100%{transform:translateY(0);}50%{transform:translateY(-8px);}}`}</style>
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--primary)] shadow-[0_16px_40px_-16px_color-mix(in_srgb,var(--primary)_60%,black)]"
            style={{ animation: "copilot-float 3s ease-in-out infinite" }}
          >
            <Bot className="h-8 w-8 text-white" />
          </div>

          <div className="space-y-1 text-center">
            <h2 className="text-xl font-semibold text-slate-900">¿En qué piensas hoy?</h2>
            <p className="text-sm text-slate-400">Dime qué quieres mejorar en tu agente</p>
          </div>

          <div className="w-full max-w-md">
            {composerForm}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-app-layout flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] border border-[rgba(203,213,225,0.88)] bg-white p-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),inset_0_0_0_1px_rgba(255,255,255,0.55),0_0_0_1px_rgba(226,232,240,0.92),0_4px_10px_rgba(15,23,42,0.06),0_18px_38px_-18px_rgba(15,23,42,0.16)]">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-white px-4 pb-[calc(env(safe-area-inset-bottom)+7rem)] pt-5 sm:px-5 sm:pb-[calc(env(safe-area-inset-bottom)+7.2rem)] md:pb-5">
          {messages.map((message) => (
            <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[82%] rounded-[22px] px-4 py-2.5 text-sm leading-6 shadow-[0_10px_22px_-22px_rgba(15,23,42,0.14)] ${
                  message.role === "user"
                    ? "rounded-br-[8px] bg-[linear-gradient(180deg,#3b5bfd_0%,#2c4df5_100%)] text-white"
                    : "rounded-bl-[8px] border border-[rgba(148,163,184,0.1)] bg-[#f3f5f8] text-slate-800"
                }`}
              >
                {message.content}
              </div>
            </div>
          ))}

          {isSending ? (
            <div className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(148,163,184,0.1)] bg-[#f3f5f8] px-3.5 py-2 text-sm text-slate-500">
                <Sparkles className="h-4 w-4 animate-pulse text-[var(--primary)]" />
                Pensando cambios...
              </div>
            </div>
          ) : null}

          {pendingSuggestion ? (
            <div className="rounded-[24px] border border-[rgba(59,91,253,0.12)] bg-[#f8faff] px-4 py-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--primary)]">
                Sugerencia lista para aplicar
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {pendingSuggestion.changeSummary.map((item) => (
                  <span
                    key={item}
                    className="inline-flex rounded-full border border-[rgba(148,163,184,0.14)] bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700"
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
                  className="inline-flex h-11 items-center justify-center rounded-2xl border border-[rgba(148,163,184,0.16)] bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Descartar sugerencia
                </button>
              </div>
            </div>
          ) : null}

          <ChatScrollAnchor dependencyKey={scrollDependencyKey} />
        </div>

        <div className="chat-composer sticky bottom-[calc(env(safe-area-inset-bottom)+5.95rem)] z-20 shrink-0 border-t border-[rgba(148,163,184,0.1)] bg-white px-4 pb-3 pt-3 sm:px-5 md:static md:border-t md:pb-4">
          {feedback ? (
            <div className="mb-3 rounded-[18px] bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{feedback}</div>
          ) : null}
          {composerForm}
        </div>
      </div>
    </div>
  );
}
