"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import {
  appendFinanceSheetRow,
  ensureSheetHeaders,
  fetchFinanceSheetRows,
  parseFinanceSheetRows,
  isServiceAccountConfigured,
  deleteSheetRowByContent,
} from "@/lib/google-sheets";
import { formatMoney } from "@/lib/currency";
import { DEFAULT_FINANCE_SYSTEM_PROMPT } from "@/features/finanzas/constants";

type ActionResult = { ok: true; count?: number } | { ok: false; error: string };

type OAMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "tool"; tool_call_id: string; content: string };

type OAToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

const OPENAI_TOOLS = [
  {
    type: "function",
    function: {
      name: "register_transaction",
      description: "Registra un ingreso o gasto. Si hay Google Sheet conectado, también lo agrega a la hoja.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["INCOME", "EXPENSE"], description: "Tipo de transacción" },
          amount: { type: "number", description: "Monto positivo" },
          description: { type: "string", description: "Descripción corta" },
          category: { type: "string", description: "Categoría opcional" },
          date: { type: "string", description: "Fecha ISO o YYYY-MM-DD (opcional)" },
        },
        required: ["type", "amount", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_transaction",
      description: "Elimina una transacción por su ID. Si la transacción es de Google Sheet (source=google_sheet), también la elimina de la hoja.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID de la transacción a eliminar" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_transaction",
      description: "Corrige el monto, descripción, tipo o categoría de una transacción existente. Usar cuando el usuario dice que algo estaba mal.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID de la transacción a actualizar" },
          type: { type: "string", enum: ["INCOME", "EXPENSE"], description: "Nuevo tipo (opcional)" },
          amount: { type: "number", description: "Nuevo monto positivo (opcional)" },
          description: { type: "string", description: "Nueva descripción (opcional)" },
          category: { type: "string", description: "Nueva categoría (opcional)" },
          date: { type: "string", description: "Nueva fecha ISO o YYYY-MM-DD (opcional)" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "sync_google_sheet",
      description: "Importa o actualiza las transacciones desde Google Sheet. Reemplaza todos los datos previos de la hoja con los actuales.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
] as const;

const SPANISH_MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

function normalizeFinanceText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFinanceDateWithCurrentTime(year: number, monthIndex: number, day: number, reference = new Date()): Date {
  const date = new Date(
    Date.UTC(
      year,
      monthIndex,
      day,
      reference.getUTCHours(),
      reference.getUTCMinutes(),
      reference.getUTCSeconds(),
      reference.getUTCMilliseconds(),
    ),
  );
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function extractFinanceDateFromText(text: string): Date | null {
  const normalized = normalizeFinanceText(text);

  const fullDateMatch = normalized.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if (fullDateMatch) {
    const day = Number(fullDateMatch[1]);
    const month = Number(fullDateMatch[2]);
    const year = fullDateMatch[3] ? Number(fullDateMatch[3].length === 2 ? `20${fullDateMatch[3]}` : fullDateMatch[3]) : new Date().getFullYear();
    return buildFinanceDateWithCurrentTime(year, month - 1, day);
  }

  const textDateMatch = normalized.match(
    /\b(?:el\s+)?(\d{1,2})(?:\s+de)?\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?\b/,
  );
  if (!textDateMatch) return null;

  const day = Number(textDateMatch[1]);
  const month = SPANISH_MONTHS[textDateMatch[2]] ?? null;
  if (!month) return null;

  const year = textDateMatch[3] ? Number(textDateMatch[3]) : new Date().getFullYear();
  return buildFinanceDateWithCurrentTime(year, month - 1, day);
}

function extractTargetDateFromText(text: string): Date | null {
  const normalized = normalizeFinanceText(text);

  const targetPatterns = [
    /\b(?:cambia(?:lo|la)?|cambialo|cambiar(?:lo|la)?|cambiarlo|pon(?:lo|la)?|actualiza(?:lo|la)?|modifica(?:lo|la)?|dejalo|dejala|al|a|para\s+el|para\s+la)\s+(?:el\s+)?(\d{1,2})(?:\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre))(?:\s+de\s+(\d{4}))?\b/,
    /\b(?:cambia(?:lo|la)?|cambialo|cambiar(?:lo|la)?|cambiarlo|pon(?:lo|la)?|actualiza(?:lo|la)?|modifica(?:lo|la)?|dejalo|dejala|al|a|para\s+el|para\s+la)\s+(?:el\s+)?(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/,
  ];

  for (const pattern of targetPatterns) {
    const match = normalized.match(pattern);
    if (!match) continue;

    if (match.length >= 4 && match[2] && SPANISH_MONTHS[match[2]]) {
      const day = Number(match[1]);
      const month = SPANISH_MONTHS[match[2]] ?? null;
      const year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : new Date().getFullYear();
      if (!month) continue;
      return buildFinanceDateWithCurrentTime(year, month - 1, day);
    }

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : new Date().getFullYear();
    return buildFinanceDateWithCurrentTime(year, month - 1, day);
  }

  return null;
}

function extractAmountFromText(text: string): number | null {
  const normalized = normalizeFinanceText(text);
  const matches = [
    ...normalized.matchAll(/\b(?:de\s+)?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+)\b/g),
  ].map((match) => match[1]);
  if (!matches.length) return null;

  const lastNumeric = matches[matches.length - 1];
  const cleaned = lastNumeric.replace(/\./g, "").replace(",", ".");
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : null;
}

function extractDayOnlyFromText(text: string): number | null {
  const normalized = normalizeFinanceText(text);
  const match = normalized.match(/\b(?:al\s+)?(?:dia\s+)?(\d{1,2})\b/);
  if (!match) return null;
  const day = Number(match[1]);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

function parseFinanceDateInput(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) {
    const year = Number(ymdMatch[1]);
    const month = Number(ymdMatch[2]);
    const day = Number(ymdMatch[3]);
    return buildFinanceDateWithCurrentTime(year, month - 1, day);
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveRegisterDateFromMessage(message: string, dateArg?: unknown): Date {
  return parseFinanceDateInput(dateArg) ?? extractFinanceDateFromText(message) ?? new Date();
}

function tokenizeFinanceText(text: string): string[] {
  return normalizeFinanceText(text)
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

function resolveTransactionByMessage(
  message: string,
  transactions: TransactionPayload[],
  targetType?: "INCOME" | "EXPENSE",
): TransactionPayload | null {
  if (!transactions.length) return null;

  const normalizedMessage = normalizeFinanceText(message);
  const tokens = tokenizeFinanceText(message);
  const extractedDate = extractFinanceDateFromText(message);
  const extractedAmount = extractAmountFromText(message);

  const scored = transactions
    .map((tx) => {
      const normalizedDescription = normalizeFinanceText(tx.description);
      let score = 0;

      if (targetType && tx.type === targetType) score += 2;

      if (extractedAmount != null && Math.abs(Number(tx.amount) - extractedAmount) < 0.02) {
        score += 3;
      }

      if (extractedDate) {
        const txDate = new Date(tx.date);
        const sameYear = txDate.getUTCFullYear() === extractedDate.getUTCFullYear();
        const sameMonth = txDate.getUTCMonth() === extractedDate.getUTCMonth();
        const sameDay = txDate.getUTCDate() === extractedDate.getUTCDate();
        if (sameYear && sameMonth && sameDay) score += 4;
        else if (sameMonth && sameDay) score += 2;
      }

      for (const token of tokens) {
        if (normalizedDescription.includes(token)) score += 2;
      }

      if (normalizedMessage.includes(normalizedDescription) && normalizedDescription.length >= 4) {
        score += 3;
      }

      if (normalizedMessage.includes("gasto") && tx.type === "EXPENSE") score += 1;
      if (normalizedMessage.includes("ingreso") && tx.type === "INCOME") score += 1;

      return { tx, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || new Date(right.tx.date).getTime() - new Date(left.tx.date).getTime());

  if (!scored.length) return null;
  if (scored.length >= 2 && scored[0].score === scored[1].score) return null;
  return scored[0].tx;
}

function resolveTargetDateFromMessage(message: string, existing: TransactionPayload): Date | null {
  const explicitTargetDate = extractTargetDateFromText(message);
  if (explicitTargetDate) return explicitTargetDate;

  const explicitDate = extractFinanceDateFromText(message);
  if (explicitDate) return explicitDate;

  const dayOnly = extractDayOnlyFromText(message);
  if (!dayOnly) return null;

  const existingDate = new Date(existing.date);
  return buildFinanceDateWithCurrentTime(existingDate.getUTCFullYear(), existingDate.getUTCMonth(), dayOnly);
}

const FINANCE_CONTEXT_PREFIX = "__FINANCE_CONTEXT__:";

type FinancePersistedContext =
  | {
      action: "transaction";
      updatedAt: string;
      transaction: TransactionPayload;
    }
  | {
      action: "clear";
      updatedAt: string;
    };

function serializeFinanceContext(context: FinancePersistedContext): string {
  return `${FINANCE_CONTEXT_PREFIX}${JSON.stringify(context)}`;
}

function parseFinanceContext(content: string): FinancePersistedContext | null {
  if (!content.startsWith(FINANCE_CONTEXT_PREFIX)) return null;
  const raw = content.slice(FINANCE_CONTEXT_PREFIX.length);
  try {
    const parsed = JSON.parse(raw) as Partial<FinancePersistedContext> & {
      transaction?: Partial<TransactionPayload> | null;
    };

    if (parsed?.action === "clear" && typeof parsed.updatedAt === "string") {
      return { action: "clear", updatedAt: parsed.updatedAt };
    }

    if (parsed?.action === "transaction" && typeof parsed.updatedAt === "string" && parsed.transaction?.id) {
      return {
        action: "transaction",
        updatedAt: parsed.updatedAt,
        transaction: {
          id: String(parsed.transaction.id),
          type: parsed.transaction.type === "INCOME" || parsed.transaction.type === "EXPENSE" ? parsed.transaction.type : "EXPENSE",
          amount: Number(parsed.transaction.amount ?? 0),
          description: String(parsed.transaction.description ?? ""),
          category:
            parsed.transaction.category === null || typeof parsed.transaction.category === "string"
              ? parsed.transaction.category
              : null,
          date: String(parsed.transaction.date ?? new Date().toISOString()),
          source: String(parsed.transaction.source ?? "manual"),
          createdAt: String(parsed.transaction.createdAt ?? parsed.updatedAt),
        },
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function getLatestFinanceContext(workspaceId: string): Promise<FinancePersistedContext | null> {
  const latest = await prisma.financeChatMessage.findFirst({
    where: { workspaceId, content: { startsWith: FINANCE_CONTEXT_PREFIX } },
    orderBy: { createdAt: "desc" },
    select: { content: true },
  });

  return latest ? parseFinanceContext(latest.content) : null;
}

async function saveFinanceContext(
  workspaceId: string,
  context: FinancePersistedContext,
): Promise<void> {
  await prisma.financeChatMessage.create({
    data: {
      workspaceId,
      role: "assistant",
      content: serializeFinanceContext(context),
    },
  });
}

type UpdateTransactionDetails = {
  type?: "INCOME" | "EXPENSE";
  amount?: number;
  description?: string;
  category?: string | null;
  date?: Date | null;
};

function isSameUtcCalendarDate(left: string | Date, right: string | Date): boolean {
  const leftDate = new Date(left);
  const rightDate = new Date(right);

  return (
    leftDate.getUTCFullYear() === rightDate.getUTCFullYear() &&
    leftDate.getUTCMonth() === rightDate.getUTCMonth() &&
    leftDate.getUTCDate() === rightDate.getUTCDate()
  );
}

function parseTransactionTypeFromText(value: string | null | undefined): "INCOME" | "EXPENSE" | undefined {
  if (!value) return undefined;
  const normalized = normalizeFinanceText(value);
  if (/(^|\s)(gasto|egreso|expense)(\s|$)/.test(normalized)) return "EXPENSE";
  if (/(^|\s)(ingreso|income)(\s|$)/.test(normalized)) return "INCOME";
  return undefined;
}

function extractUpdateDetailsFromText(text: string): UpdateTransactionDetails {
  const details: UpdateTransactionDetails = {};
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const lineMatch = line.match(/^\s*(?:[✏️🔄🧾📅•-]\s*)?(tipo|monto|descripcion|descripción|fecha|categoria|categoría)\s*:\s*(.+)\s*$/i);
    if (!lineMatch) continue;

    const key = normalizeFinanceText(lineMatch[1]);
    const value = lineMatch[2].trim();

    if (key === "tipo") {
      const type = parseTransactionTypeFromText(value);
      if (type) details.type = type;
      continue;
    }

    if (key === "monto") {
      const cleaned = value.replace(/\./g, "").replace(",", ".");
      const amount = Number(cleaned);
      if (Number.isFinite(amount)) details.amount = amount;
      continue;
    }

    if (key === "descripcion") {
      details.description = value;
      continue;
    }

    if (key === "categoria") {
      details.category = value || null;
      continue;
    }

    if (key === "fecha") {
      details.date = parseFinanceDateInput(value) ?? extractFinanceDateFromText(value);
    }
  }

  return details;
}

function getConfirmedUpdateDetailsFromHistory(
  history: Array<{ role: "user" | "assistant"; content: string }>,
): UpdateTransactionDetails | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message.role !== "assistant") continue;

    const details = extractUpdateDetailsFromText(message.content);
    if (details.type || details.amount != null || details.description || details.category != null || details.date) {
      return details;
    }
  }

  return null;
}

function buildStructuredUpdateContext(
  args: Record<string, unknown>,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
): UpdateTransactionDetails {
  const directDetails = extractUpdateDetailsFromText(
    [
      typeof args.type === "string" ? `Tipo: ${args.type}` : "",
      typeof args.amount === "number" ? `Monto: ${args.amount}` : "",
      typeof args.description === "string" ? `Descripcion: ${args.description}` : "",
      typeof args.category === "string" ? `Categoria: ${args.category}` : "",
      typeof args.date === "string" ? `Fecha: ${args.date}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const affirmativeConfirmation = normalizeFinanceText(userMessage);
  const isAffirmation =
    /^(si|s[ií]|ok|okay|correcto|confirmo|confirmar|dale|adelante|listo|va|sí)$/.test(affirmativeConfirmation) ||
    /(^(si|s[ií])$)/.test(affirmativeConfirmation);

  if (!isAffirmation) {
    return directDetails;
  }

  const confirmedDetails = getConfirmedUpdateDetailsFromHistory(history);
  if (!confirmedDetails) {
    return directDetails;
  }

  return {
    type: confirmedDetails.type ?? directDetails.type,
    amount: confirmedDetails.amount ?? directDetails.amount,
    description: confirmedDetails.description ?? directDetails.description,
    category: confirmedDetails.category ?? directDetails.category,
    date: confirmedDetails.date ?? directDetails.date,
  };
}

function resolveTransactionByDetails(
  transactions: TransactionPayload[],
  details: UpdateTransactionDetails,
): TransactionPayload | null {
  const normalizedDescription = details.description ? normalizeFinanceText(details.description) : "";

  const candidates = transactions.filter((tx) => {
    if (details.type && tx.type !== details.type) return false;
    if (details.amount != null && Math.abs(Number(tx.amount) - details.amount) > 0.02) return false;
    if (details.category != null && tx.category !== details.category) return false;
    if (details.date && !isSameUtcCalendarDate(tx.date, details.date)) return false;

    if (normalizedDescription) {
      const txDescription = normalizeFinanceText(tx.description);
      if (
        txDescription !== normalizedDescription &&
        !txDescription.includes(normalizedDescription) &&
        !normalizedDescription.includes(txDescription)
      ) {
        return false;
      }
    }

    return true;
  });

  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) return null;

  const ranked = candidates
    .map((tx) => {
      let score = 0;
      if (details.type && tx.type === details.type) score += 2;
      if (details.amount != null && Math.abs(Number(tx.amount) - details.amount) < 0.02) score += 3;
      if (details.category != null && tx.category === details.category) score += 1;
      if (details.date && isSameUtcCalendarDate(tx.date, details.date)) score += 4;

      if (normalizedDescription) {
        const txDescription = normalizeFinanceText(tx.description);
        if (txDescription === normalizedDescription) score += 5;
        else if (txDescription.includes(normalizedDescription) || normalizedDescription.includes(txDescription)) score += 3;
      }

      return { tx, score };
    })
    .sort((left, right) => right.score - left.score || new Date(right.tx.date).getTime() - new Date(left.tx.date).getTime());

  if (ranked.length >= 2 && ranked[0].score === ranked[1].score) return null;
  return ranked[0]?.tx ?? null;
}

function transactionPayloadToUpdateDetails(transaction: TransactionPayload): UpdateTransactionDetails {
  return {
    type: transaction.type,
    amount: transaction.amount,
    description: transaction.description,
    category: transaction.category,
    date: transaction.date ? new Date(transaction.date) : null,
  };
}

function buildStructuredSearchText(details: UpdateTransactionDetails): string {
  return [
    details.type ? `tipo ${details.type === "INCOME" ? "ingreso" : "gasto"}` : "",
    details.amount != null ? `monto ${details.amount}` : "",
    details.description ? `descripcion ${details.description}` : "",
    details.category ? `categoria ${details.category}` : "",
    details.date ? `fecha ${details.date.toISOString().slice(0, 10)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function sendFinanceMessageAction(
  userMessage: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<
  | {
      ok: true;
      reply: string;
      addedTransactions: TransactionPayload[];
      deletedIds: string[];
    }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id || !["ADMIN", "CLIENTE"].includes(session.user.role ?? "")) {
    return { ok: false, error: "No autorizado" };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, error: "OpenAI no configurado" };

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return { ok: false, error: "Workspace no encontrado" };

  const workspaceId = membership.workspace.id;
  const debugFinance = process.env.NODE_ENV !== "production";
  const financeLog = (...args: unknown[]) => {
    if (debugFinance) console.info("[finanzas-agent]", ...args);
  };

  const [agentConfig, googleSheet] = await Promise.all([
    prisma.financeAgentConfig.findUnique({ where: { workspaceId }, select: { systemPrompt: true } }),
    prisma.financeGoogleSheet.findUnique({ where: { workspaceId }, select: { sheetId: true } }),
  ]);
  const latestFinanceContext = await getLatestFinanceContext(workspaceId);

  const loadCurrentTransactions = async (): Promise<TransactionPayload[]> => {
    if (googleSheet) {
      const rows = await fetchFinanceSheetRows(googleSheet.sheetId);
      if (rows) {
        return parseFinanceSheetRows(rows).map((t) => ({
          id: t.id,
          type: t.type,
          amount: t.amount,
          description: t.description,
          category: t.category,
          date: t.date.toISOString(),
          source: "google_sheet",
          createdAt: t.date.toISOString(),
        }));
      }
    }

    const prismaTransactions = await prisma.financeTransaction.findMany({
      where: { workspaceId },
      orderBy: { date: "desc" },
      take: 60,
      select: { id: true, type: true, amount: true, description: true, category: true, date: true, source: true, createdAt: true },
    });

    return prismaTransactions.map((t) => ({
      id: t.id,
      type: t.type,
      amount: Number(t.amount),
      description: t.description,
      category: t.category,
      date: t.date.toISOString(),
      source: t.source,
      createdAt: t.createdAt.toISOString(),
    })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  };

  let transactions = await loadCurrentTransactions();

  const currency = "COP";

  const txSummary = transactions.length
    ? transactions
        .map(
          (t) =>
            `[${t.id}] ${t.type === "INCOME" ? "INGRESO" : "GASTO"} ${formatMoney(Number(t.amount), currency)} - ${t.description}${t.category ? ` (${t.category})` : ""} ${new Date(t.date).toLocaleDateString("es-CO")}`,
        )
        .join("\n")
    : "Sin transacciones aún.";

  const income = transactions
    .filter((t) => t.type === "INCOME")
    .reduce((s, t) => s + Number(t.amount), 0);
  const expense = transactions
    .filter((t) => t.type === "EXPENSE")
    .reduce((s, t) => s + Number(t.amount), 0);

  const basePrompt = agentConfig?.systemPrompt ?? DEFAULT_FINANCE_SYSTEM_PROMPT;

  const systemContent = `${basePrompt}

--- CONTEXTO ACTUAL ---
Moneda: ${currency}
Balance: ${formatMoney(income - expense, currency)} (Ingresos ${formatMoney(income, currency)} / Gastos ${formatMoney(expense, currency)})
Últimas transacciones (más reciente primero):
${txSummary}
Fecha actual: ${new Date().toLocaleDateString("es-CO")}`;

  const messages: OAMessage[] = [
    { role: "system", content: systemContent },
    ...history.slice(-20),
    { role: "user", content: userMessage },
  ];

  financeLog("request", {
    workspaceId,
    hasGoogleSheet: Boolean(googleSheet),
    hasServiceAccount: isServiceAccountConfigured(),
    userMessage,
    historyCount: history.length,
  });

  const addedTransactions: TransactionPayload[] = [];
  const deletedIds: string[] = [];
  let latestContextTransaction: TransactionPayload | null = null;
  let shouldClearContext = false;

  for (let iter = 0; iter < 6; iter++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages,
        tools: OPENAI_TOOLS,
        tool_choice: "auto",
        max_tokens: 512,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: (err as { error?: { message?: string } }).error?.message ?? "Error de OpenAI" };
    }

    const data = (await res.json()) as {
      choices: Array<{
        finish_reason: string;
        message: { role: string; content: string | null; tool_calls?: OAToolCall[] };
      }>;
    };

    const choice = data.choices[0];
    const msg = choice.message;

    financeLog("openai-response", {
      iteration: iter,
      finishReason: choice.finish_reason,
      hasContent: Boolean(msg.content),
      toolCallCount: msg.tool_calls?.length ?? 0,
    });

    messages.push(msg as OAMessage);

    if (choice.finish_reason === "tool_calls" && msg.tool_calls?.length) {
      for (const toolCall of msg.tool_calls) {
        let result = "";
        try {
          const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
          financeLog("tool-call", {
            iteration: iter,
            toolName: toolCall.function.name,
            args,
          });

          if (toolCall.function.name === "register_transaction") {
            const type = args.type as "INCOME" | "EXPENSE";
            const amount = Number(args.amount);
            const description = String(args.description ?? "");
            const category = args.category ? String(args.category) : null;
            const now = resolveRegisterDateFromMessage(userMessage, args.date);
            if (googleSheet) {
              if (!isServiceAccountConfigured()) {
                result = JSON.stringify({
                  success: false,
                  error: "Google Sheet conectado pero no hay credenciales de editor para escribir en la hoja",
                });
                financeLog("register_transaction", {
                  status: "blocked",
                  reason: "missing_service_account",
                  type,
                  amount,
                  description,
                  category,
                  date: now.toISOString(),
                });
              } else {
                const appendResult = await appendFinanceSheetRow({
                  sheetId: googleSheet.sheetId,
                  type,
                  amount,
                  description,
                  category,
                  date: now,
                });

                if (!appendResult.ok) {
                  result = JSON.stringify({ success: false, error: appendResult.error });
                  financeLog("register_transaction", {
                    status: "failed",
                    reason: "append_failed",
                    type,
                    amount,
                    description,
                    category,
                    error: appendResult.error,
                  });
                } else {
                  transactions = await loadCurrentTransactions();
                  const latest = [...transactions]
                    .reverse()
                    .find((tx) =>
                      tx.type === type &&
                      Math.abs(tx.amount - amount) < 0.02 &&
                      tx.description.trim().toLowerCase() === description.trim().toLowerCase() &&
                      (category == null || tx.category === category),
                    );
                  const tx =
                    latest ?? {
                      id: `sh:${Date.now()}`,
                      type,
                      amount,
                      description,
                      category,
                      date: now.toISOString(),
                      source: "google_sheet",
                      createdAt: now.toISOString(),
                    };
                  addedTransactions.push(tx);
                  latestContextTransaction = tx;
                  result = JSON.stringify({ success: true, id: tx.id, source: "google_sheet" });
                  financeLog("register_transaction", {
                    status: "success",
                    type,
                    amount,
                    description,
                    category,
                    transactionId: tx.id,
                    date: now.toISOString(),
                  });
                }
              }
            } else {
              const created = await prisma.financeTransaction.create({
                data: { workspaceId, type, amount, description, category, date: now, source: "manual" },
              });

              const tx: TransactionPayload = {
                id: created.id,
                type: created.type,
                amount: Number(created.amount),
                description: created.description,
                category: created.category,
                date: created.date.toISOString(),
                source: created.source,
                createdAt: created.createdAt.toISOString(),
              };
              transactions = [tx, ...transactions];
              addedTransactions.push(tx);
              latestContextTransaction = tx;
              result = JSON.stringify({ success: true, id: created.id });
              financeLog("register_transaction", {
                status: "success",
                type,
                amount,
                description,
                category,
                date: now.toISOString(),
                transactionId: created.id,
                storage: "prisma_fallback",
              });
            }
          } else if (toolCall.function.name === "update_transaction") {
            const requestedId = String(args.id);
            let existing = transactions.find((tx) => tx.id === requestedId);
            if (!existing) {
              const structuredDetails = buildStructuredUpdateContext(args, history, userMessage);
              const structuredResolved = resolveTransactionByDetails(transactions, structuredDetails);

              if (structuredResolved) {
                existing = structuredResolved;
                financeLog("update_transaction", {
                  status: "resolved_by_details",
                  requestedId,
                  resolvedId: structuredResolved.id,
                  resolvedDescription: structuredResolved.description,
                  resolvedDate: structuredResolved.date,
                });
              } else {
                const contextResolved =
                  latestFinanceContext?.action === "transaction"
                    ? resolveTransactionByDetails(
                        transactions,
                        transactionPayloadToUpdateDetails(latestFinanceContext.transaction),
                      )
                    : null;

                if (contextResolved) {
                  existing = contextResolved;
                  financeLog("update_transaction", {
                    status: "resolved_by_context",
                    requestedId,
                    resolvedId: contextResolved.id,
                    resolvedDescription: contextResolved.description,
                    resolvedDate: contextResolved.date,
                  });
                } else {
                  const fallbackSearchText = buildStructuredSearchText(structuredDetails);
                  const resolved = resolveTransactionByMessage(
                    fallbackSearchText || userMessage,
                    transactions,
                    structuredDetails.type ??
                      (args.type === "INCOME" || args.type === "EXPENSE" ? (args.type as "INCOME" | "EXPENSE") : undefined),
                  );
                  if (resolved) {
                    existing = resolved;
                    financeLog("update_transaction", {
                      status: "resolved_by_message",
                      requestedId,
                      resolvedId: resolved.id,
                      resolvedDescription: resolved.description,
                      resolvedDate: resolved.date,
                    });
                  }
                }
              }
            }
            if (!existing) {
              result = JSON.stringify({ success: false, error: "Transacción no encontrada ❌" });
              financeLog("update_transaction", {
                status: "not_found",
                requestedId,
                userMessage,
              });
            } else {
              const targetId = existing.id;
              const newType = (args.type as "INCOME" | "EXPENSE" | undefined) ?? existing.type;
              const newAmount = args.amount != null ? Number(args.amount) : Number(existing.amount);
              const newDescription = args.description != null ? String(args.description) : existing.description;
              const newCategory = args.category != null ? (String(args.category) || null) : existing.category;
              const requestedDate = parseFinanceDateInput(args.date);
              const targetDate = requestedDate ?? resolveTargetDateFromMessage(userMessage, existing);

              if (googleSheet) {
                if (!isServiceAccountConfigured()) {
                  result = JSON.stringify({
                    success: false,
                    error: "Google Sheet conectado pero no hay credenciales de editor para escribir en la hoja",
                  });
                } else {
                  const deleteResult = await deleteSheetRowByContent({
                    sheetId: googleSheet.sheetId,
                    description: existing.description,
                    amount: Number(existing.amount),
                    type: existing.type,
                  });

                  if (!deleteResult.ok) {
                    result = JSON.stringify({ success: false, error: deleteResult.error ?? "No se pudo actualizar la hoja" });
                  } else {
                    const appendResult = await appendFinanceSheetRow({
                      sheetId: googleSheet.sheetId,
                      type: newType,
                      amount: newAmount,
                      description: newDescription,
                      category: newCategory,
                      date: targetDate ?? new Date(existing.date),
                    });

                    if (!appendResult.ok) {
                      result = JSON.stringify({ success: false, error: appendResult.error ?? "No se pudo actualizar la hoja" });
                    } else {
                      transactions = await loadCurrentTransactions();
                      const updated =
                        [...transactions].reverse().find((tx) =>
                          tx.type === newType &&
                          Math.abs(tx.amount - newAmount) < 0.02 &&
                          tx.description.trim().toLowerCase() === newDescription.trim().toLowerCase() &&
                          (newCategory == null || tx.category === newCategory),
                        ) ?? {
                          id: targetId,
                          type: newType,
                          amount: newAmount,
                          description: newDescription,
                          category: newCategory,
                          date: (targetDate ?? new Date(existing.date)).toISOString(),
                          source: "google_sheet",
                          createdAt: (targetDate ?? new Date(existing.date)).toISOString(),
                        };
                      deletedIds.push(targetId);
                      addedTransactions.push(updated);
                      latestContextTransaction = updated;
                      result = JSON.stringify({ success: true, updated: { type: newType, amount: newAmount, description: newDescription } });
                      financeLog("update_transaction", {
                        status: "success",
                        updatedId: updated.id,
                        targetDate: (targetDate ?? new Date(existing.date)).toISOString(),
                      });
                    }
                  }
                }
              } else {
                const updated = await prisma.financeTransaction.update({
                  where: { id: targetId },
                  data: {
                    type: newType,
                    amount: newAmount,
                    description: newDescription,
                    category: newCategory,
                    ...(targetDate ? { date: targetDate } : {}),
                  },
                });

                deletedIds.push(targetId);
                const tx = {
                  id: updated.id,
                  type: updated.type,
                  amount: Number(updated.amount),
                  description: updated.description,
                  category: updated.category,
                  date: updated.date.toISOString(),
                  source: updated.source,
                  createdAt: updated.createdAt.toISOString(),
                };
                transactions = transactions.map((current) => (current.id === targetId ? tx : current));
                addedTransactions.push(tx);
                latestContextTransaction = tx;
                result = JSON.stringify({ success: true, updated: { type: newType, amount: newAmount, description: newDescription } });
                financeLog("update_transaction", {
                  status: "success",
                  updatedId: updated.id,
                  targetDate: (targetDate ?? new Date(existing.date)).toISOString(),
                  storage: "prisma_fallback",
                });
              }
            }
          } else if (toolCall.function.name === "delete_transaction") {
            const id = String(args.id);
            const tx = transactions.find((current) => current.id === id);
            const structuredDeleteDetails =
              latestFinanceContext?.action === "transaction"
                ? transactionPayloadToUpdateDetails(latestFinanceContext.transaction)
                : null;
            const resolvedTx =
              tx ??
              (structuredDeleteDetails ? resolveTransactionByDetails(transactions, structuredDeleteDetails) : null) ??
              resolveTransactionByMessage(
                userMessage,
                transactions,
                structuredDeleteDetails?.type ??
                  (args.type === "INCOME" || args.type === "EXPENSE" ? (args.type as "INCOME" | "EXPENSE") : undefined),
              );
            if (!resolvedTx) {
              result = JSON.stringify({ success: false, error: "Transacción no encontrada ❌" });
            } else if (googleSheet) {
              if (!isServiceAccountConfigured()) {
                result = JSON.stringify({
                  success: false,
                  error: "Google Sheet conectado pero no hay credenciales de editor para escribir en la hoja",
                });
              } else {
                const sheetResult = await deleteSheetRowByContent({
                  sheetId: googleSheet.sheetId,
                  description: resolvedTx.description,
                  amount: Number(resolvedTx.amount),
                  type: resolvedTx.type,
                });
                if (!sheetResult.ok) {
                  result = JSON.stringify({ success: false, error: sheetResult.error ?? "No se pudo eliminar de la hoja" });
                } else {
                  transactions = transactions.filter((current) => current.id !== resolvedTx.id);
                  deletedIds.push(resolvedTx.id);
                  latestContextTransaction = transactions[0] ?? null;
                  shouldClearContext = !latestContextTransaction;
                  result = JSON.stringify({
                    success: true,
                    deletedFromSheet: sheetResult.rowDeleted,
                  });
                }
              }
            } else {
              await prisma.financeTransaction.deleteMany({ where: { id: resolvedTx.id, workspaceId } });
              transactions = transactions.filter((current) => current.id !== resolvedTx.id);
              deletedIds.push(resolvedTx.id);
              latestContextTransaction = transactions[0] ?? null;
              shouldClearContext = !latestContextTransaction;
              result = JSON.stringify({ success: true, deletedFromSheet: "n/a" });
            }
          } else if (toolCall.function.name === "sync_google_sheet") {
            if (!googleSheet) {
              result = JSON.stringify({ success: false, error: "No hay Google Sheet conectado" });
            } else {
              const beforeIds = transactions.map((t) => t.id);
              const syncResult = await syncGoogleSheetAction();

              if (syncResult.ok) {
                for (const oldId of beforeIds) deletedIds.push(oldId);
                transactions = await loadCurrentTransactions();
                for (const t of transactions) addedTransactions.push(t);
                latestContextTransaction = transactions[0] ?? null;
                shouldClearContext = !latestContextTransaction;
                result = JSON.stringify({ success: true, imported: syncResult.count ?? 0 });
              } else {
                result = JSON.stringify({ success: false, error: syncResult.error });
              }
            }
          }
        } catch (e) {
          result = JSON.stringify({ success: false, error: String(e) });
          financeLog("tool-call-error", {
            iteration: iter,
            toolName: toolCall.function.name,
            error: String(e),
          });
        }

        let parsedResult: { success?: boolean; error?: string } | null = null;
        try {
          parsedResult = JSON.parse(result) as { success?: boolean; error?: string };
        } catch {
          parsedResult = null;
        }

        messages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
        financeLog("tool-result", {
          iteration: iter,
          toolName: toolCall.function.name,
          result: parsedResult,
        });

        if (parsedResult && parsedResult.success === false) {
          const failureMessage =
            toolCall.function.name === "register_transaction"
              ? `No se pudo registrar la transacción: ${parsedResult.error ?? "revisa Google Sheets y permisos."}`
              : toolCall.function.name === "update_transaction"
                ? `No se pudo actualizar la transacción: ${parsedResult.error ?? "revisa Google Sheets y permisos."}`
                : toolCall.function.name === "delete_transaction"
                  ? `No se pudo eliminar la transacción: ${parsedResult.error ?? "revisa Google Sheets y permisos."}`
                  : `No se pudo sincronizar Google Sheets: ${parsedResult.error ?? "revisa la configuración de la hoja."}`;

          return {
            ok: true,
            reply: failureMessage,
            addedTransactions,
            deletedIds,
          };
        }
      }
      continue;
    }

    const reply = msg.content ?? "Listo.";
    financeLog("final-reply", {
      reply,
      addedTransactionsCount: addedTransactions.length,
      deletedIdsCount: deletedIds.length,
    });

    await prisma.financeChatMessage.createMany({
      data: [
        { workspaceId, role: "user", content: userMessage },
        { workspaceId, role: "assistant", content: reply },
      ],
    });

    if (latestContextTransaction) {
      await saveFinanceContext(workspaceId, {
        action: "transaction",
        updatedAt: new Date().toISOString(),
        transaction: latestContextTransaction,
      });
    } else if (shouldClearContext) {
      await saveFinanceContext(workspaceId, {
        action: "clear",
        updatedAt: new Date().toISOString(),
      });
    }

    if (addedTransactions.length || deletedIds.length) {
      revalidatePath("/cliente/finanzas");
    }

    return {
      ok: true,
      reply,
      addedTransactions,
      deletedIds,
    };
  }

  return { ok: false, error: "El agente no pudo completar la solicitud." };
}

export async function saveAgentPromptAction(prompt: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id || !["ADMIN", "CLIENTE"].includes(session.user.role ?? "")) {
    return { ok: false, error: "No autorizado" };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return { ok: false, error: "Workspace no encontrado" };

  await prisma.financeAgentConfig.upsert({
    where: { workspaceId: membership.workspace.id },
    create: { workspaceId: membership.workspace.id, systemPrompt: prompt },
    update: { systemPrompt: prompt },
  });

  revalidatePath("/cliente/finanzas");
  revalidatePath("/cliente/finanzas/asistente");

  return { ok: true };
}

export async function clearChatHistoryAction(): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id || !["ADMIN", "CLIENTE"].includes(session.user.role ?? "")) {
    return { ok: false, error: "No autorizado" };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return { ok: false, error: "Workspace no encontrado" };

  await prisma.financeChatMessage.deleteMany({
    where: { workspaceId: membership.workspace.id },
  });

  revalidatePath("/cliente/finanzas");
  return { ok: true };
}

type TransactionPayload = {
  id: string;
  type: "INCOME" | "EXPENSE";
  amount: number;
  description: string;
  category: string | null;
  date: string;
  source: string;
  createdAt: string;
};

function normalizeTransactionType(value: string): "INCOME" | "EXPENSE" {
  return value === "INCOME" ? "INCOME" : "EXPENSE";
}

export async function addTransactionAction(
  formData: FormData,
): Promise<
  | ({ ok: true; transaction: TransactionPayload; sheetSync: "synced" | "skipped" | "failed" } & {
      count?: number;
    })
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id || !["ADMIN", "CLIENTE"].includes(session.user.role ?? "")) {
    return { ok: false, error: "No autorizado" };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return { ok: false, error: "Workspace no encontrado" };

  const type = formData.get("type")?.toString();
  const amount = parseFloat(formData.get("amount")?.toString() ?? "");
  const description = formData.get("description")?.toString().trim() ?? "";
  const category = formData.get("category")?.toString().trim() || null;
  const transactionDate = new Date();

  if (type !== "INCOME" && type !== "EXPENSE") return { ok: false, error: "Tipo inválido" };
  if (!amount || amount <= 0) return { ok: false, error: "Monto inválido" };
  if (!description) return { ok: false, error: "Descripción requerida" };

  let sheetSync: "synced" | "skipped" | "failed" = "skipped";

  const sheet = await prisma.financeGoogleSheet.findUnique({
    where: { workspaceId: membership.workspace.id },
    select: { sheetId: true, lastSyncAt: true },
  });

  if (sheet) {
    if (!isServiceAccountConfigured()) {
      return { ok: false, error: "Google Sheet conectado pero no hay credenciales de editor para escribir en la hoja" };
    }

    const appendResult = await appendFinanceSheetRow({
      sheetId: sheet.sheetId,
      type,
      amount,
      description,
      category,
      date: transactionDate,
    });

    if (!appendResult.ok) {
      sheetSync = "failed";
      return { ok: false, error: appendResult.error ?? "No se pudo guardar la transacción en Google Sheets" };
    }

    const rows = await fetchFinanceSheetRows(sheet.sheetId);
    const parsed = rows ? parseFinanceSheetRows(rows) : [];
    const latest =
      [...parsed].reverse().find((tx) =>
        tx.type === type &&
        Math.abs(tx.amount - amount) < 0.02 &&
        tx.description.trim().toLowerCase() === description.trim().toLowerCase() &&
        (category == null || tx.category === category),
      ) ?? null;

    await prisma.financeGoogleSheet.update({
      where: { workspaceId: membership.workspace.id },
      data: { lastSyncAt: new Date() },
    });

    sheetSync = "synced";
    const transaction: TransactionPayload = latest
      ? {
          id: latest.id,
          type: normalizeTransactionType(latest.type),
          amount: latest.amount,
          description: latest.description,
          category: latest.category,
          date: latest.date.toISOString(),
          source: "google_sheet",
          createdAt: transactionDate.toISOString(),
        }
      : {
          id: `sh:${Date.now()}`,
          type: normalizeTransactionType(type),
          amount,
          description,
          category,
          date: transactionDate.toISOString(),
          source: "google_sheet",
          createdAt: transactionDate.toISOString(),
        };

    await saveFinanceContext(membership.workspace.id, {
      action: "transaction",
      updatedAt: new Date().toISOString(),
      transaction,
    });

    revalidatePath("/cliente/finanzas");
    return { ok: true, transaction, sheetSync };
  }

  const created = await prisma.financeTransaction.create({
    data: {
      workspaceId: membership.workspace.id,
      type,
      amount,
      description,
      category,
      date: transactionDate,
      source: "manual",
    },
  });

  const transaction: TransactionPayload = {
    id: created.id,
    type: created.type,
    amount: Number(created.amount),
    description: created.description,
    category: created.category,
    date: created.date.toISOString(),
    source: created.source,
    createdAt: created.createdAt.toISOString(),
  };

  await saveFinanceContext(membership.workspace.id, {
    action: "transaction",
    updatedAt: new Date().toISOString(),
    transaction,
  });

  revalidatePath("/cliente/finanzas");
  return {
    ok: true,
    transaction,
    sheetSync,
  };
}

export async function deleteTransactionAction(id: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "No autorizado" };

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return { ok: false, error: "Workspace no encontrado" };

  const sheet = await prisma.financeGoogleSheet.findUnique({
    where: { workspaceId: membership.workspace.id },
    select: { sheetId: true },
  });

  if (sheet) {
    const rows = await fetchFinanceSheetRows(sheet.sheetId);
    const transactions = rows ? parseFinanceSheetRows(rows) : [];
    const existing = transactions.find((current) => current.id === id);

    if (!existing) return { ok: false, error: "Transacción no encontrada ❌" };

    if (!isServiceAccountConfigured()) {
      return { ok: false, error: "Google Sheet conectado pero no hay credenciales de editor para escribir en la hoja" };
    }

    const sheetResult = await deleteSheetRowByContent({
      sheetId: sheet.sheetId,
      description: existing.description,
      amount: Number(existing.amount),
      type: existing.type,
    });

    if (!sheetResult.ok) {
      return { ok: false, error: sheetResult.error ?? "No se pudo eliminar la fila de Google Sheets" };
    }
    revalidatePath("/cliente/finanzas");
    return { ok: true };
  }

  await prisma.financeTransaction.deleteMany({
    where: { id, workspaceId: membership.workspace.id },
  });

  revalidatePath("/cliente/finanzas");
  return { ok: true };
}

export async function connectGoogleSheetAction(
  formData: FormData,
): Promise<ActionResult & { headersCreated?: boolean }> {
  const session = await auth();
  if (!session?.user?.id || !["ADMIN", "CLIENTE"].includes(session.user.role ?? "")) {
    return { ok: false, error: "No autorizado" };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return { ok: false, error: "Workspace no encontrado" };

  const sheetUrl = formData.get("sheetUrl")?.toString().trim() ?? "";
  const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return { ok: false, error: "URL de Google Sheets inválida" };

  const sheetId = match[1];

  // Save first so sheetId is available
  await prisma.financeGoogleSheet.upsert({
    where: { workspaceId: membership.workspace.id },
    create: { workspaceId: membership.workspace.id, sheetUrl, sheetId },
    update: { sheetUrl, sheetId },
  });

  // Headers are written during Sync (when the user has already shared the sheet).
  // At connect time we only save the URL.
  revalidatePath("/cliente/finanzas");
  return { ok: true, headersCreated: false };
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map((c) => c.trim().replace(/^"|"$/g, ""));
}

/** Normalize: lowercase, remove accents */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

type ColumnMap = {
  typeIdx: number;
  amountIdx: number;
  ingressIdx: number;
  egressIdx: number;
  descIdx: number;
  catIdx: number;
};

function detectColumns(headers: string[]): ColumnMap {
  const n = headers.map(norm);

  const find = (keywords: string[]) =>
    n.findIndex((h) => keywords.some((k) => h.includes(k)));

  return {
    typeIdx:    find(["tipo", "type", "movimiento", "transaccion", "clase"]),
    amountIdx:  find(["monto", "valor", "cantidad", "amount", "importe", "total", "precio", "price"]),
    ingressIdx: find(["ingreso", "income", "entrada", "credito", "cobro", "venta", "credit", "haber", "abono"]),
    egressIdx:  find(["gasto", "expense", "egreso", "salida", "debito", "compra", "debit", "debe", "cargo"]),
    descIdx:    find(["descripcion", "detalle", "concepto", "description", "detail", "nota", "referencia", "nombre"]),
    catIdx:     find(["categoria", "category", "rubro", "subcategoria", "etiqueta", "tag"]),
  };
}

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[$€\s]/g, "");
  // Handle 1.000 (thousands) vs 1.50 (decimal)
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
  }
  return parseFloat(cleaned.replace(",", "."));
}

function resolveType(cell: string): "INCOME" | "EXPENSE" | null {
  const v = norm(cell);
  if (["gasto", "expense", "egreso", "salida", "compra", "debito", "cargo"].includes(v)) return "EXPENSE";
  if (["ingreso", "income", "entrada", "venta", "cobro", "credito", "abono"].includes(v)) return "INCOME";
  return null;
}

export async function syncGoogleSheetAction(): Promise<ActionResult & { headersJustCreated?: boolean }> {
  try {
  const session = await auth();
  if (!session?.user?.id || !["ADMIN", "CLIENTE"].includes(session.user.role ?? "")) {
    return { ok: false, error: "No autorizado" };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return { ok: false, error: "Workspace no encontrado" };

  const workspaceId = membership.workspace.id;
  const sheet = await prisma.financeGoogleSheet.findUnique({ where: { workspaceId } });
  if (!sheet) return { ok: false, error: "No hay hoja conectada" };

  // ── Step 1: write headers if missing (requires editor access) ───────────────
  let headersJustCreated = false;
  if (isServiceAccountConfigured()) {
    const hResult = await ensureSheetHeaders(sheet.sheetId);
    if (!hResult.ok) {
      return { ok: false, error: hResult.error ?? "Error al configurar la hoja" };
    }
    headersJustCreated = hResult.headersWritten;
  }

  // ── Step 2: Fetch rows ──────────────────────────────────────────────────────
  // Try Sheets API (service account) first; fall back to public CSV export.
  let rows: string[][] | null = null;

  if (isServiceAccountConfigured()) {
    rows = await fetchFinanceSheetRows(sheet.sheetId);
  }

  if (!rows) {
    // Public CSV fallback
    try {
      const res = await fetch(
        `https://docs.google.com/spreadsheets/d/${sheet.sheetId}/export?format=csv`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!res.ok) {
        return {
          ok: false,
          error:
            "No se pudo acceder al Google Sheet. Verifica que sea público: Archivo → Compartir → Cualquier persona con el enlace.",
        };
      }
      const csv = await res.text();
      rows = csv
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => parseCSVLine(l));
    } catch {
      return { ok: false, error: "Error de red al descargar el Google Sheet." };
    }
  }

  // If headers were just created (or sheet only has the header row), prompt user to add data
  if (!rows || rows.length < 2) {
    if (headersJustCreated) {
      await prisma.financeGoogleSheet.update({ where: { workspaceId }, data: { lastSyncAt: new Date() } });
      revalidatePath("/cliente/finanzas");
      return { ok: true, count: 0, headersJustCreated: true };
    }
    return { ok: false, error: "La hoja no tiene datos. Agrega filas debajo de los encabezados y vuelve a sincronizar." };
  }

  // ── Parse ───────────────────────────────────────────────────────────────────
  const headers = rows[0];
  const cols = detectColumns(headers);

  const hasTwoAmountCols = cols.ingressIdx >= 0 && cols.egressIdx >= 0;
  const hasTypeCol = cols.typeIdx >= 0;
  const hasAmountCol = cols.amountIdx >= 0;

  type NewTx = {
    workspaceId: string;
    type: "INCOME" | "EXPENSE";
    amount: number;
    description: string;
    category: string | null;
    source: string;
  };

  const toCreate: NewTx[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => !c.trim())) continue;

    let type: "INCOME" | "EXPENSE" | null = null;
    let amount = 0;

    if (hasTwoAmountCols) {
      const incVal = parseAmount(row[cols.ingressIdx] ?? "");
      const expVal = parseAmount(row[cols.egressIdx] ?? "");
      if (incVal > 0) { type = "INCOME"; amount = incVal; }
      else if (expVal > 0) { type = "EXPENSE"; amount = expVal; }
    } else if (hasTypeCol && hasAmountCol) {
      type = resolveType(row[cols.typeIdx] ?? "");
      amount = parseAmount(row[cols.amountIdx] ?? "");
    } else if (hasAmountCol) {
      amount = parseAmount(row[cols.amountIdx] ?? "");
      if (amount > 0) type = "INCOME";
      else if (amount < 0) { type = "EXPENSE"; amount = Math.abs(amount); }
    } else {
      // Fallback: col 0 = type, col 1 = amount
      type = resolveType(row[0] ?? "");
      amount = parseAmount(row[1] ?? "");
    }

    if (!type || !amount || amount <= 0) continue;

    let description =
      cols.descIdx >= 0
        ? (row[cols.descIdx] ?? "").trim()
        : (row.find((c, idx) => {
            if (
              [cols.typeIdx, cols.amountIdx, cols.ingressIdx, cols.egressIdx, cols.catIdx].includes(idx)
            )
              return false;
            return c.trim().length > 0 && isNaN(parseAmount(c));
          }) ?? "");

    if (!description) description = type === "INCOME" ? "Ingreso" : "Gasto";

    const category =
      cols.catIdx >= 0 ? (row[cols.catIdx] ?? "").trim() || null : null;

    toCreate.push({ workspaceId, type, amount, description, category, source: "google_sheet" });
  }

  if (!toCreate.length) {
    return {
      ok: false,
      error:
        "No se encontraron filas válidas. Asegúrate de tener datos debajo de los encabezados con TIPO (GASTO o INGRESO) y MONTO.",
    };
  }

  await prisma.$transaction([
    prisma.financeTransaction.deleteMany({ where: { workspaceId } }),
    prisma.financeTransaction.createMany({ data: toCreate }),
    prisma.financeGoogleSheet.update({ where: { workspaceId }, data: { lastSyncAt: new Date() } }),
  ]);

  revalidatePath("/cliente/finanzas");
  return { ok: true, count: toCreate.length };
  } catch (error) {
    console.error("[Finanzas] syncGoogleSheetAction failed:", error);
    return {
      ok: false,
      error: "Ocurrió un error al sincronizar la hoja. Revisa la clave privada de Google Sheets y los permisos del archivo.",
    };
  }
}
