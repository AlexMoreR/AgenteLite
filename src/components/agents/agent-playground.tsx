"use client";

import Link from "next/link";
import { startTransition, useMemo, useState } from "react";
import { Bot, RotateCcw, SendHorizonal, Settings2, UserRound } from "lucide-react";
import { simulateAgentReplyAction } from "@/app/actions/agent-actions";

type PlaygroundMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type AgentPlaygroundProps = {
  agentId: string;
  agentName: string;
  welcomeMessage: string | null;
};

export function AgentPlayground({ agentId, agentName, welcomeMessage }: AgentPlaygroundProps) {
  const [messages, setMessages] = useState<PlaygroundMessage[]>(
    welcomeMessage?.trim()
      ? [{ id: "welcome", role: "assistant", content: welcomeMessage.trim() }]
      : [],
  );
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
    setMessages(
      welcomeMessage?.trim()
        ? [{ id: "welcome", role: "assistant", content: welcomeMessage.trim() }]
        : [],
    );
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
        { id: `assistant-${Date.now()}`, role: "assistant", content: result.reply },
      ]);
      setIsPending(false);
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-[rgba(148,163,184,0.14)] bg-white shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)]">
        <div className="border-b border-[rgba(148,163,184,0.12)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcff_100%)] px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_12%,white)] text-[var(--primary)]">
                <Bot className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-slate-950">{agentName}</h2>
                <p className="text-xs text-slate-500">Simulacion</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Link
                href={`/cliente/agentes/${agentId}/entrenamiento`}
                className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[var(--primary)] px-4 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
              >
                <Settings2 className="h-4 w-4" />
                Volver
              </Link>
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[rgba(148,163,184,0.16)] bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <RotateCcw className="h-4 w-4" />
                Reiniciar
              </button>
            </div>
          </div>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
          style={{
            backgroundColor: "#f3f4f6",
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220' viewBox='0 0 220 220'%3E%3Cg fill='none' stroke='%23cbd5e1' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round' opacity='0.45'%3E%3Ccircle cx='28' cy='24' r='10'/%3E%3Cpath d='M62 18l8 14 14 2-10 10 2 14-14-7-12 7 2-14-10-10 14-2z'/%3E%3Cpath d='M122 18c10 0 18 8 18 18s-8 18-18 18-18-8-18-18 8-18 18-18z'/%3E%3Cpath d='M169 24l20 20M189 24l-20 20'/%3E%3Crect x='20' y='76' width='28' height='18' rx='6'/%3E%3Cpath d='M26 102c6-8 16-8 22 0'/%3E%3Cpath d='M76 74l10 18 20 3-14 14 3 20-19-10-18 10 3-20-14-14 20-3z'/%3E%3Cpath d='M130 78h28v18h-28z'/%3E%3Cpath d='M144 70v36M130 87h28'/%3E%3Cpath d='M176 76c10 0 18 8 18 18s-8 18-18 18-18-8-18-18 8-18 18-18z'/%3E%3Cpath d='M24 142c6-8 18-8 24 0 6 8 18 8 24 0'/%3E%3Cpath d='M86 144c0-8 6-14 14-14s14 6 14 14-6 14-14 14-14-6-14-14z'/%3E%3Cpath d='M128 136l24 24M152 136l-24 24'/%3E%3Cpath d='M174 132h26v26h-26z'/%3E%3Cpath d='M182 124v42M174 145h26'/%3E%3Ccircle cx='42' cy='188' r='16'/%3E%3Cpath d='M36 188h12M42 182v12'/%3E%3Cpath d='M92 180c8-10 22-10 30 0-8 10-22 10-30 0z'/%3E%3Cpath d='M140 180l12 12 18-18'/%3E%3Cpath d='M178 184c6-8 16-8 22 0'/%3E%3C/g%3E%3C/svg%3E\")",
            backgroundPosition: "center",
            backgroundSize: "220px 220px",
          }}
        >
          <div className="space-y-3">
            {messages.length > 0 ? (
              messages.map((message) => {
                const outbound = message.role === "assistant";
                return (
                  <div key={message.id} className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[78%] rounded-[18px] px-4 py-3 text-sm leading-6 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.16)] ${
                        outbound
                          ? "bg-[var(--primary)] text-white"
                          : "border border-[rgba(148,163,184,0.12)] bg-white text-slate-800"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {outbound ? <Bot className="mt-0.5 h-4 w-4 shrink-0" /> : <UserRound className="mt-0.5 h-4 w-4 shrink-0" />}
                        <p>{message.content}</p>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-[22px] border border-dashed border-[rgba(148,163,184,0.18)] bg-white/80 px-5 py-6 text-sm text-slate-600">
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

        <div className="border-t border-[rgba(148,163,184,0.12)] bg-white px-3 py-3">
          {error ? <p className="px-2 pb-2 text-sm text-rose-600">{error}</p> : null}
          <div className="flex items-center gap-3">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={1}
              placeholder="Escribe un mensaje para probar el agente..."
              className="flex h-11 min-h-0 flex-1 resize-none rounded-2xl border border-[rgba(148,163,184,0.14)] bg-slate-50/80 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-[var(--primary)] focus:bg-white focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_18%,white)]"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={isPending || !draft.trim()}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary)] text-white transition hover:bg-[var(--primary-strong)] disabled:cursor-not-allowed disabled:opacity-55"
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
