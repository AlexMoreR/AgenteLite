"use client";

import Link from "next/link";
import { startTransition, useMemo, useState } from "react";
import { Bot, RotateCcw, SendHorizonal, Settings2, UserRound } from "lucide-react";
import { simulateAgentReplyAction } from "@/app/actions/agent-actions";

type PlaygroundMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  media?: Array<{
    type: "IMAGE";
    url: string;
    caption: string | null;
  }>;
};

type AgentPlaygroundProps = {
  agentId: string;
  agentName: string;
};

function renderWhatsAppText(content: string) {
  const parts = content.split(/(\*[^*\n]+\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return (
        <strong key={`${part}-${index}`} className="font-semibold">
          {part.slice(1, -1)}
        </strong>
      );
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

export function AgentPlayground({ agentId, agentName }: AgentPlaygroundProps) {
  const [messages, setMessages] = useState<PlaygroundMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);

  const history = useMemo(
    () =>
      messages.map((message) => ({
        direction: message.role === "assistant" ? ("OUTBOUND" as const) : ("INBOUND" as const),
        content: message.content,
      })),
    [messages],
  );

  const handleReset = () => {
    setMessages([]);
    setDraft("");
    setError("");
  };

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed || isPending) {
      return;
    }

    const nextMessages = [...messages, { id: `user-${Date.now()}`, role: "user" as const, content: trimmed }];
    setMessages(nextMessages);
    setDraft("");
    setError("");
    setIsPending(true);

    startTransition(async () => {
      const result = await simulateAgentReplyAction({
        agentId,
        latestUserMessage: trimmed,
        history,
      });

      if (!result.ok) {
        setError(result.error);
        setIsPending(false);
        return;
      }

      setMessages((current) => [
        ...current,
        { id: `assistant-${Date.now()}`, role: "assistant", content: result.reply, media: result.media },
      ]);
      setIsPending(false);
    });
  };

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-1 flex-col md:min-h-0 md:gap-4">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[22px] border border-[rgba(148,163,184,0.14)] bg-[rgba(255,255,255,0.82)] shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)] md:rounded-[28px]">
        <div className="sticky top-0 z-10 border-b border-[rgba(148,163,184,0.12)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcff_100%)] px-4 py-3 backdrop-blur md:static md:px-5 md:py-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                <Bot className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-slate-950 md:text-sm">{agentName}</h2>
                <p className="text-xs text-slate-500">Simulacion</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center md:justify-end md:gap-3">
              <Link
                href={`/cliente/agentes/${agentId}/entrenamiento`}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-3 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)] md:px-4"
              >
                <Settings2 className="h-4 w-4" />
                Volver
              </Link>
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-[rgba(148,163,184,0.16)] bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 md:px-4"
              >
                <RotateCcw className="h-4 w-4" />
                Reiniciar
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-transparent px-3 py-3 pb-28 md:min-h-0 md:px-4 md:py-4 md:pb-4">
          <div className="space-y-3">
            {messages.length > 0 ? (
              messages.map((message) => {
                const outbound = message.role === "assistant";
                return (
                  <div key={message.id} className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[90%] rounded-[18px] px-4 py-3 text-sm leading-6 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.16)] md:max-w-[78%] ${
                        outbound
                          ? "bg-[var(--primary)] text-white"
                          : "border border-[rgba(148,163,184,0.12)] bg-white text-slate-800"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {outbound ? <Bot className="mt-0.5 h-4 w-4 shrink-0" /> : <UserRound className="mt-0.5 h-4 w-4 shrink-0" />}
                        <div className="space-y-2">
                          {message.media?.map((media, index) => (
                            <div key={`${media.url}-${index}`} className="overflow-hidden rounded-xl bg-white/10">
                              <img
                                src={media.url}
                                alt={media.caption?.trim() || "Imagen enviada por el agente"}
                                className="max-h-72 w-full rounded-xl object-cover"
                              />
                              {media.caption?.trim() && media.caption.trim() !== message.content.trim() ? (
                                <p className="px-1 pt-2 whitespace-pre-line">{renderWhatsAppText(media.caption)}</p>
                              ) : null}
                            </div>
                          ))}
                          {message.content.trim() ? (
                            <p className="whitespace-pre-line">{renderWhatsAppText(message.content)}</p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-[22px] border border-dashed border-[rgba(148,163,184,0.18)] bg-white/80 px-4 py-5 text-sm leading-6 text-slate-600 md:px-5 md:py-6">
                Escribe un mensaje para probar como responderia el agente desde cero.
              </div>
            )}

            {isPending ? (
              <div className="flex justify-end">
                <div className="rounded-[18px] bg-white px-4 py-3 text-sm text-slate-500 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.16)]">
                  Pensando respuesta...
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="sticky bottom-0 z-10 border-t border-[rgba(148,163,184,0.12)] bg-[rgba(255,255,255,0.88)] px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur md:static md:bg-[rgba(255,255,255,0.88)] md:px-3 md:py-3">
          {error ? <p className="px-2 pb-2 text-sm text-rose-600">{error}</p> : null}
          <div className="flex items-end gap-2 md:gap-3">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
              placeholder="Escribe un mensaje para probar el agente..."
              className="flex min-h-[52px] flex-1 resize-none rounded-2xl border border-[rgba(148,163,184,0.14)] bg-slate-50/80 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-[var(--primary)] focus:bg-white focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_18%,white)] md:min-h-[44px]"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={isPending || !draft.trim()}
              className="inline-flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-[var(--primary)] text-white transition hover:bg-[var(--primary-strong)] disabled:cursor-not-allowed disabled:opacity-55 md:h-11 md:w-11"
              aria-label="Probar mensaje"
            >
              <SendHorizonal className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
