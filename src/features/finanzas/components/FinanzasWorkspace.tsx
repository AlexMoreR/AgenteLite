"use client";

import { useState, useRef, useEffect, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  RefreshCw,
  Trash2,
  Send,
  Sheet,
  X,
} from "lucide-react";
import {
  addTransactionAction,
  deleteTransactionAction,
  connectGoogleSheetAction,
  syncGoogleSheetAction,
} from "@/app/actions/finanzas-actions";
import type { FinanzasData, FinanceTransaction } from "../types";

function parseTransactionText(
  text: string,
): { type: "INCOME" | "EXPENSE"; amount: number; description: string } | null {
  const lower = text.toLowerCase().trim();

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

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
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
                <Sheet className="h-5 w-5" />
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
}: FinanzasData) {
  const [transactions, setTransactions] = useState<FinanceTransaction[]>(initialTransactions);
  const [input, setInput] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [showSheet, setShowSheet] = useState(false);
  const [isPending, startTransition] = useTransition();
  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    setTransactions(initialTransactions);
  }, [initialTransactions]);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [transactions.length]);

  const summary = useMemo(() => {
    const income = transactions
      .filter((t) => t.type === "INCOME")
      .reduce((s, t) => s + t.amount, 0);
    const expense = transactions
      .filter((t) => t.type === "EXPENSE")
      .reduce((s, t) => s + t.amount, 0);
    return { income, expense, balance: income - expense };
  }, [transactions]);

  const topCategories = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of transactions.filter((t) => t.type === "EXPENSE")) {
      const cat = t.category || "Sin categoria";
      map.set(cat, (map.get(cat) ?? 0) + t.amount);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [transactions]);

  const grouped = useMemo(() => {
    const groups = new Map<string, FinanceTransaction[]>();
    for (const t of transactions) {
      const key = formatDateLabel(t.date);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)?.push(t);
    }
    return Array.from(groups.entries());
  }, [transactions]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setParseError(null);
    const parsed = parseTransactionText(input);
    if (!parsed) {
      setParseError('Prueba con "gasto 500 supermercado" o "ingreso 2000 salario"');
      return;
    }

    const fd = new FormData();
    fd.append("type", parsed.type);
    fd.append("amount", String(parsed.amount));
    fd.append("description", parsed.description);

    const optimisticId = `temp-${Date.now()}`;
    const optimisticDate = new Date().toISOString();
    const optimistic: FinanceTransaction = {
      id: optimisticId,
      type: parsed.type,
      amount: parsed.amount,
      description: parsed.description,
      category: null,
      date: optimisticDate,
      source: "manual",
      createdAt: optimisticDate,
    };

    setTransactions((prev) => [...prev, optimistic]);
    setInput("");

    startTransition(async () => {
      const result = await addTransactionAction(fd);
      if (!result.ok) {
        setParseError(result.error);
        setTransactions((prev) => prev.filter((t) => t.id !== optimisticId));
      } else {
        router.refresh();
      }
    });
  }

  function handleDelete(id: string) {
    if (id.startsWith("temp-")) return;
    setTransactions((prev) => prev.filter((t) => t.id !== id));
    startTransition(async () => {
      await deleteTransactionAction(id);
      router.refresh();
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[linear-gradient(180deg,#f6fbf8_0%,#f8fafc_22%,#f8fafc_100%)]">
      <div className="shrink-0 border-b border-slate-200/80 bg-white/80 px-4 py-4 backdrop-blur-xl sm:px-5 lg:px-6">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-600/80">
                Finanzas
              </p>
              <h1 className="mt-1 text-[clamp(1.4rem,1.2rem+1vw,2rem)] font-semibold tracking-[-0.05em] text-slate-950">
                Panel de caja
              </h1>
            </div>
            <button
              onClick={() => setShowSheet(true)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition sm:px-4 sm:text-sm ${
                googleSheet
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300"
                  : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:text-emerald-700"
              }`}
            >
              <Sheet className="h-4 w-4" />
              <span className="hidden sm:inline">
                {googleSheet ? "Google Sheet activo" : "Conectar Sheet"}
              </span>
              <span className="sm:hidden">{googleSheet ? "Sheet" : "Conectar"}</span>
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-[24px] border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f2fbf5_100%)] p-4 shadow-[0_10px_30px_-22px_rgba(16,185,129,0.6)]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">Ingresos</span>
                <TrendingUp className="h-4 w-4 text-emerald-500" />
              </div>
              <p className="mt-3 text-xl font-semibold tracking-[-0.04em] text-emerald-700 sm:text-2xl">
                {formatCurrency(summary.income)}
              </p>
            </div>

            <div className="rounded-[24px] border border-rose-100 bg-[linear-gradient(135deg,#ffffff_0%,#fff4f4_100%)] p-4 shadow-[0_10px_30px_-22px_rgba(244,63,94,0.45)]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">Gastos</span>
                <TrendingDown className="h-4 w-4 text-rose-500" />
              </div>
              <p className="mt-3 text-xl font-semibold tracking-[-0.04em] text-rose-600 sm:text-2xl">
                {formatCurrency(summary.expense)}
              </p>
            </div>

            <div
              className={`rounded-[24px] p-4 shadow-[0_14px_40px_-24px_rgba(15,23,42,0.45)] ${
                summary.balance >= 0
                  ? "bg-[linear-gradient(135deg,#0f172a_0%,#0f766e_100%)]"
                  : "bg-[linear-gradient(135deg,#3f0d12_0%,#be123c_100%)]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-white/70">Balance</span>
                <Wallet className="h-4 w-4 text-white/80" />
              </div>
              <p className="mt-3 text-xl font-semibold tracking-[-0.04em] text-white sm:text-2xl">
                {formatCurrency(summary.balance)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white px-3 py-1.5 text-xs text-slate-500 ring-1 ring-slate-200">
              {transactions.length} movimientos
            </span>
            {topCategories.slice(0, 3).map(([cat, amount]) => (
              <span
                key={cat}
                className="inline-flex max-w-full items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs text-slate-600 ring-1 ring-slate-200"
              >
                <span className="truncate">{cat}</span>
                <span className="font-semibold text-rose-500">{formatCurrency(amount)}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-3 py-3 sm:px-4 sm:py-4 lg:px-6">
        <div className="mx-auto grid h-full max-w-7xl min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-4">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_24px_60px_-38px_rgba(15,23,42,0.35)]">
            <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
              <form onSubmit={handleSubmit} className="space-y-3">
                {parseError && (
                  <p className="rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-600">
                    {parseError}
                  </p>
                )}

                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      setParseError(null);
                    }}
                    placeholder='gasto 500 supermercado'
                    className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:outline-none"
                    disabled={isPending}
                  />
                  <button
                    type="submit"
                    disabled={isPending || !input.trim()}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:opacity-40"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {["gasto 500 transporte", "ingreso 2500 venta"].map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => {
                        setInput(example);
                        setParseError(null);
                        inputRef.current?.focus();
                      }}
                      className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-200"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </form>
            </div>

            <div ref={feedRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">
              {transactions.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-4 py-16 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-[24px] bg-emerald-50 text-emerald-400">
                    <Wallet className="h-8 w-8" />
                  </div>
                  <p className="mt-4 text-base font-semibold text-slate-800">Sin movimientos todavia</p>
                  <p className="mt-1 max-w-xs text-sm text-slate-400">
                    Escribe uno arriba y aparecera aqui.
                  </p>
                </div>
              ) : (
                <div className="space-y-5">
                  {grouped.map(([dateLabel, txs]) => (
                    <section key={dateLabel} className="space-y-3">
                      <div className="sticky top-0 z-10 -mx-1 rounded-full bg-white/90 px-1 py-1 backdrop-blur">
                        <div className="flex items-center gap-3">
                          <div className="h-px flex-1 bg-slate-100" />
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
                            {dateLabel}
                          </span>
                          <div className="h-px flex-1 bg-slate-100" />
                        </div>
                      </div>

                      <div className="space-y-2">
                        {txs.map((t) => (
                          <article
                            key={t.id}
                            className={`rounded-[22px] border px-4 py-3 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.35)] ${
                              t.type === "INCOME"
                                ? "border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f0fdf4_100%)]"
                                : "border-slate-200 bg-white"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <div
                                className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
                                  t.type === "INCOME"
                                    ? "bg-emerald-100 text-emerald-700"
                                    : "bg-rose-50 text-rose-600"
                                }`}
                              >
                                {t.type === "INCOME" ? (
                                  <TrendingUp className="h-4 w-4" />
                                ) : (
                                  <TrendingDown className="h-4 w-4" />
                                )}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="truncate text-sm font-medium text-slate-900">
                                        {t.description}
                                      </p>
                                      {t.source === "google_sheet" && (
                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                                          Sheet
                                        </span>
                                      )}
                                      {t.category && (
                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                                          {t.category}
                                        </span>
                                      )}
                                    </div>
                                    <p className="mt-1 text-xs text-slate-400">{formatTime(t.date)}</p>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <p
                                      className={`text-right text-base font-semibold tracking-[-0.03em] sm:text-lg ${
                                        t.type === "INCOME" ? "text-emerald-700" : "text-rose-600"
                                      }`}
                                    >
                                      {t.type === "INCOME" ? "+" : "-"}
                                      {formatCurrency(t.amount)}
                                    </p>
                                    <button
                                      onClick={() => handleDelete(t.id)}
                                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="min-h-0 overflow-auto rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-4 shadow-[0_20px_50px_-34px_rgba(15,23,42,0.35)]">
            <div className="space-y-4">
              <div className="rounded-[24px] bg-slate-950 px-4 py-4 text-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-[0.18em] text-white/55">Estado</span>
                  <Wallet className="h-4 w-4 text-white/70" />
                </div>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.05em]">
                  {summary.balance >= 0 ? "En positivo" : "En ajuste"}
                </p>
                <p className="mt-2 text-sm text-white/65">{formatCurrency(summary.balance)}</p>
              </div>

              {topCategories.length > 0 && (
                <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Top gastos
                  </p>
                  <div className="mt-4 space-y-2">
                    {topCategories.map(([cat, amount]) => (
                      <div
                        key={cat}
                        className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-3"
                      >
                        <span className="truncate text-sm text-slate-600">{cat}</span>
                        <span className="shrink-0 text-sm font-semibold text-rose-500">
                          {formatCurrency(amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Google Sheet
                  </p>
                  <button
                    onClick={() => setShowSheet(true)}
                    className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-200"
                  >
                    Abrir
                  </button>
                </div>
                <div
                  className={`mt-4 rounded-2xl px-3 py-3 ring-1 ring-inset ${
                    googleSheet
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                      : "bg-slate-50 text-slate-500 ring-slate-200"
                  }`}
                >
                  <p className="text-sm font-medium">
                    {googleSheet ? "Sincronizacion activa" : "Sin conexion"}
                  </p>
                  {googleSheet?.lastSyncAt && (
                    <p className="mt-1 text-xs opacity-80">
                      {new Date(googleSheet.lastSyncAt).toLocaleString("es-CO")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </aside>
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
