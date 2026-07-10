"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, SendHorizonal, Sparkles, X } from "lucide-react";

import { runHelpCopilotAction } from "@/app/actions/help-copilot-actions";
import { cn } from "@/lib/utils";

type ChatTurn = { id: string; role: "user" | "assistant"; content: string };

const STORAGE_KEY = "agente-lite-help-copilot";
const MAX_STORED_TURNS = 40;

const GREETING =
  "¡Hola! 👋 Soy tu asistente de AgenteLite. Pregúntame cómo hacer cualquier cosa en la aplicación y te explico paso a paso.";

const SUGGESTIONS = [
  "¿Cómo elimino un contacto?",
  "¿Cómo quito una conexión?",
  "¿Cómo le pongo una etiqueta a un chat?",
  "¿Cómo activo las notificaciones?",
];

let turnSequence = 0;
function nextId() {
  turnSequence += 1;
  return `help-${turnSequence}-${turnSequence * 31}`;
}

type HelpCopilotWidgetProps = {
  open: boolean;
  onClose: () => void;
};

export function HelpCopilotWidget({ open, onClose }: HelpCopilotWidgetProps) {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Carga el historial guardado (persiste entre recargas, en este dispositivo).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ChatTurn[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          return;
        }
      }
    } catch {
      // Ignorar historial corrupto.
    }
    setMessages([{ id: nextId(), role: "assistant", content: GREETING }]);
  }, []);

  // Guarda el historial (acotado) cada vez que cambia.
  useEffect(() => {
    if (messages.length === 0) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_STORED_TURNS)));
    } catch {
      // Ignorar errores de almacenamiento.
    }
  }, [messages]);

  // Auto-scroll al último mensaje.
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open, loading]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || loading) return;

    const userTurn: ChatTurn = { id: nextId(), role: "user", content: question };
    const history = messages
      .filter((turn) => turn.content !== GREETING)
      .map((turn) => ({ role: turn.role, content: turn.content }));

    setMessages((prev) => [...prev, userTurn]);
    setInput("");
    setLoading(true);

    try {
      const result = await runHelpCopilotAction({ message: question, history });
      const reply =
        result.ok && result.reply
          ? result.reply
          : (!result.ok && result.error) || "No pude responder. Inténtalo de nuevo.";
      setMessages((prev) => [...prev, { id: nextId(), role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "assistant", content: "Hubo un problema de conexión. Inténtalo de nuevo." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void send(input);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(input);
    }
  };

  const clearChat = () => {
    const fresh = [{ id: nextId(), role: "assistant" as const, content: GREETING }];
    setMessages(fresh);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    } catch {
      // Ignorar.
    }
  };

  const showSuggestions = messages.filter((turn) => turn.role === "user").length === 0;

  return (
    <>
      {/* Panel de chat (se abre desde el ícono de ayuda del encabezado) */}
      {open ? (
        <div
          className="fixed inset-x-0 bottom-0 z-50 flex h-[85dvh] flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:inset-x-auto sm:bottom-6 sm:right-6 sm:h-[560px] sm:w-[380px] sm:rounded-2xl"
          role="dialog"
          aria-label="Asistente de AgenteLite"
        >
          {/* Encabezado */}
          <div className="flex items-center justify-between gap-2 border-b border-border bg-primary px-4 py-3 text-primary-foreground">
            <div className="flex items-center gap-2">
              <Sparkles className="size-5" />
              <div className="leading-tight">
                <p className="text-sm font-semibold">Asistente de AgenteLite</p>
                <p className="text-[11px] opacity-80">Te ayudo a usar la app</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={clearChat}
                className="rounded-md px-2 py-1 text-[11px] font-medium opacity-90 hover:bg-white/15"
              >
                Limpiar
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar ayuda"
                className="rounded-md p-1 hover:bg-white/15"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>

          {/* Mensajes */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {messages.map((turn) => (
              <div
                key={turn.id}
                className={cn("flex", turn.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed",
                    turn.role === "user"
                      ? "rounded-br-sm bg-primary text-primary-foreground"
                      : "rounded-bl-sm bg-muted text-foreground",
                  )}
                >
                  {turn.content}
                </div>
              </div>
            ))}

            {loading ? (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Escribiendo…
                </div>
              </div>
            ) : null}

            {showSuggestions && !loading ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void send(suggestion)}
                    className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground transition hover:bg-muted"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Entrada */}
          <form onSubmit={handleSubmit} className="border-t border-border p-2">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="Escribe tu pregunta…"
                className="max-h-28 min-h-[40px] flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                aria-label="Enviar"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
              >
                <SendHorizonal className="size-5" />
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
