import { NextResponse } from "next/server";

import {
  generateDailyReportsForEnabledWorkspaces,
  parseBogotaDate,
} from "@/features/reportes/services/daily-report";

export const dynamic = "force-dynamic";

function resolveCronSecret() {
  return (
    process.env.DAILY_REPORT_CRON_SECRET?.trim() ||
    process.env.FOLLOW_CRON_SECRET?.trim() ||
    process.env.EVOLUTION_WEBHOOK_SECRET?.trim() ||
    ""
  );
}

function readIncomingSecret(request: Request) {
  return (
    request.headers.get("x-daily-report-secret") ||
    request.headers.get("x-follow-cron-secret") ||
    request.headers.get("x-webhook-secret") ||
    request.headers.get("authorization") ||
    ""
  ).trim();
}

function stripBearer(value: string) {
  return value.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : value;
}

/** Hora y minuto actuales en America/Bogota (UTC-5, sin DST). */
function nowInBogota() {
  const local = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return { hour: local.getUTCHours(), minute: local.getUTCMinutes() };
}

async function handleCron(request: Request) {
  const expectedSecret = resolveCronSecret();
  const receivedSecret = readIncomingSecret(request);

  if (expectedSecret) {
    if (!receivedSecret || stripBearer(receivedSecret) !== stripBearer(expectedSecret)) {
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "DAILY_REPORT_CRON_SECRET no esta configurado" },
      { status: 500 },
    );
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const dateParam = url.searchParams.get("date");
  const date = dateParam ? parseBogotaDate(dateParam) ?? undefined : undefined;

  // Solo dispara automáticamente en la ventana de las 23:59 (Bogota). El sidecar
  // poll cada 60s; la idempotencia (@@unique workspace+día) evita duplicados.
  if (!force) {
    const { hour, minute } = nowInBogota();
    if (!(hour === 23 && minute >= 59)) {
      return NextResponse.json({ ok: true, skipped: true, reason: "fuera de ventana 23:59 Bogota" });
    }
  }

  const result = await generateDailyReportsForEnabledWorkspaces({ date });

  return NextResponse.json({
    ok: true,
    processed: result.processed,
    generated: result.reports.length,
    errors: result.errors,
  });
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
