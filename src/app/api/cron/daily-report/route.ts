import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import {
  generateDailyReportsForEnabledWorkspaces,
  parseBogotaDate,
} from "@/features/reportes/services/daily-report";

export const dynamic = "force-dynamic";

/*
  Vale CUALQUIERA de los secretos configurados.

  Antes se tomaba solo el primero configurado (DAILY_REPORT_CRON_SECRET) y la primera cabecera que
  viniera: si el reloj mandaba otro secreto (FOLLOW_CRON_SECRET) o en otra cabecera, respondia
  401 y el informe no salia. Ahora se acepta cualquiera de la lista, sin vacios, en cualquiera de
  las cabeceras de siempre.
*/
function resolveCronSecrets() {
  return [
    process.env.DAILY_REPORT_CRON_SECRET,
    process.env.FOLLOW_CRON_SECRET,
    process.env.EVOLUTION_WEBHOOK_SECRET,
  ]
    .map((value) => stripBearer(value?.trim() ?? ""))
    .filter((value) => value.length > 0);
}

/** Todas las cabeceras que hoy se aceptan, no solo la primera que venga. */
function readIncomingSecrets(request: Request) {
  return [
    request.headers.get("x-daily-report-secret"),
    request.headers.get("x-follow-cron-secret"),
    request.headers.get("x-webhook-secret"),
    request.headers.get("authorization"),
  ]
    .map((value) => stripBearer(value?.trim() ?? ""))
    .filter((value) => value.length > 0);
}

function stripBearer(value: string) {
  return value.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : value;
}

/** Comparacion en tiempo constante: se comparan los sha256, que siempre miden lo mismo. */
function sameSecret(a: string, b: string) {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

function isAuthorized(expected: string[], received: string[]) {
  let ok = false;
  for (const secret of expected) {
    for (const candidate of received) {
      // Sin cortar al primer acierto: el tiempo no dice cual coincidio.
      if (sameSecret(secret, candidate)) ok = true;
    }
  }
  return ok;
}

/** Hora y minuto actuales en America/Bogota (UTC-5, sin DST). */
function nowInBogota() {
  const local = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return { hour: local.getUTCHours(), minute: local.getUTCMinutes() };
}

async function handleCron(request: Request) {
  const expectedSecrets = resolveCronSecrets();
  const receivedSecrets = readIncomingSecrets(request);

  if (expectedSecrets.length > 0) {
    if (receivedSecrets.length === 0 || !isAuthorized(expectedSecrets, receivedSecrets)) {
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
