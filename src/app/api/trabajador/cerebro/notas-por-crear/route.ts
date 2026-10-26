import { NextResponse } from "next/server";

import { ErrorDeNota, marcarNotaPorCrear, notasPendientesParaElTrabajador } from "@/features/cerebro/services/notas-por-crear";
import { SIN_CACHE, contextoDelPedido, respuestaDeError, sinClave } from "../../tablero/autenticar";

export const dynamic = "force-dynamic";

/*
  Notas NUEVAS del cerebro que crea aizen1 (la cuenta de servicio de Google no puede crear en un Drive personal).
  Misma clave que /api/trabajador/tablero/* (Bearer aizen_trab_...); la clave define el negocio.
  GET  -> { ok, notas: [{ id, ruta, contenido, creadoEn }] }: las PENDIENTES, las más viejas primero (máx. 20).
  POST { id, estado: "CREADA" | "ERROR", motivo? } -> { ok, id, estado, ruta, cambio }. 400 datos, 404 no existe,
       409 ya quedó en el otro estado. Repetir la misma marca no falla (cambio: false).
  Ver src/features/cerebro/services/notas-por-crear.ts y trabajador-tablero/lib/notas-boveda.mjs.
*/

function respuestaDeNota(fallo: unknown) {
  if (fallo instanceof ErrorDeNota) {
    return NextResponse.json({ ok: false, error: fallo.message }, { status: fallo.status, headers: SIN_CACHE });
  }
  return respuestaDeError(fallo);
}

export async function GET(request: Request) {
  const contexto = await contextoDelPedido(request);
  if (!contexto) return sinClave();
  try {
    const notas = await notasPendientesParaElTrabajador(contexto.workspaceId);
    return NextResponse.json({ ok: true, notas }, { headers: SIN_CACHE });
  } catch (fallo) {
    return respuestaDeNota(fallo);
  }
}

export async function POST(request: Request) {
  const contexto = await contextoDelPedido(request);
  if (!contexto) return sinClave();
  try {
    const cuerpo = await request.json().catch(() => null);
    const resultado = await marcarNotaPorCrear(contexto.workspaceId, cuerpo);
    return NextResponse.json({ ok: true, ...resultado }, { headers: SIN_CACHE });
  } catch (fallo) {
    return respuestaDeNota(fallo);
  }
}
