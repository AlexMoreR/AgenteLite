import { NextResponse } from "next/server";

import { leerAreaFeatures } from "@/features/tableros-inteligentes/services/coordinador-en-vivo";
import { areaPermitidaDeEntrada } from "@/features/tableros-inteligentes/services/reglas-trabajador";
import { candidatasDelTrabajador } from "@/features/tableros-inteligentes/services/trabajador";
import { SIN_CACHE, contextoDelPedido, respuestaDeError, sinClave } from "../autenticar";

export const dynamic = "force-dynamic";

/*
  POST /api/trabajador/tablero/candidatas — las tarjetas que /tomar podría tomar, SIN tomarlas, en el
  orden en que las tomaría: `{ ok, candidatas: [{ id, titulo, estado, repo, zonaProtegida, plan, hacer }] }`.
  El trabajador las mira para no juntar en paralelo dos que chocan (misma zona o módulo del mismo repo,
  o dos subidas del mismo repo) y manda las que chocan en `excluir` a /tomar. Ver services/trabajador.ts.
  Solo Features (23-nov-2026): con `?areaPermitidaId=<id>` (o, si no viene, el último que mandó el latido) solo salen las que
  cuelgan de esa Área (sub-áreas incluidas) más las ya empezadas. Sin ninguno de los dos, como siempre.
*/
export async function POST(request: Request) {
  const contexto = await contextoDelPedido(request);
  if (!contexto) return sinClave();
  try {
    const delPedido = areaPermitidaDeEntrada(new URL(request.url).searchParams.get("areaPermitidaId"));
    const respuesta = await candidatasDelTrabajador(contexto, delPedido ?? (await leerAreaFeatures(contexto.workspaceId)));
    return NextResponse.json({ ok: true, ...respuesta }, { headers: SIN_CACHE });
  } catch (fallo) {
    return respuestaDeError(fallo);
  }
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
