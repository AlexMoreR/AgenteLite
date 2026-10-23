import { NextResponse } from "next/server";

import { candidatasDelTrabajador } from "@/features/tableros-inteligentes/services/trabajador";
import { SIN_CACHE, contextoDelPedido, respuestaDeError, sinClave } from "../autenticar";

export const dynamic = "force-dynamic";

/*
  POST /api/trabajador/tablero/candidatas — las tarjetas que /tomar podría tomar, SIN tomarlas, en el
  orden en que las tomaría: `{ ok, candidatas: [{ id, titulo, estado, repo, zonaProtegida, plan, hacer }] }`.
  El trabajador las mira para no juntar en paralelo dos que chocan (misma zona o módulo del mismo repo,
  o dos subidas del mismo repo) y manda las que chocan en `excluir` a /tomar. Ver services/trabajador.ts.
*/
export async function POST(request: Request) {
  const contexto = await contextoDelPedido(request);
  if (!contexto) return sinClave();
  try {
    const respuesta = await candidatasDelTrabajador(contexto);
    return NextResponse.json({ ok: true, ...respuesta }, { headers: SIN_CACHE });
  } catch (fallo) {
    return respuestaDeError(fallo);
  }
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
