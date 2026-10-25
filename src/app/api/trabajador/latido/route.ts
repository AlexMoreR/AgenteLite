import { NextResponse } from "next/server";

import { guardarLatido } from "@/features/tableros-inteligentes/services/coordinador-en-vivo";
import { SIN_CACHE, contextoDelPedido, respuestaDeError, sinClave } from "../tablero/autenticar";

export const dynamic = "force-dynamic";

/*
  POST /api/trabajador/latido — el Coordinador del Tablero IA (PC aizen1) manda cada 15 s su estado: las tareas
  que tiene en las manos, la carga del PC, si espera que se desocupe y si Claude llegó a su límite de uso. Misma
  clave que /api/trabajador/tablero/* (Bearer aizen_trab_...). El CRM guarda solo el último (AppSetting) y lo
  muestra en la pestaña "Coordinador en vivo". Si el Coordinador deja de mandarlo más de 2 minutos, el panel dice
  que está apagado. Ver services/coordinador-en-vivo.ts. No es el latido de una tarjeta (/tablero/<id>/latido).
*/
export async function POST(request: Request) {
  const contexto = await contextoDelPedido(request);
  if (!contexto) return sinClave();
  try {
    const cuerpo = await request.json().catch(() => null);
    const guardado = await guardarLatido(contexto, cuerpo);
    return NextResponse.json({ ok: true, ...guardado }, { headers: SIN_CACHE });
  } catch (fallo) {
    return respuestaDeError(fallo);
  }
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
