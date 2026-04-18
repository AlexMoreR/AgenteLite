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
} from "@/lib/google-sheets";

type ActionResult = { ok: true; count?: number } | { ok: false; error: string };

export async function addTransactionAction(formData: FormData): Promise<ActionResult> {
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

  await prisma.financeTransaction.create({
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
      await prisma.financeGoogleSheet.update({
        where: { workspaceId: membership.workspace.id },
        data: { lastSyncAt: new Date() },
      });
    } else {
      console.error(
        "[Finanzas] No se pudo guardar la transacción en Google Sheets:",
        appendResult.error,
      );
    }
  }

  revalidatePath("/cliente/finanzas");
  return { ok: true };
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
    prisma.financeTransaction.deleteMany({ where: { workspaceId, source: "google_sheet" } }),
    prisma.financeTransaction.createMany({ data: toCreate }),
    prisma.financeGoogleSheet.update({ where: { workspaceId }, data: { lastSyncAt: new Date() } }),
  ]);

  revalidatePath("/cliente/finanzas");
  return { ok: true, count: toCreate.length };
}
