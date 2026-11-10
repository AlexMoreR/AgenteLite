import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { esquemaDelLote } from "@/features/mensajes-indescifrables/dominio/reglas";
import { registrarLote } from "@/features/mensajes-indescifrables/servicios/registro";

export const dynamic = "force-dynamic";

/*
  Por acá entran los mensajes que WAHA no pudo descifrar, desde el vigilante que lee su log
  (docker/vigilante-indescifrables). Secreto propio, INDESCIFRABLES_SECRET: sin él configurado se
  rechaza todo (falla cerrado), para que nadie pueda llenar la bandeja de chats "perdidos" inventados.
  La comparación es en tiempo constante (mismo criterio que cron/pauta).
*/
function iguales(a: string, b: string) {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

function autorizado(request: Request) {
  const esperado = (process.env.INDESCIFRABLES_SECRET ?? "").trim().replace(/^Bearer /, "");
  if (!esperado) return false;
  const recibido = (request.headers.get("x-indescifrables-secret") || request.headers.get("authorization") || "")
    .trim()
    .replace(/^Bearer /, "");
  return Boolean(recibido) && iguales(recibido, esperado);
}

export async function POST(request: Request) {
  if (!autorizado(request)) return NextResponse.json({ ok: false }, { status: 401 });
  const cuerpo = await request.json().catch(() => null);
  const lote = esquemaDelLote.safeParse(cuerpo);
  if (!lote.success) {
    return NextResponse.json({ ok: false, error: "Lote inválido", detalle: lote.error.issues.slice(0, 5) }, { status: 400 });
  }
  const resultado = await registrarLote(lote.data);
  return NextResponse.json({ ok: true, ...resultado });
}
