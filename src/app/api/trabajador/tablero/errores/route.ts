import { NextResponse } from "next/server";

import { erroresDelTrabajador } from "@/features/tableros-inteligentes/services/trabajador";
import { SIN_CACHE, contextoDelPedido, respuestaDeError, sinClave } from "../autenticar";

export const dynamic = "force-dynamic";

/*
  POST /api/trabajador/tablero/errores — las tarjetas que están en ERROR, las más viejas primero:
  `{ ok, tarjetas: [{ id, titulo, detalle, repo, plan, esParte, recogidas, lineaParaElDueno, motivo, ultimoError,
  ultimosIntentos }] }`. El Coordinador las revisa una vez al día (y al arrancar con este cambio) y a cada una le
  aplica /:id/recoger (reintentar, partir o dejar una línea para el dueño). Solo lee. Ver services/trabajador.ts.
*/
export async function POST(request: Request) {
  const contexto = await contextoDelPedido(request);
  if (!contexto) return sinClave();
  try {
    const respuesta = await erroresDelTrabajador(contexto);
    return NextResponse.json({ ok: true, ...respuesta }, { headers: SIN_CACHE });
  } catch (fallo) {
    return respuestaDeError(fallo);
  }
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
