import { NextResponse } from "next/server";

import { tomarTarjeta } from "@/features/tableros-inteligentes/services/trabajador";
import { SIN_CACHE, contextoDelPedido, respuestaDeError, sinClave } from "../autenticar";

export const dynamic = "force-dynamic";

/*
  POST /api/trabajador/tablero/tomar — el trabajador pregunta (cada minuto) si hay algo que hacer.

  Pasa a ERROR las que se le vencieron y, si no tiene otra en las manos, reclama UNA tarjeta (la que
  más espera) en APROBADO, PLAN_APROBADO o SUBIENDO pendiente, de forma atómica. Contesta
  `{ ok, tarjeta: null, motivo: "nada" | "ocupado" }` o `{ ok, tarjeta, hacer: "planear" | "construir" | "subir" }`.
  Ver services/trabajador.ts.
*/
export async function POST(request: Request) {
  const contexto = await contextoDelPedido(request);
  if (!contexto) return sinClave();
  try {
    const respuesta = await tomarTarjeta(contexto);
    return NextResponse.json({ ok: true, trabajador: contexto.nombre, ...respuesta }, { headers: SIN_CACHE });
  } catch (fallo) {
    return respuestaDeError(fallo);
  }
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
