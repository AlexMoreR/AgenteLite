import { NextResponse } from "next/server";

import { tomarTarjeta } from "@/features/tableros-inteligentes/services/trabajador";
import { SIN_CACHE, contextoDelPedido, respuestaDeError, sinClave } from "../autenticar";

export const dynamic = "force-dynamic";

/*
  POST /api/trabajador/tablero/tomar — el trabajador pregunta (cada minuto) si hay algo que hacer.

  Cuerpo (opcional): `{ maxParalelo, excluir }`. Pasa a ERROR las que se le vencieron y, si tiene en
  las manos menos de `maxParalelo` (1 si no viene), reclama UNA tarjeta (la que más espera, salvo las
  de `excluir`) en APROBADO, PLAN_APROBADO o SUBIENDO pendiente, de forma atómica. Contesta
  `{ ok, tarjeta: null, motivo: "nada" | "ocupado" }` o `{ ok, tarjeta, hacer: "planear" | "construir" | "subir" }`.
  Ver services/trabajador.ts.
*/
export async function POST(request: Request) {
  const contexto = await contextoDelPedido(request);
  if (!contexto) return sinClave();
  let cuerpo: Record<string, unknown> = {};
  try {
    const leido = await request.json();
    if (leido && typeof leido === "object" && !Array.isArray(leido)) cuerpo = leido as Record<string, unknown>;
  } catch {
    // Sin cuerpo: un trabajador viejo (una a la vez).
  }
  try {
    const respuesta = await tomarTarjeta(contexto, cuerpo);
    return NextResponse.json({ ok: true, trabajador: contexto.nombre, ...respuesta }, { headers: SIN_CACHE });
  } catch (fallo) {
    return respuestaDeError(fallo);
  }
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
