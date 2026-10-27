import { NextResponse } from "next/server";

import { porRevisarDelTrabajador } from "@/features/tableros-inteligentes/services/trabajador";
import { SIN_CACHE, contextoDelPedido, respuestaDeError, sinClave } from "../autenticar";

export const dynamic = "force-dynamic";

/*
  POST /api/trabajador/tablero/por-revisar — las tarjetas POR_REVISAR que solo esperaban la prueba extra de chats o del bot
  (falta la prueba de que no manda mensajes nuevos a clientes): `{ ok, tarjetas: [{ id, titulo, repo, plan, zonaProtegida,
  rama, commit, base, archivos, esperaPor }] }`. El Coordinador vuelve a mirar el diff real de cada una y, si no agrega ningún
  envío, le aplica /:id/revisado (pasa a SUBIENDO y sube sola con la vigilancia de 30 min). Solo lee. Ver services/trabajador.ts.
*/
export async function POST(request: Request) {
  const contexto = await contextoDelPedido(request);
  if (!contexto) return sinClave();
  try {
    const respuesta = await porRevisarDelTrabajador(contexto);
    return NextResponse.json({ ok: true, ...respuesta }, { headers: SIN_CACHE });
  } catch (fallo) {
    return respuestaDeError(fallo);
  }
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
