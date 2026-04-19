"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import {
  appendFinanceSheetRow,
  ensureSheetHeaders,
  readSheetRows,
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

  const [transactions, agentConfig, googleSheet] = await Promise.all([
    prisma.financeTransaction.findMany({
      where: { workspaceId },
      orderBy: { date: "desc" },
      take: 60,
      select: { id: true, type: true, amount: true, description: true, category: true, date: true },
    }),
    prisma.financeAgentConfig.findUnique({ where: { workspaceId }, select: { systemPrompt: true } }),
    prisma.financeGoogleSheet.findUnique({ where: { workspaceId }, select: { sheetId: true } }),
  ]);

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

  const addedTransactions: TransactionPayload[] = [];
  const deletedIds: string[] = [];

  for (let iter = 0; iter < 6; iter++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
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

    messages.push(msg as OAMessage);

    if (choice.finish_reason === "tool_calls" && msg.tool_calls?.length) {
      for (const toolCall of msg.tool_calls) {
        let result = "";
        try {
          const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;

          if (toolCall.function.name === "register_transaction") {
            const type = args.type as "INCOME" | "EXPENSE";
            const amount = Number(args.amount);
            const description = String(args.description ?? "");
            const category = args.category ? String(args.category) : null;
            const now = new Date();

            const created = await prisma.financeTransaction.create({
              data: { workspaceId, type, amount, description, category, date: now, source: "manual" },
            });

            if (googleSheet && isServiceAccountConfigured()) {
              await appendFinanceSheetRow({ sheetId: googleSheet.sheetId, type, amount, description, category, date: now });
            }

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
            addedTransactions.push(tx);
            result = JSON.stringify({ success: true, id: created.id });
          } else if (toolCall.function.name === "update_transaction") {
            const id = String(args.id);
            const existing = await prisma.financeTransaction.findFirst({
              where: { id, workspaceId },
              select: { type: true, amount: true, description: true, category: true, source: true },
            });
            if (!existing) {
              result = JSON.stringify({ success: false, error: "Transacción no encontrada" });
            } else {
              const newType = (args.type as "INCOME" | "EXPENSE" | undefined) ?? existing.type;
              const newAmount = args.amount != null ? Number(args.amount) : Number(existing.amount);
              const newDescription = args.description != null ? String(args.description) : existing.description;
              const newCategory = args.category != null ? (String(args.category) || null) : existing.category;

              const updated = await prisma.financeTransaction.update({
                where: { id },
                data: { type: newType, amount: newAmount, description: newDescription, category: newCategory },
              });

              if (existing.source === "google_sheet" && googleSheet && isServiceAccountConfigured()) {
                await deleteSheetRowByContent({
                  sheetId: googleSheet.sheetId,
                  description: existing.description,
                  amount: Number(existing.amount),
                  type: existing.type,
                });
                await appendFinanceSheetRow({
                  sheetId: googleSheet.sheetId,
                  type: newType,
                  amount: newAmount,
                  description: newDescription,
                  category: newCategory,
                  date: new Date(),
                });
              }

              deletedIds.push(id);
              addedTransactions.push({
                id: updated.id,
                type: updated.type,
                amount: Number(updated.amount),
                description: updated.description,
                category: updated.category,
                date: updated.date.toISOString(),
                source: updated.source,
                createdAt: updated.createdAt.toISOString(),
              });
              result = JSON.stringify({ success: true, updated: { type: newType, amount: newAmount, description: newDescription } });
            }
          } else if (toolCall.function.name === "delete_transaction") {
            const id = String(args.id);
            const tx = await prisma.financeTransaction.findFirst({
              where: { id, workspaceId },
              select: { source: true, description: true, amount: true, type: true },
            });
            await prisma.financeTransaction.deleteMany({ where: { id, workspaceId } });
            deletedIds.push(id);
            let sheetDeleted = false;
            if (tx?.source === "google_sheet" && googleSheet && isServiceAccountConfigured()) {
              const sheetResult = await deleteSheetRowByContent({
                sheetId: googleSheet.sheetId,
                description: tx.description,
                amount: Number(tx.amount),
                type: tx.type,
              });
              sheetDeleted = sheetResult.rowDeleted;
            }
            result = JSON.stringify({
              success: true,
              deletedFromSheet: tx?.source === "google_sheet" ? sheetDeleted : "n/a",
            });
          } else if (toolCall.function.name === "sync_google_sheet") {
            if (!googleSheet) {
              result = JSON.stringify({ success: false, error: "No hay Google Sheet conectado" });
            } else {
              const beforeIds = (await prisma.financeTransaction.findMany({
                where: { workspaceId },
                select: { id: true },
              })).map((t) => t.id);

              const syncResult = await syncGoogleSheetAction();

              if (syncResult.ok) {
                for (const oldId of beforeIds) deletedIds.push(oldId);
                const newTxs = await prisma.financeTransaction.findMany({
                  where: { workspaceId },
                  orderBy: { date: "asc" },
                  select: { id: true, type: true, amount: true, description: true, category: true, date: true, source: true, createdAt: true },
                });
                for (const t of newTxs) {
                  addedTransactions.push({
                    id: t.id, type: t.type, amount: Number(t.amount),
                    description: t.description, category: t.category,
                    date: t.date.toISOString(), source: t.source, createdAt: t.createdAt.toISOString(),
                  });
                }
                result = JSON.stringify({ success: true, imported: syncResult.count ?? 0 });
              } else {
                result = JSON.stringify({ success: false, error: syncResult.error });
              }
            }
          }
        } catch (e) {
          result = JSON.stringify({ success: false, error: String(e) });
        }

        messages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
      }
      continue;
    }

    const reply = msg.content ?? "Listo.";

    await prisma.financeChatMessage.createMany({
      data: [
        { workspaceId, role: "user", content: userMessage },
        { workspaceId, role: "assistant", content: reply },
      ],
    });

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

  let sheetSync: "synced" | "skipped" | "failed" = "skipped";

  const sheet = await prisma.financeGoogleSheet.findUnique({
    where: { workspaceId: membership.workspace.id },
    select: { sheetId: true },
  });

  if (sheet && isServiceAccountConfigured()) {
    const appendResult = await appendFinanceSheetRow({
      sheetId: sheet.sheetId,
      type,
      amount,
      description,
      category,
      date: transactionDate,
    });

    if (appendResult.ok) {
      sheetSync = "synced";
      await prisma.financeGoogleSheet.update({
        where: { workspaceId: membership.workspace.id },
        data: { lastSyncAt: new Date() },
      });
    } else {
      sheetSync = "failed";
      console.error(
        "[Finanzas] No se pudo guardar la transacción en Google Sheets:",
        appendResult.error,
      );
    }
  }

  revalidatePath("/cliente/finanzas");
  return {
    ok: true,
    transaction: {
      id: created.id,
      type: created.type,
      amount: Number(created.amount),
      description: created.description,
      category: created.category,
      date: created.date.toISOString(),
      source: created.source,
      createdAt: created.createdAt.toISOString(),
    },
    sheetSync,
  };
}

export async function deleteTransactionAction(id: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "No autorizado" };

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) return { ok: false, error: "Workspace no encontrado" };

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
    rows = await readSheetRows(sheet.sheetId);
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
