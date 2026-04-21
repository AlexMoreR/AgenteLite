"use client";

import { useState, useRef, useEffect, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Wallet,
  RefreshCw,
  Trash2,
  SendHorizonal,
  Settings,
  X,
  Sheet,
  Bot,
} from "lucide-react";
import {
  deleteTransactionAction,
  connectGoogleSheetAction,
  syncGoogleSheetAction,
  sendFinanceMessageAction,
  saveAgentPromptAction,
  clearChatHistoryAction,
} from "@/app/actions/finanzas-actions";
import { DEFAULT_FINANCE_SYSTEM_PROMPT } from "@/features/finanzas/constants";
import { formatCompactMoney, formatMoney } from "@/lib/currency";
import type { FinanzasData, FinanceTransaction, FinanceChatMessage } from "../types";

type ChatEvent =
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "userTransaction"; transaction: FinanceTransaction }
  | { id: string; kind: "transaction"; transaction: FinanceTransaction };

type LLMMessage = { role: "user" | "assistant"; content: string };
type SummaryCardKey = "income" | "expense" | "balance";

function formatDateLabel(isoDate: string): string {
  const d = new Date(isoDate);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const txDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.floor((today.getTime() - txDay.getTime()) / 86_400_000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  if (diff < 7) return `Hace ${diff} dias`;
  return d.toLocaleDateString("es-CO", { day: "numeric", month: "long" });
}

function formatTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

function isSameCalendarDay(left: string, right: string): boolean {
  const a = new Date(left);
  const b = new Date(right);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildInitialChatEvents(
  transactions: FinanceTransaction[],
  chatMessages: FinanceChatMessage[],
): ChatEvent[] {
  const intro: ChatEvent = {
    id: "assistant-welcome",
    kind: "assistant",
    text: "Hola, soy tu asistente de finanzas con IA. Puedes decirme tus gastos e ingresos en lenguaje natural, pedirme que elimine alguno o hacerme preguntas sobre tus movimientos.",
  };

  type Timed = { time: number; event: ChatEvent };

  const txItems: Timed[] = transactions.map((t) => ({
    time: new Date(t.date).getTime(),
    event:
      t.source === "manual"
        ? ({ id: `user-tx-${t.id}`, kind: "userTransaction", transaction: t } as ChatEvent)
        : ({ id: `tx-${t.id}`, kind: "transaction", transaction: t } as ChatEvent),
  }));

  const msgItems: Timed[] = chatMessages.map((m) => ({
    time: new Date(m.createdAt).getTime(),
    event: { id: `msg-${m.id}`, kind: m.role, text: m.content } as ChatEvent,
  }));

  const sorted = [...txItems, ...msgItems].sort((a, b) => a.time - b.time).map((x) => x.event);

  return [intro, ...sorted];
}

// ── Settings dialog ──────────────────────────────────────────────────────────

type SettingsDialogProps = {
  googleSheet: FinanzasData["googleSheet"];
  serviceAccountEmail: string | null;
  agentPrompt: string | null;
  onClose: () => void;
  onSynced: () => void;
  onChatCleared: () => void;
};

function SettingsDialog({
  googleSheet,
  serviceAccountEmail,
  agentPrompt,
  onClose,
  onSynced,
  onChatCleared,
}: SettingsDialogProps) {
  const [tab, setTab] = useState<"sheet" | "agent">("sheet");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-slate-100 bg-[linear-gradient(135deg,#f8fbff_0%,#eef4ff_100%)] px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-[var(--primary)] shadow-sm ring-1 ring-[color:rgba(37,99,235,0.12)]">
                <Settings className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">Configuración</h2>
                <p className="text-xs text-slate-500">Finanzas · Asistente de IA</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-white hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="mt-3 flex gap-1">
            <button
              onClick={() => setTab("sheet")}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                tab === "sheet"
                  ? "bg-[var(--primary)] text-white"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              }`}
            >
              <Sheet className="h-3.5 w-3.5" />
              Google Sheets
            </button>
            <button
              onClick={() => setTab("agent")}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                tab === "agent"
                  ? "bg-[var(--primary)] text-white"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              }`}
            >
              <Bot className="h-3.5 w-3.5" />
              Prompt del agente
            </button>
          </div>
        </div>

        {tab === "sheet" && (
          <SheetTab
            googleSheet={googleSheet}
            serviceAccountEmail={serviceAccountEmail}
            onClose={onClose}
            onSynced={onSynced}
          />
        )}
        {tab === "agent" && (
          <AgentPromptTab agentPrompt={agentPrompt} onClose={onClose} onCleared={onChatCleared} />
        )}
      </div>
    </div>
  );
}

// ── Sheet tab ────────────────────────────────────────────────────────────────

function SheetTab({
  googleSheet,
  serviceAccountEmail,
  onClose,
  onSynced,
}: Omit<SettingsDialogProps, "agentPrompt" | "onChatCleared">) {
  const [url, setUrl] = useState(googleSheet?.sheetUrl ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [syncCount, setSyncCount] = useState<number | null>(null);
  const [headersCreated, setHeadersCreated] = useState(false);
  const [step, setStep] = useState<"url" | "share">(googleSheet ? "share" : "url");

  function handleConnect() {
    setError(null);
    const fd = new FormData();
    fd.append("sheetUrl", url);
    startTransition(async () => {
      const result = await connectGoogleSheetAction(fd);
      if (!result.ok) { setError(result.error); return; }
      onSynced();
      if (serviceAccountEmail) setStep("share");
      else onClose();
    });
  }

  function handleSync() {
    setError(null);
    setSyncCount(null);
    setHeadersCreated(false);
    startTransition(async () => {
      const result = await syncGoogleSheetAction();
      if (!result.ok) { setError(result.error); return; }
      if (result.headersJustCreated) {
        setHeadersCreated(true);
      } else {
        setSyncCount(result.count ?? 0);
      }
      onSynced();
    });
  }

  return (
    <div className="space-y-4 px-5 py-5 sm:px-6 sm:py-6">
      {step === "url" && (
        <>
          <div className="rounded-2xl border border-[color:rgba(37,99,235,0.14)] bg-[color:rgba(239,246,255,0.72)] p-4 text-sm text-slate-700">
            <p className="font-medium text-slate-900">Formato automático</p>
            <p className="mt-1 leading-6">
              Al sincronizar se crean las columnas TIPO, MONTO, DESCRIPCION, CATEGORIA, FECHA y HORA.
            </p>
          </div>
          <label className="block text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
            Link
          </label>
          <input
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(null); }}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[var(--primary)] focus:bg-white focus:outline-none"
          />
        </>
      )}

      {step === "share" && serviceAccountEmail && (
        <>
          <div className="rounded-2xl border border-[color:rgba(37,99,235,0.14)] bg-[color:rgba(239,246,255,0.78)] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--primary-strong)]">
              Editor requerido
            </p>
            <div
              className="mt-3 cursor-pointer rounded-2xl border border-[color:rgba(37,99,235,0.18)] bg-white px-3 py-3 font-mono text-[11px] text-slate-700 shadow-sm transition hover:border-[var(--primary)]"
              onClick={() => navigator.clipboard.writeText(serviceAccountEmail)}
              title="Clic para copiar"
            >
              {serviceAccountEmail}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Paso 1</p>
              <p className="mt-2 text-sm text-slate-700">Comparte la hoja como editor.</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Paso 2</p>
              <p className="mt-2 text-sm text-slate-700">Sincroniza para importar o actualizar.</p>
            </div>
          </div>
          {googleSheet?.lastSyncAt && (
            <p className="text-xs text-slate-400">
              Última sync: {new Date(googleSheet.lastSyncAt).toLocaleString("es-CO")}
            </p>
          )}
        </>
      )}

      {step === "share" && !serviceAccountEmail && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">La hoja debe ser pública</p>
          <p className="mt-1 leading-6">
            Compártela como lector y usa encabezados de tipo, monto, descripción y categoría.
          </p>
        </div>
      )}

      {error && <p className="rounded-2xl bg-rose-50 px-3 py-3 text-xs text-rose-600">{error}</p>}
      {headersCreated && (
        <div className="rounded-2xl bg-[var(--info-bg)] px-3 py-3 text-xs text-[var(--info-fg)]">
          Columnas creadas. Agrega datos y vuelve a sincronizar.
        </div>
      )}
      {syncCount !== null && !headersCreated && (
        <p className="rounded-2xl bg-[var(--info-bg)] px-3 py-3 text-xs text-[var(--info-fg)]">
          {syncCount} transacciones importadas.
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <button
          onClick={onClose}
          className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          {step === "share" ? "Cerrar" : "Cancelar"}
        </button>
        {step === "url" && (
          <button
            onClick={handleConnect}
            disabled={isPending || !url.trim()}
            className="flex-1 rounded-2xl bg-[var(--primary)] px-4 py-3 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)] disabled:opacity-50"
          >
            {isPending ? "Conectando..." : "Conectar"}
          </button>
        )}
        {step === "share" && (
          <button
            onClick={handleSync}
            disabled={isPending}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[var(--primary)] px-4 py-3 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
            {isPending ? "Sincronizando..." : "Sincronizar"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Agent prompt tab ─────────────────────────────────────────────────────────

function AgentPromptTab({
  agentPrompt,
  onClose,
  onCleared,
}: {
  agentPrompt: string | null;
  onClose: () => void;
  onCleared: () => void;
}) {
  const [prompt, setPrompt] = useState(agentPrompt ?? DEFAULT_FINANCE_SYSTEM_PROMPT);
  const [isPending, startTransition] = useTransition();
  const [isClearPending, startClearTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveAgentPromptAction(prompt.trim() || DEFAULT_FINANCE_SYSTEM_PROMPT);
      if (!result.ok) { setError(result.error); return; }
      setSaved(true);
    });
  }

  function handleReset() {
    setPrompt(DEFAULT_FINANCE_SYSTEM_PROMPT);
    setSaved(false);
  }

  function handleClearChat() {
    setError(null);
    setCleared(false);
    startClearTransition(async () => {
      const result = await clearChatHistoryAction();
      if (!result.ok) { setError(result.error); return; }
      setCleared(true);
      onCleared();
    });
  }

  return (
    <div className="space-y-4 px-5 py-5 sm:px-6 sm:py-6">
      <textarea
        value={prompt}
        onChange={(e) => { setPrompt(e.target.value); setSaved(false); }}
        rows={8}
        className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:outline-none"
        placeholder="Escribe el prompt del sistema..."
      />

      {error && <p className="rounded-2xl bg-rose-50 px-3 py-3 text-xs text-rose-600">{error}</p>}
      {saved && <p className="rounded-2xl bg-emerald-50 px-3 py-3 text-xs text-emerald-700">Prompt guardado.</p>}
      {cleared && <p className="rounded-2xl bg-emerald-50 px-3 py-3 text-xs text-emerald-700">Historial limpiado. El agente comienza con contexto fresco.</p>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <button
          onClick={handleReset}
          className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          Predeterminado
        </button>
        <button
          onClick={handleSave}
          disabled={isPending}
          className="flex-1 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? "Guardando..." : "Guardar"}
        </button>
      </div>

      <div className="border-t border-slate-100 pt-3">
        <p className="mb-2 text-xs text-slate-400">Zona peligrosa</p>
        <button
          onClick={handleClearChat}
          disabled={isClearPending}
          className="w-full rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-600 transition hover:bg-rose-100 disabled:opacity-50"
        >
          {isClearPending ? "Limpiando..." : "Limpiar historial del chat"}
        </button>
      </div>

      <button
        onClick={onClose}
        className="w-full rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-50"
      >
        Cerrar
      </button>
    </div>
  );
}

// ── Main workspace ───────────────────────────────────────────────────────────

export function FinanzasWorkspace({
  transactions: initialTransactions,
  chatMessages: initialChatMessages,
  googleSheet,
  serviceAccountEmail,
  currency,
  agentPrompt,
}: FinanzasData) {
  const [transactions, setTransactions] = useState<FinanceTransaction[]>(initialTransactions);
  const [chatEvents, setChatEvents] = useState<ChatEvent[]>(() =>
    buildInitialChatEvents(initialTransactions, initialChatMessages),
  );
  const llmHistoryRef = useRef<LLMMessage[]>(
    initialChatMessages.slice(-40).map((m) => ({ role: m.role, content: m.content })),
  );
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedSummaryCard, setExpandedSummaryCard] = useState<SummaryCardKey | null>(null);
  const [isPending, startTransition] = useTransition();
  const feedRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const isBusy = isPending || isThinking;

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;

    const frame = window.requestAnimationFrame(() => {
      feed.scrollTop = feed.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [chatEvents.length, isThinking]);

  const summary = useMemo(() => {
    const income = transactions.filter((t) => t.type === "INCOME").reduce((s, t) => s + t.amount, 0);
    const expense = transactions.filter((t) => t.type === "EXPENSE").reduce((s, t) => s + t.amount, 0);
    return { income, expense, balance: income - expense };
  }, [transactions]);

  function getSummaryValue(key: SummaryCardKey, value: number) {
    return expandedSummaryCard === key ? formatMoney(value, currency) : formatCompactMoney(value, currency);
  }

  function handleSummaryCardClick(key: SummaryCardKey) {
    setExpandedSummaryCard((current) => (current === key ? null : key));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || isBusy) return;
    setInput("");

    setChatEvents((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, kind: "user", text: message },
    ]);
    setIsThinking(true);

    try {
      const result = await sendFinanceMessageAction(message, llmHistoryRef.current.slice(-20));

      if (!result.ok) {
        setChatEvents((prev) => [
          ...prev,
          { id: `assistant-${Date.now()}`, kind: "assistant", text: result.error },
        ]);
        return;
      }

      const { reply, addedTransactions, deletedIds } = result;

      llmHistoryRef.current = [
        ...llmHistoryRef.current,
        { role: "user", content: message },
        { role: "assistant", content: reply },
      ];

      const newEvents: ChatEvent[] = [];

      for (const tx of addedTransactions) {
        setTransactions((prev) => [...prev, tx]);
        newEvents.push({ id: `user-tx-${tx.id}`, kind: "userTransaction", transaction: tx });
      }

      if (deletedIds.length) {
        setTransactions((prev) => prev.filter((t) => !deletedIds.includes(t.id)));
        setChatEvents((prev) =>
          prev.filter((ev) => {
            if (ev.kind === "transaction" || ev.kind === "userTransaction") {
              return !deletedIds.includes(ev.transaction.id);
            }
            return true;
          }),
        );
      }

      newEvents.push({ id: `assistant-${Date.now()}`, kind: "assistant", text: reply });
      setChatEvents((prev) => [...prev, ...newEvents]);
    } finally {
      setIsThinking(false);
    }
  }

  function handleDelete(id: string) {
    if (id.startsWith("temp-")) return;
    setTransactions((prev) => prev.filter((t) => t.id !== id));
    setChatEvents((prev) =>
      prev.filter((ev) => {
        if (ev.kind === "transaction" || ev.kind === "userTransaction") {
          return ev.transaction.id !== id;
        }
        return true;
      }),
    );
    startTransition(async () => { await deleteTransactionAction(id); });
  }

  return (
    <div className="chat-app-layout flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--background)]">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-0 py-0 md:px-2 md:py-2 lg:px-3">
        <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col">
          <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-none border-0 bg-white text-slate-900 shadow-none md:rounded-[22px] md:border md:border-[rgba(203,213,225,0.88)] md:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),inset_0_0_0_1px_rgba(255,255,255,0.55),0_0_0_1px_rgba(226,232,240,0.92),0_4px_10px_rgba(15,23,42,0.06),0_18px_38px_-18px_rgba(15,23,42,0.16)]">

            {/* Summary bar */}
            <div className="z-10 border-b border-[rgba(148,163,184,0.08)] bg-white px-3 py-2 sm:px-4 sm:py-2 md:shadow-[0_1px_0_rgba(226,232,240,0.85),0_8px_10px_-12px_rgba(15,23,42,0.08)]">
              <div className="relative flex items-center justify-center">
                <div className="grid w-full grid-cols-3 gap-1.5 px-9 sm:hidden">
                  <button
                    type="button"
                    onClick={() => handleSummaryCardClick("income")}
                    className="min-w-0 rounded-2xl border border-emerald-200/55 bg-emerald-50 px-2 py-1.5 text-center transition active:scale-[0.99]"
                    aria-label={`Mostrar ${expandedSummaryCard === "income" ? "valor corto" : "valor completo"} de ingresos`}
                    title={formatMoney(summary.income, currency)}
                  >
                    <div className="min-w-0 text-center">
                      <p className="text-center text-[9px] font-medium uppercase tracking-[0.14em] text-emerald-600/80">
                        Ingresos
                      </p>
                      <p className="mt-0.5 text-center text-[10px] font-semibold leading-tight tracking-[-0.02em] text-emerald-700">
                        {getSummaryValue("income", summary.income)}
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSummaryCardClick("expense")}
                    className="min-w-0 rounded-2xl border border-rose-200/65 bg-rose-50 px-2 py-1.5 text-center transition active:scale-[0.99]"
                    aria-label={`Mostrar ${expandedSummaryCard === "expense" ? "valor corto" : "valor completo"} de gastos`}
                    title={formatMoney(summary.expense, currency)}
                  >
                    <div className="min-w-0 text-center">
                      <p className="text-center text-[9px] font-medium uppercase tracking-[0.14em] text-rose-600/80">
                        Gastos
                      </p>
                      <p className="mt-0.5 text-center text-[10px] font-semibold leading-tight tracking-[-0.02em] text-rose-700">
                        {getSummaryValue("expense", summary.expense)}
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSummaryCardClick("balance")}
                    className={`min-w-0 rounded-2xl border px-2 py-1.5 ${
                      summary.balance >= 0
                        ? "border-[color:color-mix(in_srgb,var(--primary)_18%,white)] bg-[color:color-mix(in_srgb,var(--primary)_7%,white)]"
                        : "border-rose-200/70 bg-rose-50"
                    }`}
                    aria-label={`Mostrar ${expandedSummaryCard === "balance" ? "valor corto" : "valor completo"} del balance`}
                    title={formatMoney(summary.balance, currency)}
                  >
                    <div className="min-w-0 text-center">
                      <p className="text-center text-[9px] font-medium uppercase tracking-[0.14em] text-slate-500">
                        Balance
                      </p>
                      <p className={`mt-0.5 text-center text-[10px] font-semibold leading-tight tracking-[-0.02em] ${summary.balance >= 0 ? "text-[var(--primary)]" : "text-rose-700"}`}>
                        {getSummaryValue("balance", summary.balance)}
                      </p>
                    </div>
                  </button>
                </div>

                <div className="hidden flex-wrap justify-center gap-1 px-9 sm:flex sm:gap-2 sm:pl-0 sm:pr-10">
                  <div className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-emerald-200/65 bg-emerald-50 px-2.5 py-1 sm:gap-2 sm:px-3.5 sm:py-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 sm:h-7 sm:w-7">
                      <TrendingUp className="h-3 w-3 text-emerald-600 sm:h-4 sm:w-4" />
                    </span>
                    <p className="truncate text-[12px] font-semibold text-emerald-700 sm:text-[15px]">
                      {formatMoney(summary.income, currency)}
                    </p>
                  </div>

                  <div className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-rose-200/65 bg-rose-50 px-2.5 py-1 sm:gap-2 sm:px-3.5 sm:py-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-100 sm:h-7 sm:w-7">
                      <TrendingDown className="h-3 w-3 text-rose-600 sm:h-4 sm:w-4" />
                    </span>
                    <p className="truncate text-[12px] font-semibold text-rose-700 sm:text-[15px]">
                      {formatMoney(summary.expense, currency)}
                    </p>
                  </div>

                  <div
                    className={`inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-1 sm:gap-2 sm:px-3.5 sm:py-2 md:backdrop-blur-md ${
                      summary.balance >= 0
                        ? "border-[color:color-mix(in_srgb,var(--primary)_18%,white)] bg-[color:color-mix(in_srgb,var(--primary)_7%,white)]"
                        : "border-rose-200/65 bg-rose-50"
                    }`}
                  >
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full sm:h-7 sm:w-7 ${summary.balance >= 0 ? "bg-[color:color-mix(in_srgb,var(--primary)_12%,white)]" : "bg-rose-100"}`}>
                      <Wallet className={`h-3 w-3 sm:h-4 sm:w-4 ${summary.balance >= 0 ? "text-[var(--primary)]" : "text-rose-600"}`} />
                    </span>
                    <p className={`truncate text-[12px] font-semibold sm:text-[15px] ${summary.balance >= 0 ? "text-[var(--primary)]" : "text-rose-700"}`}>
                      {formatMoney(summary.balance, currency)}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => router.push("/cliente/finanzas")}
                  className="absolute left-0 top-1/2 flex h-7 w-7 -translate-y-1/2 shrink-0 items-center justify-center rounded-full border border-[rgba(148,163,184,0.14)] bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 sm:h-8 sm:w-8 md:hidden"
                  title="Volver"
                  aria-label="Volver a finanzas"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={() => setShowSettings(true)}
                  className="absolute right-0 top-1/2 flex h-7 w-7 -translate-y-1/2 shrink-0 items-center justify-center rounded-full border border-[rgba(148,163,184,0.14)] bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 sm:h-8 sm:w-8"
                  title="Configuración"
                >
                  <Settings className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Chat feed */}
            <div
              ref={feedRef}
              className="min-h-0 overflow-y-auto bg-[linear-gradient(180deg,#fbfcff_0%,#f8fafc_100%)] px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+6.4rem)] sm:px-5 sm:py-5 sm:pb-5 md:bg-white md:pb-5 md:[-webkit-overflow-scrolling:touch] md:[scrollbar-width:thin] md:[scrollbar-color:rgba(148,163,184,0.26)_transparent] md:[&::-webkit-scrollbar]:w-1.5 md:[&::-webkit-scrollbar-track]:bg-transparent md:[&::-webkit-scrollbar-thumb]:rounded-full md:[&::-webkit-scrollbar-thumb]:bg-slate-300 md:[&::-webkit-scrollbar-thumb:hover]:bg-slate-400"
            >
              {chatEvents.length <= 1 && transactions.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-4 py-16 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-[24px] bg-[color:color-mix(in_srgb,var(--primary)_8%,white)] text-[var(--primary)]">
                    <Wallet className="h-8 w-8" />
                  </div>
                  <p className="mt-4 text-base font-semibold text-slate-900">Sin movimientos todavia</p>
                  <p className="mt-1 max-w-xs text-sm text-slate-500">
                    Escribeme un gasto o ingreso y lo registro automaticamente.
                  </p>
                </div>
              ) : (
                <div className="flex min-h-full flex-col justify-end gap-3.5 sm:gap-3">
                  {chatEvents.map((event, index) => {
                    if (event.kind === "user") {
                      return (
                        <div key={event.id} className="flex justify-end">
                          <div className="max-w-[78%] rounded-[22px] rounded-br-[10px] bg-[linear-gradient(180deg,#3b5bfd_0%,#2c4df5_100%)] px-3.5 py-3 text-[13.5px] font-medium leading-5 text-white shadow-[0_14px_28px_-24px_rgba(44,77,245,0.55)] [overflow-wrap:anywhere] sm:max-w-[72%] sm:px-4 sm:py-2.5 sm:text-[15px] md:shadow-[0_10px_22px_-22px_rgba(15,23,42,0.14)] lg:max-w-[62%]">
                            {event.text}
                          </div>
                        </div>
                      );
                    }

                    if (event.kind === "assistant") {
                      return (
                        <div key={event.id} className="flex justify-start">
                          <div className="max-w-[82%] rounded-[22px] rounded-bl-[10px] border border-[rgba(148,163,184,0.12)] bg-white px-3.5 py-3 text-[13.5px] leading-5 text-slate-700 shadow-[0_16px_30px_-28px_rgba(15,23,42,0.28)] [overflow-wrap:anywhere] sm:max-w-[72%] sm:px-4 sm:py-2.5 sm:text-[15px] md:bg-[#f3f5f8] md:shadow-[0_10px_22px_-22px_rgba(15,23,42,0.14)] lg:max-w-[62%]">
                            {event.text}
                          </div>
                        </div>
                      );
                    }

                    const t = event.transaction;
                    const isUserTransaction = event.kind === "userTransaction";
                    const previousTransaction = [...chatEvents]
                      .slice(0, index)
                      .reverse()
                      .find(
                        (prev): prev is Extract<ChatEvent, { kind: "transaction" | "userTransaction" }> =>
                          prev.kind === "transaction" || prev.kind === "userTransaction",
                      );
                    const showDateDivider =
                      !previousTransaction ||
                      !isSameCalendarDay(previousTransaction.transaction.date, t.date);

                    return (
                      <div key={event.id} className="space-y-1">
                        {showDateDivider && (
                          <div className="flex items-center gap-3 px-1">
                            <div className="h-px flex-1 bg-slate-200 md:shadow-[0_1px_2px_rgba(15,23,42,0.08)]" />
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
                              {formatDateLabel(t.date)}
                            </span>
                            <div className="h-px flex-1 bg-slate-200 md:shadow-[0_1px_2px_rgba(15,23,42,0.08)]" />
                          </div>
                        )}
                        <div className={`flex ${isUserTransaction ? "justify-end" : "justify-start"}`}>
                          <article
                            className={`rounded-[24px] border px-3.5 py-3.5 shadow-[0_18px_30px_-30px_rgba(15,23,42,0.2)] sm:px-4 sm:py-3 md:shadow-[0_10px_22px_-22px_rgba(15,23,42,0.14)] ${
                              isUserTransaction
                                ? "max-w-[82%] rounded-br-[10px] border-[rgba(59,91,253,0.12)] bg-[color:color-mix(in_srgb,var(--primary)_6%,white)] sm:max-w-[72%] lg:max-w-[62%]"
                                : t.type === "INCOME"
                                  ? "max-w-[82%] rounded-bl-[10px] border-emerald-200/70 bg-emerald-50 sm:max-w-[72%] lg:max-w-[62%]"
                                  : "max-w-[82%] rounded-bl-[10px] border-rose-200/65 bg-rose-50 sm:max-w-[72%] lg:max-w-[62%]"
                            }`}
                          >
                            <div className="flex items-start gap-2.5">
                              <div
                                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[14px] ${
                                  t.type === "INCOME"
                                    ? "bg-emerald-100 text-emerald-600"
                                    : "bg-rose-100 text-rose-600"
                                }`}
                              >
                                {t.type === "INCOME" ? (
                                  <TrendingUp className="h-3.5 w-3.5" />
                                ) : (
                                  <TrendingDown className="h-3.5 w-3.5" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <p className="text-[14px] leading-5 text-slate-900 [overflow-wrap:anywhere] sm:text-[15px]">
                                        {t.description}
                                      </p>
                                      {t.source === "google_sheet" && (
                                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 ring-1 ring-slate-200">
                                          Sheet
                                        </span>
                                      )}
                                      {t.category && (
                                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200">
                                          {t.category}
                                        </span>
                                      )}
                                    </div>
                                    <p className="mt-0.5 text-[11px] text-slate-500">{formatTime(t.date)}</p>
                                  </div>
                                  <div className="flex items-center justify-between gap-2 sm:justify-end">
                                     <p
                                       className={`text-right text-[15px] font-semibold tracking-[-0.02em] ${
                                         t.type === "INCOME" ? "text-emerald-700" : "text-rose-700"
                                       }`}
                                     >
                                      {t.type === "INCOME" ? "+" : "-"}
                                      {formatMoney(t.amount, currency)}
                                    </p>
                                    <button
                                      onClick={() => handleDelete(t.id)}
                                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-100 hover:text-rose-600"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </article>
                        </div>
                      </div>
                    );
                  })}

                  {isThinking && (
                    <div className="flex justify-start">
                      <div className="flex items-center gap-1.5 rounded-[22px] rounded-bl-[10px] border border-[rgba(148,163,184,0.1)] bg-white px-3.5 py-3 shadow-[0_16px_30px_-28px_rgba(15,23,42,0.28)] md:bg-[#f3f5f8] md:px-4">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
                      </div>
                    </div>
                  )}
                  <div ref={endRef} aria-hidden="true" className="h-2 w-full" />
                </div>
              )}
            </div>

            {/* Composer */}
            <div className="chat-composer fixed inset-x-0 bottom-0 z-20 shrink-0 border-t border-[rgba(148,163,184,0.08)] bg-white/98 px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2.5 shadow-[0_-12px_28px_-24px_rgba(15,23,42,0.2)] backdrop-blur md:static md:border-[rgba(148,163,184,0.1)] md:bg-white md:px-4 md:py-3 md:shadow-[0_-10px_18px_-18px_rgba(15,23,42,0.16)]">
              <form onSubmit={handleSubmit} className="mx-auto w-full max-w-7xl">
                <div className="flex items-end gap-2.5 md:gap-3.5">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (!isBusy && input.trim()) e.currentTarget.form?.requestSubmit();
                      }
                    }}
                    rows={1}
                    placeholder="Escribeme.."
                    className="flex min-h-[46px] flex-1 resize-none rounded-[22px] border border-[rgba(148,163,184,0.14)] bg-slate-50/85 px-3.5 py-3 text-[16px] leading-5 text-slate-800 placeholder:text-slate-500 outline-none transition focus:border-[var(--primary)] focus:bg-white focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_18%,white)] md:min-h-[44px] md:rounded-[24px] md:px-4.5 md:py-3"
                    disabled={isBusy}
                  />
                  <button
                    type="submit"
                    disabled={isBusy || !input.trim()}
                    className="inline-flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-[18px] bg-[var(--primary)] text-white transition hover:bg-[var(--primary-strong)] disabled:cursor-not-allowed disabled:bg-[color-mix(in_srgb,var(--primary)_40%,white)] disabled:text-white/90 md:h-11 md:w-11 md:rounded-[22px]"
                  >
                    <SendHorizonal className="h-4.5 w-4.5 text-white md:h-5 md:w-5" />
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>

      {showSettings && (
        <SettingsDialog
          googleSheet={googleSheet}
          serviceAccountEmail={serviceAccountEmail}
          agentPrompt={agentPrompt}
          onClose={() => setShowSettings(false)}
          onSynced={() => router.refresh()}
          onChatCleared={() => {
            llmHistoryRef.current = [];
            setChatEvents(buildInitialChatEvents(transactions, []));
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}
