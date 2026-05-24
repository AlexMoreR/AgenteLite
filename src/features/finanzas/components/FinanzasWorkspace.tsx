"use client";

import { createPortal } from "react-dom";
import { useState, useRef, useEffect, useLayoutEffect, useTransition, useMemo } from "react";
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
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { FinanzasData, FinanceTransaction, FinanceChatMessage } from "../types";

type ChatEvent =
  | { id: string; kind: "assistant"; text: string; createdAt: string; timelineAt?: string }
  | { id: string; kind: "user"; text: string; createdAt: string; timelineAt?: string }
  | { id: string; kind: "userTransaction"; transaction: FinanceTransaction; timelineAt?: string }
  | { id: string; kind: "transaction"; transaction: FinanceTransaction; timelineAt?: string };

type LLMMessage = { role: "user" | "assistant"; content: string };
type SummaryCardKey = "income" | "expense" | "balance";

const CHAT_BACKGROUND_BASE_STYLE = {
  backgroundColor: "#eef2f7",
} as const;

const CHAT_BACKGROUND_OVERLAY_STYLE = {
  backgroundImage: 'url("https://static.whatsapp.net/rsrc.php/yx/r/voSdkk88H7C.svg")',
  backgroundRepeat: "repeat",
  backgroundSize: "540px 960px",
  backgroundPosition: "0 0",
  opacity: 0.08,
} as const;

const FINANCE_CONTEXT_PREFIX = "__FINANCE_CONTEXT__:";
const FINANCE_CHAT_HISTORY_PREFIX = "__FINANCE_CHAT_HISTORY__:";
const FINANCE_WELCOME_MESSAGE =
  "Hola, soy tu asistente de finanzas con IA. Puedes decirme tus gastos e ingresos en lenguaje natural, pedirme que elimine alguno o hacerme preguntas sobre tus movimientos.";

type PersistedChatMessage = Pick<FinanceChatMessage, "id" | "role" | "content" | "createdAt">;

function getFinanceChatStorageKey(workspaceId: string): string {
  return `${FINANCE_CHAT_HISTORY_PREFIX}${workspaceId}`;
}

function loadPersistedFinanceChatMessages(workspaceId: string): PersistedChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(getFinanceChatStorageKey(workspaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const candidate = item as Partial<PersistedChatMessage>;
        if (candidate.role !== "user" && candidate.role !== "assistant") return null;
        if (typeof candidate.content !== "string" || typeof candidate.createdAt !== "string") return null;
        if (candidate.id === "assistant-welcome" || candidate.content === FINANCE_WELCOME_MESSAGE) return null;
        return {
          id: typeof candidate.id === "string" ? candidate.id : `persisted-${candidate.role}-${candidate.createdAt}`,
          role: candidate.role,
          content: candidate.content,
          createdAt: candidate.createdAt,
        } satisfies PersistedChatMessage;
      })
      .filter((item): item is PersistedChatMessage => Boolean(item));
  } catch {
    return [];
  }
}

function savePersistedFinanceChatMessages(workspaceId: string, messages: PersistedChatMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getFinanceChatStorageKey(workspaceId), JSON.stringify(messages));
  } catch {
    // Ignore storage failures so chat keeps working.
  }
}

function clearPersistedFinanceChatMessages(workspaceId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(getFinanceChatStorageKey(workspaceId));
  } catch {
    // Ignore storage failures so chat keeps working.
  }
}

function mergeFinanceChatMessages(
  primary: FinanceChatMessage[],
  fallback: PersistedChatMessage[],
): FinanceChatMessage[] {
  const seen = new Set<string>();
  const merged: FinanceChatMessage[] = [];

  for (const message of [...primary, ...fallback]) {
    const key = `${message.role}|${message.content}|${message.createdAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(message);
  }

  return merged.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function formatDateLabel(isoDate: string): string {
  const d = new Date(isoDate);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const txDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.floor((today.getTime() - txDay.getTime()) / 86_400_000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  if (diff < 7) return `Hace ${diff} dias`;
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    day: "numeric",
    month: "long",
  }).format(d);
}

function formatTime(isoDate: string): string {
  const date = new Date(isoDate);
  const bogotaMillis = date.getTime() - 5 * 60 * 60 * 1000;
  const bogotaDate = new Date(bogotaMillis);
  const hour = String(bogotaDate.getUTCHours()).padStart(2, "0");
  const minute = String(bogotaDate.getUTCMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
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

function getChatEventTimestamp(event: ChatEvent): number {
  if (event.timelineAt) {
    return new Date(event.timelineAt).getTime();
  }

  if (event.kind === "transaction" || event.kind === "userTransaction") {
    return new Date(event.transaction.createdAt).getTime();
  }

  return new Date(event.createdAt).getTime();
}

function getChatEventPriority(event: ChatEvent): number {
  if (event.id === "assistant-welcome") return -1;
  if (event.kind === "user") return 0;
  if (event.kind === "assistant") return 1;
  if (event.kind === "userTransaction") return 2;
  if (event.kind === "transaction") return 3;
  return 3;
}

function sortChatEvents(events: ChatEvent[]): ChatEvent[] {
  return [...events].sort((a, b) => {
    const timeDiff = getChatEventTimestamp(a) - getChatEventTimestamp(b);
    if (timeDiff !== 0) return timeDiff;

    const priorityDiff = getChatEventPriority(a) - getChatEventPriority(b);
    if (priorityDiff !== 0) return priorityDiff;

    return a.id.localeCompare(b.id);
  });
}

function buildInitialChatEvents(
  transactions: FinanceTransaction[],
  chatMessages: FinanceChatMessage[],
  transactionAnchors: Record<string, string>,
): ChatEvent[] {
  const intro: ChatEvent = {
    id: "assistant-welcome",
    kind: "assistant",
    text: FINANCE_WELCOME_MESSAGE,
    createdAt: chatMessages[0]?.createdAt ?? transactions[0]?.createdAt ?? new Date(0).toISOString(),
    timelineAt: new Date(0).toISOString(),
  };

  type Timed = { time: number; event: ChatEvent };

  const txItems: Timed[] = transactions.map((t) => ({
    time: new Date(t.createdAt).getTime(),
    event:
      t.source === "manual"
        ? ({ id: `user-tx-${t.id}`, kind: "userTransaction", transaction: t, timelineAt: transactionAnchors[t.id] ?? t.createdAt } as ChatEvent)
        : ({ id: `tx-${t.id}`, kind: "transaction", transaction: t, timelineAt: transactionAnchors[t.id] ?? t.createdAt } as ChatEvent),
  }));

  const msgItems: Timed[] = chatMessages
    .filter((m) => !m.content.startsWith(FINANCE_CONTEXT_PREFIX))
    .map((m) => ({
      time: new Date(m.createdAt).getTime(),
      event: { id: `msg-${m.id}`, kind: m.role, text: m.content, createdAt: m.createdAt, timelineAt: m.createdAt } as ChatEvent,
    }));

  const orderedEvents = sortChatEvents([...txItems, ...msgItems].map((item) => item.event));

  return [intro, ...orderedEvents];
}

// ── Settings dialog ───────────────────────────────────────────────

type SettingsDialogProps = {
  googleSheet: FinanzasData["googleSheet"];
  serviceAccountEmail: string | null;
  agentPrompt: string | null;
  onClose: () => void;
  onSynced: () => void;
  onChatCleared: () => void;
  onSaved: () => void;
};

function SettingsDialog({
  googleSheet,
  serviceAccountEmail,
  agentPrompt,
  onClose,
  onSynced,
  onChatCleared,
  onSaved,
}: SettingsDialogProps) {
  const [tab, setTab] = useState<"sheet" | "agent">("sheet");
  const portalTarget = typeof document === "undefined" ? null : document.body;

  return portalTarget
    ? createPortal(
      <div
        className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:items-center sm:p-4"
      >
          <div
            className="w-full max-w-5xl overflow-hidden rounded-[18px] border border-white/70 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-100 bg-[linear-gradient(135deg,#f8fbff_0%,#eef4ff_100%)] px-2 py-2 sm:px-6">
              <div className="flex justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-900">Configuración</h2>
                <button
                  onClick={onClose}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-white hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <Tabs value={tab} onValueChange={(value) => setTab(value as "sheet" | "agent")} className="">
                <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
                  <TabsTrigger
                    value="sheet"
                    className="gap-1.5 data-[state=active]:bg-[var(--primary)] data-[state=active]:text-white data-[state=active]:shadow-[0_10px_24px_-18px_rgba(37,99,235,0.35)]"
                  >
                    <Sheet className="h-3.5 w-3.5" />
                    Google Sheets
                  </TabsTrigger>
                  <TabsTrigger
                    value="agent"
                    className="gap-1.5 data-[state=active]:bg-[var(--primary)] data-[state=active]:text-white data-[state=active]:shadow-[0_10px_24px_-18px_rgba(37,99,235,0.35)]"
                  >
                    <Bot className="h-3.5 w-3.5" />
                    Prompt del agente
                  </TabsTrigger>
                </TabsList>
              </Tabs>
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
              <AgentPromptTab
                agentPrompt={agentPrompt}
                onClose={onClose}
                onCleared={onChatCleared}
                onSaved={onSaved}
              />
            )}
          </div>
        </div>,
        portalTarget,
      )
    : null;
}

// ── Sheet tab ───────────────────────────────────────────────────

function SheetTab({
  googleSheet,
  serviceAccountEmail,
  onClose,
  onSynced,
}: Omit<SettingsDialogProps, "agentPrompt" | "onChatCleared" | "onSaved">) {
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
          <div className="rounded-lg border border-[color:rgba(37,99,235,0.14)] bg-[color:rgba(239,246,255,0.72)] p-4 text-sm text-slate-700">
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
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[var(--primary)] focus:bg-white focus:outline-none"
          />
        </>
      )}

      {step === "share" && serviceAccountEmail && (
        <>
          <div className="rounded-lg border border-[color:rgba(37,99,235,0.14)] bg-[color:rgba(239,246,255,0.78)] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--primary-strong)]">
              Editor requerido
            </p>
            <div
              className="mt-3 cursor-pointer rounded-lg border border-[color:rgba(37,99,235,0.18)] bg-white px-3 py-3 font-mono text-[11px] text-slate-700 shadow-sm transition hover:border-[var(--primary)]"
              onClick={() => navigator.clipboard.writeText(serviceAccountEmail)}
              title="Clic para copiar"
            >
              {serviceAccountEmail}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Paso 1</p>
              <p className="mt-2 text-sm text-slate-700">Comparte la hoja como editor.</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
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
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">La hoja debe ser pública</p>
          <p className="mt-1 leading-6">
            Compártela como lector y usa encabezados de tipo, monto, descripción y categoría.
          </p>
        </div>
      )}

      {error && <p className="rounded-lg bg-rose-50 px-3 py-3 text-xs text-rose-600">{error}</p>}
      {headersCreated && (
        <div className="rounded-lg bg-[var(--info-bg)] px-3 py-3 text-xs text-[var(--info-fg)]">
          Columnas creadas. Agrega datos y vuelve a sincronizar.
        </div>
      )}
      {syncCount !== null && !headersCreated && (
        <p className="rounded-lg bg-[var(--info-bg)] px-3 py-3 text-xs text-[var(--info-fg)]">
          {syncCount} transacciones importadas.
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button variant="outline" size="lg" onClick={onClose} className="flex-1">
          {step === "share" ? "Cerrar" : "Cancelar"}
        </Button>
        {step === "url" && (
          <Button
            variant="default"
            size="lg"
            onClick={handleConnect}
            disabled={isPending || !url.trim()}
            className="flex-1"
          >
            {isPending ? "Conectando..." : "Conectar"}
          </Button>
        )}
        {step === "share" && (
          <Button
            variant="default"
            size="lg"
            onClick={handleSync}
            disabled={isPending}
            className="flex-1"
          >
            <RefreshCw data-icon="inline-start" className={isPending ? "animate-spin" : ""} />
            {isPending ? "Sincronizando..." : "Sincronizar"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Agent prompt tab ─────────────────────────────────────────────

function AgentPromptTab({
  agentPrompt,
  onClose,
  onCleared,
  onSaved,
}: {
  agentPrompt: string | null;
  onClose: () => void;
  onCleared: () => void;
  onSaved: () => void;
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
      onSaved();
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
      <Textarea
        value={prompt}
        onChange={(e) => { setPrompt(e.target.value); setSaved(false); }}
        className="h-44 resize-y overflow-y-auto text-xs leading-4"
      />

      {error && <p className="rounded-2xl bg-rose-50 px-3 py-3 text-xs text-rose-600">{error}</p>}
        {saved && <p className="rounded-2xl bg-emerald-50 px-3 py-3 text-xs text-emerald-700">Prompt guardado.</p>}
      {cleared && <p className="rounded-2xl bg-emerald-50 px-3 py-3 text-xs text-emerald-700">Historial limpiado. El agente comienza con contexto fresco.</p>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <div className="flex-1 [&>button]:w-full">
          <Button onClick={handleReset}>Predeterminado</Button>
        </div>
        <div className="flex-1 [&>button]:w-full">
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </div>

      <div className="border-t border-slate-100 pt-3">
        <p className="mb-2 text-xs text-slate-400">Zona peligrosa</p>
        <div className="flex gap-2">
          <Button
            variant="destructive"
            onClick={handleClearChat}
            disabled={isClearPending}
            className="flex-1"
          >
            {isClearPending ? "Limpiando..." : "Limpiar historial del chat"}
          </Button>
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main workspace ──────────────────────────────────────────────

export function FinanzasWorkspace({
  transactions: initialTransactions,
  chatMessages: initialChatMessages,
  transactionAnchors,
  googleSheet,
  serviceAccountEmail,
  workspaceId,
  currency,
  agentPrompt,
}: FinanzasData) {
  const [transactions, setTransactions] = useState<FinanceTransaction[]>(initialTransactions);
  const [chatEvents, setChatEvents] = useState<ChatEvent[]>(() =>
    buildInitialChatEvents(initialTransactions, initialChatMessages, transactionAnchors),
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
  const shouldAutoScrollRef = useRef(false);
  const router = useRouter();

  const isBusy = isPending || isThinking;

  useEffect(() => {
    setTransactions(initialTransactions);
  }, [initialTransactions]);

  useLayoutEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    const feed = feedRef.current;
    const end = endRef.current;
    if (!feed || !end) return;

    end.scrollIntoView({ block: "end", behavior: "auto" });
    feed.scrollTop = feed.scrollHeight;
    shouldAutoScrollRef.current = false;
  }, [chatEvents.length, isThinking]);

  useEffect(() => {
    const persistedMessages = loadPersistedFinanceChatMessages(workspaceId);
    if (!persistedMessages.length) return;

    const mergedMessages = mergeFinanceChatMessages(initialChatMessages, persistedMessages);
    setChatEvents(buildInitialChatEvents(initialTransactions, mergedMessages, transactionAnchors));
    llmHistoryRef.current = mergedMessages.slice(-40).map((m) => ({ role: m.role, content: m.content }));
  }, [initialChatMessages, initialTransactions, transactionAnchors, workspaceId]);

  useEffect(() => {
    const persistedMessages = chatEvents
      .filter((event): event is Extract<ChatEvent, { kind: "user" | "assistant" }> =>
        event.kind === "user" || event.kind === "assistant",
      )
      .filter((event) => event.id !== "assistant-welcome" && event.text !== FINANCE_WELCOME_MESSAGE)
      .map((event) => ({
        id: event.id,
        role: event.kind,
        content: event.text,
        createdAt: event.createdAt,
      }));

    savePersistedFinanceChatMessages(workspaceId, persistedMessages);
  }, [chatEvents, workspaceId]);

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
    shouldAutoScrollRef.current = true;
    const turnTimestamp = new Date().toISOString();

    setChatEvents((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, kind: "user", text: message, createdAt: turnTimestamp, timelineAt: turnTimestamp },
    ]);
    setIsThinking(true);

    try {
      const result = await sendFinanceMessageAction(message, llmHistoryRef.current.slice(-20));

      if (!result.ok) {
        setChatEvents((prev) => [
          ...prev,
          { id: `assistant-${Date.now()}`, kind: "assistant", text: result.error, createdAt: new Date().toISOString(), timelineAt: new Date().toISOString() },
        ]);
        shouldAutoScrollRef.current = true;
        return;
      }

      const { reply, addedTransactions, deletedIds } = result;

      llmHistoryRef.current = [
        ...llmHistoryRef.current,
        { role: "user", content: message },
        { role: "assistant", content: reply },
      ];

      const newEvents: ChatEvent[] = [];

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

      newEvents.push({
        id: `assistant-${Date.now()}`,
        kind: "assistant",
        text: reply,
        createdAt: turnTimestamp,
        timelineAt: turnTimestamp,
      });

      for (const tx of addedTransactions) {
        setTransactions((prev) => [...prev, tx]);
        newEvents.push({
          id: `user-tx-${tx.id}`,
          kind: "userTransaction",
          transaction: tx,
          timelineAt: turnTimestamp,
        });
      }

      shouldAutoScrollRef.current = true;
      setChatEvents((prev) => sortChatEvents([...prev, ...newEvents]));
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
          <div className="relative grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-none border-0 bg-transparent text-slate-900 shadow-none md:rounded-[22px] md:border md:border-[rgba(203,213,225,0.88)] md:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),inset_0_0_0_1px_rgba(255,255,255,0.55),0_0_0_1px_rgba(226,232,240,0.92),0_4px_10px_rgba(15,23,42,0.06),0_18px_38px_-18px_rgba(15,23,42,0.16)]">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={CHAT_BACKGROUND_BASE_STYLE} />
            <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={CHAT_BACKGROUND_OVERLAY_STYLE} />

            {/* Summary bar */}
            <div className="relative z-10 border-b border-[rgba(148,163,184,0.08)] bg-white px-3 py-2 sm:px-4 sm:py-2 md:shadow-[0_1px_0_rgba(226,232,240,0.85),0_8px_10px_-12px_rgba(15,23,42,0.08)]">
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
              className="relative z-10 min-h-0 overflow-y-auto px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+6.4rem)] sm:px-5 sm:py-5 sm:pb-5 md:pb-5 md:[-webkit-overflow-scrolling:touch] md:[scrollbar-width:thin] md:[scrollbar-color:rgba(148,163,184,0.26)_transparent] md:[&::-webkit-scrollbar]:w-1.5 md:[&::-webkit-scrollbar-track]:bg-transparent md:[&::-webkit-scrollbar-thumb]:rounded-full md:[&::-webkit-scrollbar-thumb]:bg-slate-300 md:[&::-webkit-scrollbar-thumb:hover]:bg-slate-400"
            >

              {chatEvents.length <= 1 && transactions.length === 0 ? (
                <div className="relative z-10 flex h-full flex-col items-center justify-center px-4 py-16 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-[24px] bg-[color:color-mix(in_srgb,var(--primary)_8%,white)] text-[var(--primary)] shadow-[0_18px_40px_-30px_rgba(15,23,42,0.2)]">
                    <Wallet className="h-8 w-8" />
                  </div>
                  <p className="mt-4 text-base font-semibold text-slate-900">Sin movimientos todavia</p>
                  <p className="mt-1 max-w-xs text-sm text-slate-500">
                    Escribeme un gasto o ingreso y lo registro automaticamente.
                  </p>
                </div>
              ) : (
                <div className="relative z-10 flex min-h-full flex-col justify-end gap-2.5 sm:gap-2.5">
                  {chatEvents.map((event, index) => {
                    if (event.kind === "user") {
                      return (
                        <div key={event.id} className="flex justify-end">
                          <div className="flex max-w-[74%] flex-col items-end gap-0.5 sm:max-w-[68%] lg:max-w-[58%]">
                            <div className="rounded-[10px] rounded-br-[4px] bg-[linear-gradient(180deg,#3b5bfd_0%,#2c4df5_100%)] px-3 py-2 text-[13px] font-medium leading-4 whitespace-pre-wrap text-white shadow-[0_8px_16px_-10px_rgba(15,23,42,0.28),0_2px_4px_rgba(15,23,42,0.06)] [overflow-wrap:anywhere] md:shadow-[0_8px_16px_-10px_rgba(15,23,42,0.22),0_2px_4px_rgba(15,23,42,0.05)]">
                              {event.text}
                            </div>
                            <p className="text-[10px] leading-none text-slate-400">
                              {formatTime(event.createdAt)}
                            </p>
                          </div>
                        </div>
                      );
                    }

                    if (event.kind === "assistant") {
                      return (
                        <div key={event.id} className="flex justify-start">
                          <div className="flex max-w-[78%] flex-col items-start gap-0.5 sm:max-w-[68%] lg:max-w-[58%]">
                            <div className="rounded-[10px] rounded-bl-[4px] border border-[rgba(148,163,184,0.12)] bg-white px-3 py-2 text-[13px] leading-4 whitespace-pre-wrap text-slate-900 shadow-[0_8px_16px_-10px_rgba(15,23,42,0.18),0_2px_4px_rgba(15,23,42,0.05)] [overflow-wrap:anywhere] md:shadow-[0_8px_16px_-10px_rgba(15,23,42,0.14),0_2px_4px_rgba(15,23,42,0.04)]">
                              {event.text}
                            </div>
                            <p className="text-[10px] leading-none text-slate-400">
                              {formatTime(event.createdAt)}
                            </p>
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
                            className={`rounded-[10px] border px-3 py-2 shadow-[0_8px_16px_-10px_rgba(15,23,42,0.16),0_2px_4px_rgba(15,23,42,0.05)] sm:px-3 sm:py-2 md:shadow-[0_8px_16px_-10px_rgba(15,23,42,0.12),0_2px_4px_rgba(15,23,42,0.04)] ${
                              isUserTransaction
                                ? "max-w-[74%] rounded-br-[4px] border-[rgba(59,91,253,0.12)] bg-[color:color-mix(in_srgb,var(--primary)_6%,white)] sm:max-w-[68%] lg:max-w-[58%]"
                                : "max-w-[78%] rounded-bl-[4px] border-[rgba(148,163,184,0.12)] bg-white sm:max-w-[68%] lg:max-w-[58%]"
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
                                      <p className="text-[13px] leading-4 text-slate-900 [overflow-wrap:anywhere]">
                                        {t.description}
                                      </p>
                                      <span
                                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                                          t.type === "INCOME"
                                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70"
                                            : "bg-rose-50 text-rose-700 ring-1 ring-rose-200/70"
                                        }`}
                                      >
                                        {t.type === "INCOME" ? "Ingreso" : "Gasto"}
                                      </span>
                                      {t.source === "google_sheet" && (
                                        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 ring-1 ring-slate-200">
                                          Sheet
                                        </span>
                                      )}
                                      {t.category && (
                                        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200">
                                          {t.category}
                                        </span>
                                      )}
                                    </div>
                                    <p className="mt-0.5 text-[11px] text-slate-500">{formatTime(t.date)}</p>
                                  </div>
                                  <div className="flex items-center justify-between gap-2 sm:justify-end">
                                     <p
                                       className={`text-right text-[13px] font-semibold tracking-[-0.02em] ${
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
            <div className="chat-composer relative z-10 shrink-0 border-t border-[rgba(148,163,184,0.08)] bg-white/98 px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2.5 shadow-[0_-12px_28px_-24px_rgba(15,23,42,0.2)] backdrop-blur md:border-[rgba(148,163,184,0.1)] md:bg-white md:px-4 md:py-3 md:shadow-[0_-10px_18px_-18px_rgba(15,23,42,0.16)]">
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
          onSaved={() => router.refresh()}
            onChatCleared={() => {
              llmHistoryRef.current = [];
              clearPersistedFinanceChatMessages(workspaceId);
              setChatEvents(buildInitialChatEvents(transactions, [], transactionAnchors));
              setShowSettings(false);
            }}
          />
        )}
    </div>
  );
}
