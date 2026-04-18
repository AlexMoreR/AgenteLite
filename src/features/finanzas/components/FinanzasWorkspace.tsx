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

// ─── Helpers ────────────────────────────────────────────────────────────────

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

  // Extract amount — handles 1.000 (thousands sep) and 1,50 (decimal)
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
  if (diff < 7) return `Hace ${diff} días`;
  return d.toLocaleDateString("es-CO", { day: "numeric", month: "long" });
}

function formatTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Google Sheet Dialog ─────────────────────────────────────────────────────

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
      if (!result.ok) { setError(result.error); return; }
      onSynced();
      if (serviceAccountEmail) {
        setStep("share");
      } else {
        onClose();
      }
    });
  }

  function handleSync() {
    setError(null);
    setSyncCount(null);
    setHeadersCreated(false);
    startTransition(async () => {
      const result = await syncGoogleSheetAction();
      if (result.ok) {
        if (result.headersJustCreated) {
          setHeadersCreated(true);
          setSyncCount(null);
        } else {
          setSyncCount(result.count ?? 0);
        }
        onSynced();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <Sheet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Google Sheets</h2>
              <p className="text-xs text-slate-500">
                {step === "url" ? "Pega el link de tu hoja" : "Comparte la hoja"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step 1 — URL */}
        {step === "url" && (
          <>
            <p className="mb-4 text-sm text-slate-600 leading-6">
              Pega el link de cualquier Google Sheet. Al conectar, el sistema{" "}
              <strong>crea automáticamente las columnas</strong>{" "}
              <code className="rounded bg-emerald-50 px-1 text-emerald-700 text-xs">
                TIPO · MONTO · DESCRIPCION · CATEGORIA
              </code>{" "}
              en la primera fila.
            </p>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Link del Google Sheet
            </label>
            <input
              value={url}
              onChange={(e) => { setUrl(e.target.value); setError(null); }}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="mb-4 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none"
            />
          </>
        )}

        {/* Step 2 — Share instructions (only when service account is configured) */}
        {step === "share" && serviceAccountEmail && (
          <>
            <div className="mb-4 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800 leading-6 space-y-2">
              <p className="font-semibold">Paso 1 (solo la primera vez)</p>
              <p>
                Abre tu Google Sheet → <strong>Compartir</strong> → pega este correo y dale{" "}
                <strong>permisos de Editor</strong>:
              </p>
              <div
                className="cursor-pointer rounded-xl bg-white px-3 py-2 font-mono text-xs text-slate-700 border border-emerald-200 select-all"
                onClick={() => navigator.clipboard.writeText(serviceAccountEmail)}
                title="Clic para copiar"
              >
                {serviceAccountEmail}
              </div>
              <p className="text-xs text-emerald-600">
                (Clic en el correo para copiarlo)
              </p>
            </div>
            <div className="mb-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600 leading-6">
              <p className="font-semibold text-slate-700 mb-1">Paso 2</p>
              <p>
                Agrega tus datos en la hoja. Las columnas ya fueron creadas automáticamente. Luego da clic en{" "}
                <strong>Sincronizar</strong>.
              </p>
            </div>
            {googleSheet?.lastSyncAt && (
              <p className="mb-3 text-xs text-slate-400">
                Última sync: {new Date(googleSheet.lastSyncAt).toLocaleString("es-CO")}
              </p>
            )}
          </>
        )}

        {/* Step 2 — no service account (public sheet fallback) */}
        {step === "share" && !serviceAccountEmail && (
          <div className="mb-4 rounded-2xl bg-amber-50 p-4 text-xs text-amber-800 leading-5 space-y-1">
            <p className="font-semibold">La hoja debe ser pública</p>
            <p>Archivo → Compartir → Cualquier persona con el enlace → Lector</p>
            <p className="mt-2">
              Formato: fila 1 como encabezados (Tipo, Monto, Descripcion, Categoria). La columna Tipo debe contener{" "}
              <code className="bg-white px-1 rounded">GASTO</code> o{" "}
              <code className="bg-white px-1 rounded">INGRESO</code>.
            </p>
          </div>
        )}

        {error && (
          <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
        )}
        {headersCreated && (
          <div className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700 space-y-0.5">
            <p className="font-semibold">✓ Columnas creadas en tu hoja</p>
            <p>Abre el Google Sheet, agrega tus datos y vuelve a sincronizar.</p>
          </div>
        )}
        {syncCount !== null && !headersCreated && (
          <p className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            ✓ {syncCount} transacciones importadas correctamente
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            {step === "share" ? "Cerrar" : "Cancelar"}
          </button>

          {step === "url" && (
            <button
              onClick={handleConnect}
              disabled={isPending || !url.trim()}
              className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {isPending ? "Conectando…" : "Conectar"}
            </button>
          )}

          {step === "share" && (
            <button
              onClick={handleSync}
              disabled={isPending}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
              {isPending ? "Sincronizando…" : "Sincronizar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Workspace ───────────────────────────────────────────────────────────

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

  // ── Summary ──
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
      const cat = t.category || "Sin categoría";
      map.set(cat, (map.get(cat) ?? 0) + t.amount);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [transactions]);

  // ── Group by date ──
  const grouped = useMemo(() => {
    const groups = new Map<string, FinanceTransaction[]>();
    for (const t of transactions) {
      const key = formatDateLabel(t.date);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    return Array.from(groups.entries());
  }, [transactions]);

  // ── Submit handler ──
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setParseError(null);
    const parsed = parseTransactionText(input);
    if (!parsed) {
      setParseError(
        'No pude entenderlo. Prueba: "gasto 500 supermercado" o "ingreso 2000 salario"',
      );
      return;
    }

    const fd = new FormData();
    fd.append("type", parsed.type);
    fd.append("amount", String(parsed.amount));
    fd.append("description", parsed.description);

    // Optimistic
    const optimisticId = `temp-${Date.now()}`;
    const optimistic: FinanceTransaction = {
      id: optimisticId,
      type: parsed.type,
      amount: parsed.amount,
      description: parsed.description,
      category: null,
      date: new Date().toISOString(),
      source: "manual",
      createdAt: new Date().toISOString(),
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
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white px-5 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Módulo
          </p>
          <h1 className="text-xl font-bold tracking-[-0.04em] text-slate-900">Finanzas</h1>
        </div>
        <button
          onClick={() => setShowSheet(true)}
          className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-emerald-400 hover:text-emerald-700"
        >
          <Sheet className="h-4 w-4" />
          {googleSheet ? "Sheet conectado" : "Conectar Google Sheet"}
        </button>
      </div>

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Chat feed */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div ref={feedRef} className="flex-1 overflow-y-auto px-5 py-4">
            {transactions.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center py-16">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-50 text-emerald-300">
                  <Wallet className="h-8 w-8" />
                </div>
                <p className="text-base font-semibold text-slate-700">
                  Empieza a registrar tus finanzas
                </p>
                <p className="mt-1 max-w-xs text-sm text-slate-400">
                  Escribe un mensaje como{" "}
                  <span className="font-medium text-slate-600">&quot;gasto 500 supermercado&quot;</span> o{" "}
                  <span className="font-medium text-slate-600">&quot;ingreso 2000 salario&quot;</span>
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {grouped.map(([dateLabel, txs]) => (
                  <div key={dateLabel}>
                    <div className="mb-3 flex items-center gap-3">
                      <div className="h-px flex-1 bg-slate-100" />
                      <span className="text-[11px] font-semibold text-slate-400">{dateLabel}</span>
                      <div className="h-px flex-1 bg-slate-100" />
                    </div>
                    <div className="space-y-2">
                      {txs.map((t) => (
                        <div
                          key={t.id}
                          className={`flex ${t.type === "INCOME" ? "justify-end" : "justify-start"}`}
                        >
                          <div className="group relative max-w-[80%]">
                            <div
                              className={`rounded-2xl px-4 py-3 ${
                                t.type === "INCOME"
                                  ? "rounded-tr-sm bg-emerald-500 text-white"
                                  : "rounded-tl-sm bg-white text-slate-800 shadow-sm ring-1 ring-slate-100"
                              }`}
                            >
                              <div className="flex items-baseline gap-2">
                                <span
                                  className={`text-lg font-bold leading-none ${
                                    t.type === "INCOME" ? "text-white" : "text-rose-600"
                                  }`}
                                >
                                  {t.type === "INCOME" ? "+" : "−"}
                                  {formatCurrency(t.amount)}
                                </span>
                                {t.source === "google_sheet" && (
                                  <span
                                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                                      t.type === "INCOME"
                                        ? "bg-white/20 text-white"
                                        : "bg-slate-100 text-slate-500"
                                    }`}
                                  >
                                    Sheet
                                  </span>
                                )}
                              </div>
                              <p
                                className={`mt-0.5 text-sm ${
                                  t.type === "INCOME" ? "text-emerald-100" : "text-slate-600"
                                }`}
                              >
                                {t.description}
                              </p>
                              {t.category && (
                                <span
                                  className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                    t.type === "INCOME"
                                      ? "bg-white/20 text-white"
                                      : "bg-slate-100 text-slate-500"
                                  }`}
                                >
                                  {t.category}
                                </span>
                              )}
                              <p
                                className={`mt-1 text-[10px] ${
                                  t.type === "INCOME" ? "text-emerald-200" : "text-slate-400"
                                }`}
                              >
                                {formatTime(t.date)}
                              </p>
                            </div>
                            {/* Delete button */}
                            <button
                              onClick={() => handleDelete(t.id)}
                              className={`absolute -top-2 hidden h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white shadow group-hover:flex ${
                                t.type === "INCOME" ? "-left-2" : "-right-2"
                              }`}
                            >
                              <Trash2 className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="shrink-0 border-t border-slate-100 bg-white px-5 py-3">
            {parseError && (
              <p className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">
                {parseError}
              </p>
            )}
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setParseError(null);
                }}
                placeholder='Ej: "gasto 500 supermercado" o "ingreso 2000 salario"'
                className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:outline-none"
                disabled={isPending}
              />
              <button
                type="submit"
                disabled={isPending || !input.trim()}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>

        {/* ── Summary panel ── */}
        <div className="w-64 shrink-0 overflow-y-auto border-l border-slate-100 bg-slate-50 p-4 space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Resumen
          </p>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
            <div className="mb-1 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              <span className="text-xs font-medium text-slate-500">Ingresos</span>
            </div>
            <p className="text-lg font-bold text-emerald-600">{formatCurrency(summary.income)}</p>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
            <div className="mb-1 flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-rose-500" />
              <span className="text-xs font-medium text-slate-500">Gastos</span>
            </div>
            <p className="text-lg font-bold text-rose-600">{formatCurrency(summary.expense)}</p>
          </div>

          <div
            className={`rounded-2xl p-4 shadow-sm ${
              summary.balance >= 0 ? "bg-emerald-500" : "bg-rose-500"
            }`}
          >
            <div className="mb-1 flex items-center gap-2">
              <Wallet className="h-4 w-4 text-white/80" />
              <span className="text-xs font-medium text-white/80">Balance</span>
            </div>
            <p className="text-lg font-bold text-white">{formatCurrency(summary.balance)}</p>
          </div>

          {topCategories.length > 0 && (
            <div className="pt-1">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Top gastos
              </p>
              <div className="space-y-1.5">
                {topCategories.map(([cat, amount]) => (
                  <div
                    key={cat}
                    className="rounded-xl bg-white px-3 py-2 shadow-sm ring-1 ring-slate-100"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-slate-600">{cat}</span>
                      <span className="shrink-0 text-xs font-semibold text-rose-600">
                        {formatCurrency(amount)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {transactions.length > 0 && (
            <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-100">
              <p className="text-[10px] text-slate-400">
                {transactions.length} transacciones registradas
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Google Sheet Dialog ── */}
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
