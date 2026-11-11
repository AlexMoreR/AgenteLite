import { createHash, timingSafeEqual } from "node:crypto";

/*
  El secreto del reloj (los cron del servidor): el mismo criterio que cron/pauta y cron/daily-report.
  Sirve cualquiera de los secretos de siempre, en cualquiera de las cabeceras de siempre, y se compara
  con timingSafeEqual sobre el hash (así el largo no importa y no se filtra por el tiempo de respuesta).
  Sin ningún secreto configurado, nadie pasa.
*/

function secretos() {
  return [process.env.DAILY_REPORT_CRON_SECRET, process.env.FOLLOW_CRON_SECRET, process.env.EVOLUTION_WEBHOOK_SECRET]
    .map((v) => (v ?? "").trim().replace(/^Bearer /, ""))
    .filter(Boolean);
}

function iguales(a: string, b: string) {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function autorizadoPorElReloj(headers: { get: (nombre: string) => string | null }): boolean {
  const esperados = secretos();
  if (!esperados.length) return false;
  const recibidos = [
    headers.get("x-daily-report-secret"),
    headers.get("x-follow-cron-secret"),
    headers.get("x-webhook-secret"),
    headers.get("authorization"),
  ]
    .map((v) => (v ?? "").trim().replace(/^Bearer /, ""))
    .filter(Boolean);
  return recibidos.some((r) => esperados.some((e) => iguales(r, e)));
}
