"use client";

import { useState, useRef, useEffect, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  RefreshCw,
  Trash2,
  SendHorizonal,
  Settings,
  X,
} from "lucide-react";
import {
  addTransactionAction,
  deleteTransactionAction,
  connectGoogleSheetAction,
  syncGoogleSheetAction,
} from "@/app/actions/finanzas-actions";
import { formatMoney } from "@/lib/currency";
import type { FinanzasData, FinanceTransaction } from "../types";

type ChatEvent =
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "userTransaction"; transaction: FinanceTransaction }
  | { id: string; kind: "transaction"; transaction: FinanceTransaction };

function parseTransactionText(
  text: string,
): { type: "INCOME" | "EXPENSE"; amount: number; description: string } | null {
  const lower = normalizeText(text);

  const expenseRx =
    /\b(gast[oóeé]|gastaste|gast[eé]|compr[oóeé]|compré|compre|pag[oóueé]|pagaste|pagu[eé]|egreso|sali[oó])\b/;
  const incomeRx =
    /\b(ingres[oóeé]|ingresaste|ingres[eé]|recib[ií]|recibiste|recib[ií]|cobr[oóeé]|cobraste|cobr[eé]|entr[oóeé]|gan[oóeé]|ganaste|venta|ventas|factur[eé])\b/;

  const isExpense = expenseRx.test(lower);
  const isIncome = incomeRx.test(lower);
  if (!isExpense && !isIncome) return null;

  const amountMatch = text.match(
    /\b(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?)\b/,
  );
  if (!amountMatch) return null;
  const raw = amountMatch[1];
  let amount: number;
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    amount = parseFloat(raw.replace(/\./g, ""));
  } else {
    amount = parseFloat(raw.replace(/\./g, "").replace(",", "."));
  }
  if (!amount || amount <= 0) return null;

  const stopWords =
    /\b(gasto|gaste|gasté|compra|compré|compre|pago|pagué|pague|egreso|ingreso|ingresé|ingrese|recibí|recibi|cobré|cobre|entró|entro|ganó|gano|gané|gane|venta|ventas|facturé|facture|un|una|en|de|por|a|al|del|me)\b/gi;

  const description = text
    .replace(expenseRx, " ")
    .replace(incomeRx, " ")
    .replace(stopWords, " ")
    .replace(raw, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    type: isExpense ? "EXPENSE" : "INCOME",
    amount,
    description: description || (isExpense ? "Gasto" : "Ingreso"),
  };
}

function parseTransactionDraft(text: string): {
  type: "INCOME" | "EXPENSE" | null;
  amount: number | null;
  description: string;
} {
  const lower = normalizeText(text);
  const expenseRx =
    /\b(gasto|gaste|gastaste|compra|compre|compre|pago|pague|egreso|salio)\b/;
  const incomeRx =
    /\b(ingreso|ingrese|venta|ventas|cobre|cobro|recibi|gane|facture)\b/;

  const amountMatch = text.match(
    /\b(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?)\b/,
  );

  let amount: number | null = null;
  if (amountMatch) {
    const raw = amountMatch[1];
    amount = /^\d{1,3}(\.\d{3})+$/.test(raw)
      ? parseFloat(raw.replace(/\./g, ""))
      : parseFloat(raw.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) amount = null;
  }

  const stopWords =
    /\b(gasto|gaste|gasté|compra|compré|compre|pago|pagué|pague|egreso|ingreso|ingresé|ingrese|recibí|recibi|cobré|cobre|entró|entro|ganó|gano|gané|gane|venta|ventas|facturé|facture|un|una|en|de|por|a|al|del|me)\b/gi;

  const description = text
    .replace(expenseRx, " ")
    .replace(incomeRx, " ")
    .replace(stopWords, " ")
    .replace(amountMatch?.[1] ?? "", " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    type: expenseRx.test(lower) ? "EXPENSE" : incomeRx.test(lower) ? "INCOME" : null,
    amount,
    description,
  };
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
  return d.toLocaleDateString("es-CO", { day: "numeric", month: "long" });
}

function formatTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
  });
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

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isGreetingIntent(text: string): boolean {
  const normalized = normalizeText(text);
  return [
    "hola",
    "buenas",
    "buen dia",
    "buenos dias",
    "buenas tardes",
    "buenas noches",
    "hey",
    "hello",
  ].some((token) => normalized === token || normalized.startsWith(`${token} `));
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isQuestionIntent(text: string): boolean {
  const normalized = normalizeText(text);
  if (normalized.includes("?")) return true;

  return [
    "cuanto",
    "que ",
    "que gaste",
    "que ingrese",
    "cual",
    "resumen",
    "balance",
    "total",
    "mostrar",
    "muestra",
    "listar",
    "cuantos",
    "como voy",
    "gaste hoy",
    "gaste ayer",
    "gastos de hoy",
    "gastos de ayer",
    "ingresos de hoy",
    "ingresos de ayer",
  ].some((token) => normalized.includes(token));
}

function parseRequestedDate(text: string): { label: string; matcher: (date: Date) => boolean } | null {
  const normalized = normalizeText(text);
  const now = new Date();
  const today = startOfDay(now);

  if (normalized.includes("hoy")) {
    return {
      label: "hoy",
      matcher: (date) => startOfDay(date).getTime() === today.getTime(),
    };
  }

  if (normalized.includes("ayer")) {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return {
      label: "ayer",
      matcher: (date) => startOfDay(date).getTime() === yesterday.getTime(),
    };
  }

  const isoMatch = normalized.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const target = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    return {
      label: `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`,
      matcher: (date) => startOfDay(date).getTime() === target.getTime(),
    };
  }

  const localMatch = normalized.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?\b/);
  if (localMatch) {
    const year = localMatch[3] ? Number(localMatch[3]) : now.getFullYear();
    const target = new Date(year, Number(localMatch[2]) - 1, Number(localMatch[1]));
    const label = `${String(localMatch[1]).padStart(2, "0")}/${String(localMatch[2]).padStart(2, "0")}${localMatch[3] ? `/${localMatch[3]}` : ""}`;
    return {
      label,
      matcher: (date) => startOfDay(date).getTime() === target.getTime(),
    };
  }

  return null;
}

function buildAssistantReply(
  text: string,
  transactions: FinanceTransaction[],
  currency: FinanzasData["currency"],
): string {
  const normalized = normalizeText(text);
  const dateFilter = parseRequestedDate(text);
  const txs = dateFilter
    ? transactions.filter((item) => dateFilter.matcher(new Date(item.date)))
    : transactions;

  if (normalized.includes("balance") || normalized.includes("como voy")) {
    const income = txs.filter((item) => item.type === "INCOME").reduce((sum, item) => sum + item.amount, 0);
    const expense = txs.filter((item) => item.type === "EXPENSE").reduce((sum, item) => sum + item.amount, 0);
    const balance = income - expense;
    const rangeLabel = dateFilter ? ` para ${dateFilter.label}` : "";
    return `Tu balance${rangeLabel} es ${formatMoney(balance, currency)}. Ingresos ${formatMoney(income, currency)} y gastos ${formatMoney(expense, currency)}.`;
  }

  const askingExpenses =
    normalized.includes("gasto") || normalized.includes("gaste") || normalized.includes("egreso");
  const askingIncome =
    normalized.includes("ingreso") || normalized.includes("ingrese") || normalized.includes("venta") || normalized.includes("cobre");

  let scoped = txs;
  let label = "movimientos";

  if (askingExpenses && !askingIncome) {
    scoped = txs.filter((item) => item.type === "EXPENSE");
    label = "gastos";
  } else if (askingIncome && !askingExpenses) {
    scoped = txs.filter((item) => item.type === "INCOME");
    label = "ingresos";
  }

  if (!scoped.length) {
    if (dateFilter) {
      return `No veo ${label} registrados para ${dateFilter.label}.`;
    }
    return `Todavia no encuentro ${label} registrados para responder eso.`;
  }

  const total = scoped.reduce((sum, item) => sum + item.amount, 0);
  const latest = scoped[scoped.length - 1];
  const rangeLabel = dateFilter ? ` de ${dateFilter.label}` : "";

  if (normalized.includes("cuanto") || normalized.includes("total") || normalized.includes("cuantos")) {
    return `Tienes ${scoped.length} ${label}${rangeLabel} por ${formatMoney(total, currency)}. El ultimo fue ${latest.description} por ${formatMoney(latest.amount, currency)}.`;
  }

  const preview = scoped
    .slice(-3)
    .reverse()
    .map((item) => `${item.description} ${formatMoney(item.amount, currency)}`)
    .join(", ");

  return `Veo ${scoped.length} ${label}${rangeLabel}. Los mas recientes son: ${preview}.`;
}

function buildIncompleteTransactionReply(
  draft: ReturnType<typeof parseTransactionDraft>,
  currency: FinanzasData["currency"],
): string | null {
  if (!draft.type) return null;
  if (!draft.amount && !draft.description) {
    return `Claro. Vamos a registrar ${draft.type === "INCOME" ? "un ingreso" : "un gasto"}. Enviame monto y descripcion, por ejemplo: "${draft.type === "INCOME" ? "ingreso 250000 venta" : "gasto 80000 gasolina"}".`;
  }
  if (!draft.amount) {
    return `Entendi que quieres registrar ${draft.type === "INCOME" ? "un ingreso" : "un gasto"} por "${draft.description}". Solo me falta el monto. Ejemplo: "${draft.type === "INCOME" ? "ingreso 250000" : "gasto 50000"} ${draft.description}".`;
  }
  if (!draft.description) {
    return `Perfecto, ya tengo el monto ${formatMoney(draft.amount, currency)}. Ahora dime una descripcion corta para registrarlo, por ejemplo supermercado, transporte o venta.`;
  }
  return null;
}

function buildDefaultAssistantReply(currency: FinanzasData["currency"]): string {
  return `Estoy listo para ayudarte con tus finanzas. Puedes saludarme, registrar un movimiento como "gasto 50000 transporte" o preguntarme algo como "que gaste hoy". Moneda activa: ${currency}.`;
}

function buildHistoryAssistantReply(
  transaction: FinanceTransaction,
  currency: FinanzasData["currency"],
): string {
  return transaction.type === "INCOME"
    ? `Registré tu ingreso de ${formatMoney(transaction.amount, currency)} en ${transaction.description}.`
    : `Registré tu gasto de ${formatMoney(transaction.amount, currency)} en ${transaction.description}.`;
}

function buildInitialChatEvents(
  transactions: FinanceTransaction[],
  currency: FinanzasData["currency"],
): ChatEvent[] {
  const intro: ChatEvent = {
    id: "assistant-welcome",
    kind: "assistant",
    text: "Escribe un gasto, un ingreso o una pregunta como “que gaste hoy” y te respondo aqui mismo.",
  };

  const items = transactions.flatMap((transaction) => {
    if (transaction.source === "manual") {
      return [
        {
          id: `user-tx-${transaction.id}`,
          kind: "userTransaction" as const,
          transaction,
        },
        {
          id: `assistant-history-${transaction.id}`,
          kind: "assistant" as const,
          text: buildHistoryAssistantReply(transaction, currency),
        },
      ];
    }

    return [
      {
        id: `tx-${transaction.id}`,
        kind: "transaction" as const,
        transaction,
      },
    ];
  });

  return [intro, ...items];
}

type GoogleSheetDialogProps = {
  googleSheet: FinanzasData["googleSheet"];
  serviceAccountEmail: string | null;
  onClose: () => void;
  onSynced: () => void;
};

function GoogleSheetDialog({
  googleSheet,
  serviceAccountEmail,
  onClose,
  onSynced,
}: GoogleSheetDialogProps) {
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
      if (!result.ok) {
        setError(result.error);
        return;
      }
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
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.headersJustCreated) {
        setHeadersCreated(true);
        setSyncCount(null);
      } else {
        setSyncCount(result.count ?? 0);
      }
      onSynced();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 bg-[linear-gradient(135deg,#f7fef9_0%,#eef8ff_100%)] px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-emerald-600 shadow-sm ring-1 ring-emerald-100">
                <Settings className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">Google Sheets</h2>
                <p className="text-xs text-slate-500">
                  {step === "url" ? "Conecta la hoja" : "Activa la sincronizacion"}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-white hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="space-y-4 px-5 py-5 sm:px-6 sm:py-6">
          {step === "url" && (
            <>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm text-slate-700">
                <p className="font-medium text-slate-900">Formato automatico</p>
                <p className="mt-1 leading-6">
                  La hoja se prepara con columnas de tipo, monto, categoria, fecha y hora.
                </p>
              </div>
              <label className="block text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                Link
              </label>
              <input
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError(null);
                }}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:outline-none"
              />
            </>
          )}

          {step === "share" && serviceAccountEmail && (
            <>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                  Editor requerido
                </p>
                <div
                  className="mt-3 cursor-pointer rounded-2xl border border-emerald-200 bg-white px-3 py-3 font-mono text-[11px] text-slate-700 shadow-sm transition hover:border-emerald-300"
                  onClick={() => navigator.clipboard.writeText(serviceAccountEmail)}
                  title="Clic para copiar"
                >
                  {serviceAccountEmail}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Paso 1
                  </p>
                  <p className="mt-2 text-sm text-slate-700">Comparte la hoja como editor.</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Paso 2
                  </p>
                  <p className="mt-2 text-sm text-slate-700">Sincroniza para importar o actualizar.</p>
                </div>
              </div>

              {googleSheet?.lastSyncAt && (
                <p className="text-xs text-slate-400">
                  Ultima sync: {new Date(googleSheet.lastSyncAt).toLocaleString("es-CO")}
                </p>
              )}
            </>
          )}

          {step === "share" && !serviceAccountEmail && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-medium">La hoja debe ser publica</p>
              <p className="mt-1 leading-6">
                Compartela como lector y usa encabezados de tipo, monto, descripcion y categoria.
              </p>
            </div>
          )}

          {error && (
            <p className="rounded-2xl bg-rose-50 px-3 py-3 text-xs text-rose-600">{error}</p>
          )}
          {headersCreated && (
            <div className="rounded-2xl bg-emerald-50 px-3 py-3 text-xs text-emerald-700">
              Columnas creadas. Agrega datos y vuelve a sincronizar.
            </div>
          )}
          {syncCount !== null && !headersCreated && (
            <p className="rounded-2xl bg-emerald-50 px-3 py-3 text-xs text-emerald-700">
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
                className="flex-1 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {isPending ? "Conectando..." : "Conectar"}
              </button>
            )}

            {step === "share" && (
              <button
                onClick={handleSync}
                disabled={isPending}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
                {isPending ? "Sincronizando..." : "Sincronizar"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FinanzasWorkspace({
  transactions: initialTransactions,
  googleSheet,
  serviceAccountEmail,
  currency,
}: FinanzasData) {
  const [transactions, setTransactions] = useState<FinanceTransaction[]>(initialTransactions);
  const [chatEvents, setChatEvents] = useState<ChatEvent[]>(() =>
    buildInitialChatEvents(initialTransactions, currency),
  );
  const [input, setInput] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [showSheet, setShowSheet] = useState(false);
  const [isPending, startTransition] = useTransition();
  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [chatEvents.length]);

  const summary = useMemo(() => {
    const income = transactions
      .filter((t) => t.type === "INCOME")
      .reduce((s, t) => s + t.amount, 0);
    const expense = transactions
      .filter((t) => t.type === "EXPENSE")
      .reduce((s, t) => s + t.amount, 0);
    return { income, expense, balance: income - expense };
  }, [transactions]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setParseError(null);
    const message = input.trim();
    if (!message) return;

    const userEvent: ChatEvent = {
      id: `user-${Date.now()}`,
      kind: "user",
      text: message,
    };

    setChatEvents((prev) => [...prev, userEvent]);
    setInput("");

    if (isGreetingIntent(message)) {
      setChatEvents((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now() + 1}`,
          kind: "assistant",
          text: "Hola, soy tu asistente de finanzas. Estoy aqui para ayudarte a registrar ingresos, gastos y responder consultas. Que movimiento vamos a reportar hoy?",
        },
      ]);
      return;
    }

    if (isQuestionIntent(message)) {
      const reply = buildAssistantReply(message, transactions, currency);
      setChatEvents((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now() + 1}`,
          kind: "assistant",
          text: reply,
        },
      ]);
      return;
    }

    const parsed = parseTransactionText(message);
    if (!parsed) {
      const draft = parseTransactionDraft(message);
      const guidedReply =
        buildIncompleteTransactionReply(draft, currency) ?? buildDefaultAssistantReply(currency);
      setChatEvents((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now() + 2}`,
          kind: "assistant",
          text: guidedReply,
        },
      ]);
      return;
    }

    const fd = new FormData();
    fd.append("type", parsed.type);
    fd.append("amount", String(parsed.amount));
    fd.append("description", parsed.description);

    const optimisticDate = new Date().toISOString();
    const optimistic: FinanceTransaction = {
      id: `temp-${Date.now()}`,
      type: parsed.type,
      amount: parsed.amount,
      description: parsed.description,
      category: null,
      date: optimisticDate,
      source: "manual",
      createdAt: optimisticDate,
    };

    setTransactions((prev) => [...prev, optimistic]);

    startTransition(async () => {
      const result = await addTransactionAction(fd);
      if (!result.ok) {
        setParseError(result.error);
        setTransactions((prev) => prev.filter((t) => t.id !== optimistic.id));
        setChatEvents((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now() + 3}`,
            kind: "assistant",
            text: result.error,
          },
        ]);
        return;
      }

      const savedTransaction = result.transaction;
      setTransactions((prev) => prev.map((item) => (item.id === optimistic.id ? savedTransaction : item)));
      setChatEvents((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now() + 4}`,
          kind: "assistant",
          text:
            result.sheetSync === "synced"
              ? `Listo. Guarde ${parsed.type === "INCOME" ? "el ingreso" : "el gasto"} de ${formatMoney(parsed.amount, currency)} y tambien lo envie a Google Sheets.`
              : result.sheetSync === "failed"
                ? `Lo guarde aqui, pero Google Sheets no respondio. Revisa la conexion de la hoja.`
                : `Listo. Guarde ${parsed.type === "INCOME" ? "el ingreso" : "el gasto"} de ${formatMoney(parsed.amount, currency)}.`,
        },
      ]);
    });
  }

  function handleDelete(id: string) {
    if (id.startsWith("temp-")) return;
    setTransactions((prev) => prev.filter((t) => t.id !== id));
    setChatEvents((prev) =>
      prev.filter((event) => {
        if (
          (event.kind === "transaction" || event.kind === "userTransaction") &&
          event.transaction.id === id
        ) {
          return false;
        }

        if (event.kind === "assistant" && event.id === `assistant-history-${id}`) {
          return false;
        }

        return true;
      }),
    );
    startTransition(async () => {
      await deleteTransactionAction(id);
    });
  }

  return (
    <div className="chat-app-layout flex h-full min-h-0 flex-col overflow-hidden bg-[linear-gradient(180deg,#f6fbf8_0%,#f8fafc_22%,#f8fafc_100%)]">
      <div className="min-h-0 flex-1 overflow-hidden px-1.5 py-1.5 sm:px-2 sm:py-2 lg:px-3">
        <div className="mx-auto grid h-full max-w-7xl min-h-0 gap-1.5">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-[#31456f] bg-[linear-gradient(180deg,#1b2748_0%,#223463_100%)] text-white shadow-[0_24px_60px_-36px_rgba(15,23,42,0.7)]">
            <div className="border-b border-white/10 px-3 py-1.5 sm:px-4">
              <div className="relative flex items-center justify-center">
                <div className="flex flex-wrap justify-center gap-1">
                  <div className="inline-flex min-w-0 items-center gap-1 rounded-full border border-emerald-200/18 bg-white/8 px-2 py-1 backdrop-blur-md">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100/12">
                      <TrendingUp className="h-3 w-3 text-emerald-300" />
                    </span>
                    <p className="truncate text-[11px] font-semibold text-emerald-200">
                      {formatMoney(summary.income, currency)}
                    </p>
                  </div>

                  <div className="inline-flex min-w-0 items-center gap-1 rounded-full border border-rose-200/16 bg-white/8 px-2 py-1 backdrop-blur-md">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-400/10">
                      <TrendingDown className="h-3 w-3 text-rose-300" />
                    </span>
                    <p className="truncate text-[11px] font-semibold text-rose-200">
                      {formatMoney(summary.expense, currency)}
                    </p>
                  </div>

                  <div
                    className={`inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-1 backdrop-blur-md ${
                      summary.balance >= 0
                        ? "border-cyan-200/20 bg-[linear-gradient(135deg,rgba(20,184,166,0.22)_0%,rgba(15,23,42,0.2)_100%)]"
                        : "border-rose-200/18 bg-[linear-gradient(135deg,rgba(244,63,94,0.16)_0%,rgba(15,23,42,0.22)_100%)]"
                    }`}
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10">
                      <Wallet className="h-3 w-3 text-white/80" />
                    </span>
                    <p className="truncate text-[11px] font-semibold text-white">
                      {formatMoney(summary.balance, currency)}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowSheet(true)}
                  className="absolute right-0 top-1/2 flex h-8 w-8 -translate-y-1/2 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/6 text-white/72 transition hover:bg-white/8 hover:text-white"
                  title={googleSheet ? "Configurar Google Sheet" : "Conectar Google Sheet"}
                  aria-label={googleSheet ? "Configurar Google Sheet" : "Conectar Google Sheet"}
                >
                  <Settings className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div
              ref={feedRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 sm:py-4"
            >
              {chatEvents.length <= 1 && transactions.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-4 py-16 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-[24px] bg-white/8 text-emerald-200">
                    <Wallet className="h-8 w-8" />
                  </div>
                  <p className="mt-4 text-base font-semibold text-white">Sin movimientos todavia</p>
                  <p className="mt-1 max-w-xs text-sm text-white/58">
                    Escribe uno arriba y aparecera aqui.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {chatEvents.map((event, index) => {
                    if (event.kind === "user") {
                      return (
                        <div key={event.id} className="flex justify-end">
                          <div className="max-w-[82%] rounded-[18px] rounded-br-md bg-white px-3 py-2 text-[12px] leading-5 text-slate-900 shadow-[0_14px_35px_-24px_rgba(15,23,42,0.35)]">
                            {event.text}
                          </div>
                        </div>
                      );
                    }

                    if (event.kind === "assistant") {
                      return (
                        <div key={event.id} className="flex justify-start">
                          <div className="max-w-[84%] rounded-[18px] rounded-bl-md border border-white/10 bg-white/8 px-3 py-2 text-[12px] leading-5 text-white shadow-[0_14px_35px_-26px_rgba(15,23,42,0.35)] backdrop-blur-sm">
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
                        (
                          previousEvent,
                        ): previousEvent is Extract<
                          ChatEvent,
                          { kind: "transaction" | "userTransaction" }
                        > =>
                          previousEvent.kind === "transaction" ||
                          previousEvent.kind === "userTransaction",
                      );
                    const showDateDivider =
                      !previousTransaction || !isSameCalendarDay(previousTransaction.transaction.date, t.date);
                    return (
                      <div key={event.id} className="space-y-1">
                        {showDateDivider && (
                          <div className="flex items-center gap-3 px-1">
                            <div className="h-px flex-1 bg-white/10" />
                            <span className="rounded-full bg-white/8 px-3 py-1 text-[11px] font-semibold text-white/65">
                              {formatDateLabel(t.date)}
                            </span>
                            <div className="h-px flex-1 bg-white/10" />
                          </div>
                        )}

                        <div className={isUserTransaction ? "flex justify-end" : ""}>
                          <article
                            className={`rounded-[18px] border px-3 py-2.5 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.35)] ${
                              isUserTransaction
                                ? "w-full max-w-[84%] border-white/14 bg-[linear-gradient(135deg,rgba(255,255,255,0.12)_0%,rgba(148,163,184,0.12)_100%)]"
                                : t.type === "INCOME"
                                  ? "border-emerald-200/30 bg-[linear-gradient(135deg,rgba(255,255,255,0.16)_0%,rgba(16,185,129,0.14)_100%)]"
                                  : "border-white/10 bg-white/6"
                            }`}
                          >
                          <div className="flex items-start gap-2.5">
                            <div
                              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[14px] ${
                                t.type === "INCOME"
                                  ? "bg-emerald-100/18 text-emerald-200"
                                  : "bg-rose-400/12 text-rose-200"
                              }`}
                            >
                              {t.type === "INCOME" ? (
                                <TrendingUp className="h-3.5 w-3.5" />
                              ) : (
                                <TrendingDown className="h-3.5 w-3.5" />
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <p className="truncate text-[12px] font-medium text-white">
                                      {t.description}
                                    </p>
                                    {t.source === "google_sheet" && (
                                      <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/65">
                                        Sheet
                                      </span>
                                    )}
                                    {t.category && (
                                      <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-white/65">
                                        {t.category}
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-0.5 text-[11px] text-white/50">{formatTime(t.date)}</p>
                                </div>

                                <div className="flex items-center gap-2">
                                  <p
                                    className={`text-right text-[12px] font-semibold tracking-[-0.02em] ${
                                      t.type === "INCOME" ? "text-emerald-200" : "text-rose-200"
                                    }`}
                                  >
                                    {t.type === "INCOME" ? "+" : "-"}
                                    {formatMoney(t.amount, currency)}
                                  </p>
                                  <button
                                    onClick={() => handleDelete(t.id)}
                                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/30 transition hover:bg-rose-400/12 hover:text-rose-200"
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
                </div>
              )}
            </div>

            <div className="chat-composer shrink-0 border-t border-white/10 bg-transparent px-2 pb-[calc(env(safe-area-inset-bottom)+0.25rem)] pt-1.5 md:px-2 md:py-1.5">
              <form onSubmit={handleSubmit}>
                <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/6 px-2.5 py-1.5 shadow-[0_16px_30px_-26px_rgba(15,23,42,0.9)] backdrop-blur-md">
                  <textarea
                    ref={inputRef}
                    value={input}
                      onChange={(e) => {
                        setInput(e.target.value);
                        setParseError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (!isPending && input.trim()) {
                            e.currentTarget.form?.requestSubmit();
                          }
                        }
                      }}
                      rows={1}
                      placeholder="Cuéntame el gasto, el ingreso o hazme una pregunta sobre tus movimientos."
                      className="h-8 flex-1 resize-none bg-transparent pt-1.5 text-[14px] text-white placeholder:text-white/45 outline-none"
                      disabled={isPending}
                    />

                    <button
                      type="submit"
                      disabled={isPending || !input.trim()}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-950 transition hover:bg-slate-100 disabled:opacity-40"
                    >
                      <SendHorizonal className="h-3.5 w-3.5" />
                    </button>
                </div>
                {parseError && (
                  <p className="mt-2 rounded-2xl bg-rose-500/12 px-3 py-2 text-xs text-rose-100">
                    {parseError}
                  </p>
                )}
              </form>
            </div>
          </div>
        </div>
      </div>

      {showSheet && (
        <GoogleSheetDialog
          googleSheet={googleSheet}
          serviceAccountEmail={serviceAccountEmail}
          onClose={() => setShowSheet(false)}
          onSynced={() => router.refresh()}
        />
      )}
    </div>
  );
}
