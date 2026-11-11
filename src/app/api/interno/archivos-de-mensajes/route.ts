import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { baseDeProduccion } from "@/features/archivos-de-mensajes/servicios/base-de-produccion";
import { migrarTanda } from "@/features/archivos-de-mensajes/servicios/migrar-tanda";

export const dynamic = "force-dynamic";

/*
  Migracion de los archivos viejos (base64 de Message.rawPayload -> /uploads/chat-media). Corre
  ADENTRO de la app porque la imagen de produccion no trae scripts/ y este proceso es el que tiene el
  volumen que sirve /uploads. Cada llamada hace UNA tanda chica y responde un JSON; la llama por tandas
  scripts/migrar-archivos-de-mensajes.mjs. No la llama ningun reloj.

  Por defecto es una SIMULACION (no escribe nada): para migrar de verdad hay que mandar
  `"simulacion": false`. Parametros (JSON o query): simulacion, tanda (<= 50), presupuestoMs (<= 15000),
  desdeId. Mismos secretos que el reloj (cron/pauta); sin secreto configurado, no atiende a nadie.
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

function leerBooleano(valor: unknown): boolean | undefined {
  if (valor === false || valor === "false" || valor === "0" || valor === "no") return false;
  if (valor === true || valor === "true" || valor === "1" || valor === "si") return true;
  return undefined;
}

export async function POST(request: Request) {
  if (!autorizado(request)) return NextResponse.json({ ok: false }, { status: 401 });

  const consulta = new URL(request.url).searchParams;
  const cuerpo = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const leer = (clave: string) => cuerpo?.[clave] ?? consulta.get(clave) ?? undefined;

  try {
    const resultado = await migrarTanda(
      {
        // Solo `false` explicito migra de verdad.
        simulacion: leerBooleano(leer("simulacion")) !== false,
        tanda: Number(leer("tanda")) || undefined,
        presupuestoMs: Number(leer("presupuestoMs")) || undefined,
        desdeId: typeof leer("desdeId") === "string" ? (leer("desdeId") as string) : null,
      },
      { base: baseDeProduccion },
    );
    return NextResponse.json({ ok: true, ...resultado });
  } catch (error) {
    console.error("[archivos-de-mensajes] la tanda fallo", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
