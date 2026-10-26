import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { correrPautaDeTodos } from "@/features/pauta/servicios/correr-pauta";

export const dynamic = "force-dynamic";

/*
  Origen de pauta (una vez al día): crea el origen de cada chat de anuncio, resuelve su campaña con
  Meta (solo lectura) y cruza las ventas pagadas de los últimos 60 días con esos clientes.
  Se llama con cualquiera de los secretos de siempre del reloj (mismo criterio que cron/daily-report).
*/
function secretos() {
  return [process.env.DAILY_REPORT_CRON_SECRET, process.env.FOLLOW_CRON_SECRET, process.env.EVOLUTION_WEBHOOK_SECRET]
    .map((v) => (v ?? "").trim().replace(/^Bearer /, ""))
    .filter(Boolean);
}

function iguales(a: string, b: string) {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

function autorizado(request: Request) {
  const esperados = secretos();
  if (!esperados.length) return false;
  const recibidos = [
    request.headers.get("x-daily-report-secret"),
    request.headers.get("x-follow-cron-secret"),
    request.headers.get("x-webhook-secret"),
    request.headers.get("authorization"),
  ]
    .map((v) => (v ?? "").trim().replace(/^Bearer /, ""))
    .filter(Boolean);
  return recibidos.some((r) => esperados.some((e) => iguales(r, e)));
}

export async function POST(request: Request) {
  if (!autorizado(request)) return NextResponse.json({ ok: false }, { status: 401 });
  const resultados = await correrPautaDeTodos();
  return NextResponse.json({ ok: true, resultados });
}

export const GET = POST;
