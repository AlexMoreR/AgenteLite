import { createSign } from "node:crypto";

export const SHEET_HEADERS = ["TIPO", "MONTO", "DESCRIPCION", "CATEGORIA", "FECHA", "HORA"];

export const SERVICE_ACCOUNT_EMAIL =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null;

function formatSheetDateParts(date: Date): { sheetDate: string; sheetTime: string } {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    sheetDate: `${get("year")}-${get("month")}-${get("day")}`,
    sheetTime: `${get("hour")}:${get("minute")}:${get("second")}`,
  };
}

// ── Base64url (compatible with all Node versions) ────────────────────────────

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ── JWT / Token ──────────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string | null> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) return null;

  let jwt: string;
  try {
    // Normalize \n literals that come from .env files
    const privateKey = rawKey.replace(/\\n/g, "\n");
    const now = Math.floor(Date.now() / 1000);

    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(
      JSON.stringify({
        iss: email,
        scope: "https://www.googleapis.com/auth/spreadsheets",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    );

    const sigInput = `${header}.${claims}`;
    const signer = createSign("RSA-SHA256");
    signer.update(sigInput);
    // Use base64 then convert to base64url (works on all Node versions)
    const sig = signer
      .sign(privateKey, "base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    jwt = `${sigInput}.${sig}`;
  } catch (err) {
    console.error("[Google Auth] JWT signing error:", err);
    return null;
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error_description?: string };
      console.error("[Google Auth] token exchange failed:", res.status, body);
      return null;
    }
    const data = await res.json() as { access_token?: string };
    return data.access_token ?? null;
  } catch (err) {
    console.error("[Google Auth] network error:", err);
    return null;
  }
}

// ── API helpers (propagate real error messages) ───────────────────────────────

type ApiResult<T> = { data: T; error: null } | { data: null; error: string };

async function sheetsGet(
  token: string,
  sheetId: string,
  range: string,
): Promise<ApiResult<string[][]>> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
      const msg = body.error?.message ?? `HTTP ${res.status}`;
      console.error(`[Sheets GET] ${res.status}:`, msg);
      return { data: null, error: msg };
    }
    const data = await res.json() as { values?: string[][] };
    return { data: data.values ?? [], error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error de red";
    return { data: null, error: msg };
  }
}

async function sheetsPut(
  token: string,
  sheetId: string,
  range: string,
  values: string[][],
): Promise<ApiResult<true>> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ range, values }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
      const msg = body.error?.message ?? `HTTP ${res.status}`;
      console.error(`[Sheets PUT] ${res.status}:`, msg);
      return { data: null, error: msg };
    }
    return { data: true, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error de red";
    return { data: null, error: msg };
  }
}

async function getFirstSheetTabId(token: string, spreadsheetId: string): Promise<number> {
  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.sheetId`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as {
      sheets?: Array<{ properties?: { sheetId?: number } }>;
    };
    return data.sheets?.[0]?.properties?.sheetId ?? 0;
  } catch {
    return 0;
  }
}

async function sheetsBatchUpdate(
  token: string,
  sheetId: string,
  requests: unknown[],
): Promise<ApiResult<true>> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      const msg = body.error?.message ?? `HTTP ${res.status}`;
      return { data: null, error: msg };
    }
    return { data: true, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "Error de red" };
  }
}

async function sheetsAppend(
  token: string,
  sheetId: string,
  range: string,
  values: string[][],
): Promise<ApiResult<true>> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ range, values }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      const msg = body.error?.message ?? `HTTP ${res.status}`;
      console.error(`[Sheets APPEND] ${res.status}:`, msg);
      return { data: null, error: msg };
    }
    return { data: true, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error de red";
    return { data: null, error: msg };
  }
}

// ── Sheet row ID helpers ─────────────────────────────────────────────────────

export function makeSheetTxId(rowIndex: number, type: string, amount: number, description: string): string {
  const key = `${rowIndex}|${type}|${amount.toFixed(2)}|${description}`;
  return `sh:${Buffer.from(key).toString("base64url")}`;
}

export function parseSheetTxId(id: string): { type: "INCOME" | "EXPENSE"; amount: number; description: string } | null {
  if (!id.startsWith("sh:")) return null;
  try {
    const key = Buffer.from(id.slice(3), "base64url").toString();
    const parts = key.split("|");
    if (parts.length < 4) return null;
    const [, type, amountStr, ...descParts] = parts;
    const amount = parseFloat(amountStr);
    if (!type || isNaN(amount)) return null;
    return { type: type as "INCOME" | "EXPENSE", amount, description: descParts.join("|") };
  } catch {
    return null;
  }
}

export type ParsedSheetTx = {
  id: string;
  rowIndex: number;
  type: "INCOME" | "EXPENSE";
  amount: number;
  description: string;
  category: string | null;
  date: Date;
};

export function parseOurSheetFormat(rows: string[][]): ParsedSheetTx[] {
  if (!rows || rows.length < 2) return [];
  const result: ParsedSheetTx[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => !c?.trim())) continue;
    const tipo = (row[0] ?? "").trim().toUpperCase();
    const monto = parseFloat((row[1] ?? "0").replace(",", "."));
    const desc = (row[2] ?? "").trim();
    const cat = (row[3] ?? "").trim() || null;
    const fecha = (row[4] ?? "").trim();
    const hora = (row[5] ?? "").trim();

    const type = tipo === "INGRESO" ? "INCOME" : tipo === "GASTO" ? "EXPENSE" : null;
    if (!type || !monto || monto <= 0 || !desc) continue;

    let date: Date;
    try {
      date = fecha ? new Date(`${fecha}T${hora || "00:00:00"}`) : new Date();
      if (isNaN(date.getTime())) date = new Date();
    } catch {
      date = new Date();
    }

    result.push({ id: makeSheetTxId(i, type, monto, desc), rowIndex: i, type, amount: monto, description: desc, category: cat, date });
  }
  return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function isServiceAccountConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  );
}

export async function ensureSheetHeaders(sheetId: string): Promise<{
  ok: boolean;
  headersWritten: boolean;
  error?: string;
}> {
  const token = await getAccessToken();
  if (!token) {
    return {
      ok: false,
      headersWritten: false,
      error: "No se pudo obtener el token de Google. Verifica GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY en tu .env",
    };
  }

  const { data: firstRow, error: readErr } = await sheetsGet(token, sheetId, "A1:F1");
  if (readErr) {
    return {
      ok: false,
      headersWritten: false,
      error: `Sin acceso a la hoja (${readErr}). Comparte con permisos de Editor para: ${SERVICE_ACCOUNT_EMAIL}`,
    };
  }

  const hasHeaders = (firstRow?.[0] ?? []).some(
    (cell) => cell.trim().length > 0 && !/^\d+([.,]\d+)?$/.test(cell.trim()),
  );

  const normalizedFirstRow = (firstRow?.[0] ?? []).map((cell) => cell.trim().toUpperCase());
  const hasLegacyHeaders =
    normalizedFirstRow.length >= 4 &&
    normalizedFirstRow[0] === "TIPO" &&
    normalizedFirstRow[1] === "MONTO" &&
    normalizedFirstRow[2] === "DESCRIPCION" &&
    normalizedFirstRow[3] === "CATEGORIA" &&
    normalizedFirstRow.length < SHEET_HEADERS.length;

  if (!hasHeaders || hasLegacyHeaders) {
    const { error: writeErr } = await sheetsPut(token, sheetId, "A1:F1", [SHEET_HEADERS]);
    if (writeErr) {
      return {
        ok: false,
        headersWritten: false,
        error: `No se pudieron escribir los encabezados (${writeErr}). Asegúrate de dar permisos de Editor a: ${SERVICE_ACCOUNT_EMAIL}`,
      };
    }
    return { ok: true, headersWritten: true };
  }

  return { ok: true, headersWritten: false };
}

export async function readSheetRows(sheetId: string): Promise<string[][] | null> {
  const token = await getAccessToken();
  if (!token) return null;
  const { data } = await sheetsGet(token, sheetId, "A:F");
  return data;
}

export async function deleteSheetRowByContent(input: {
  sheetId: string;
  description: string;
  amount: number;
  type: "INCOME" | "EXPENSE";
}): Promise<{ ok: boolean; rowDeleted: boolean; error?: string }> {
  const token = await getAccessToken();
  if (!token) return { ok: false, rowDeleted: false, error: "No se pudo obtener token de Google" };

  const { data: rows, error: readErr } = await sheetsGet(token, input.sheetId, "A:F");
  if (readErr || !rows) return { ok: false, rowDeleted: false, error: readErr ?? "Error leyendo hoja" };

  const typeStr = input.type === "INCOME" ? "INGRESO" : "GASTO";

  let matchIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowType = (row[0] ?? "").trim().toUpperCase();
    const rowAmount = parseFloat((row[1] ?? "0").replace(",", "."));
    const rowDesc = (row[2] ?? "").trim().toLowerCase();
    if (
      rowType === typeStr &&
      rowDesc === input.description.toLowerCase() &&
      Math.abs(rowAmount - input.amount) < 0.02
    ) {
      matchIndex = i;
      break;
    }
  }

  if (matchIndex === -1) return { ok: true, rowDeleted: false };

  const tabId = await getFirstSheetTabId(token, input.sheetId);

  const { error } = await sheetsBatchUpdate(token, input.sheetId, [
    {
      deleteDimension: {
        range: { sheetId: tabId, dimension: "ROWS", startIndex: matchIndex, endIndex: matchIndex + 1 },
      },
    },
  ]);

  if (error) return { ok: false, rowDeleted: false, error };
  return { ok: true, rowDeleted: true };
}

export async function appendFinanceSheetRow(input: {
  sheetId: string;
  type: "INCOME" | "EXPENSE";
  amount: number;
  description: string;
  category?: string | null;
  date?: Date;
}): Promise<{ ok: boolean; error?: string }> {
  const token = await getAccessToken();
  if (!token) {
    return {
      ok: false,
      error: "No se pudo obtener el token de Google. Verifica GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY en tu .env",
    };
  }

  const headerResult = await ensureSheetHeaders(input.sheetId);
  if (!headerResult.ok) {
    return { ok: false, error: headerResult.error };
  }

  const txDate = input.date ?? new Date();
  const { sheetDate, sheetTime } = formatSheetDateParts(txDate);
  const row = [
    input.type === "INCOME" ? "INGRESO" : "GASTO",
    input.amount.toFixed(2),
    input.description,
    input.category ?? "",
    sheetDate,
    sheetTime,
  ];

  const { error } = await sheetsAppend(token, input.sheetId, "A:F", [row]);
  if (error) {
    return {
      ok: false,
      error: `No se pudo escribir en Google Sheets (${error}). Asegúrate de dar permisos de Editor a: ${SERVICE_ACCOUNT_EMAIL}`,
    };
  }

  return { ok: true };
}
