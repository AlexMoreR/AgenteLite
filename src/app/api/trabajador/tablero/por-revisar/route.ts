import { NextResponse } from "next/server";

import { porRevisarDelTrabajador } from "@/features/tableros-inteligentes/services/trabajador";
import { SIN_CACHE, contextoDelPedido, respuestaDeError, sinClave } from "../autenticar";

export const dynamic = "force-dynamic";

/*
  POST /api/trabajador/tablero/por-revisar — las tarjetas POR_REVISAR que pasaron build y pruebas y a las que solo
  les faltaba la prueba extra de su zona, o que ya traen un sí del dueño (27-oct-2026): `{ ok, tarjetas: [{ id, titulo,
  repo, plan, zonaProtegida, rama, base, commit, archivos, esperaPor, aprobadaPorElDueno }] }`. El Coordinador las revisa
  de nuevo con el diff real y les aplica /:id/rescatar. Desde el 30-oct-2026 trae además `paraRevisarDeNuevo`: las POR_REVISAR
  que pasaron, solo de CHATS / BOT_VENTAS y sin gasto en Meta Ads ({ id, titulo, repo, zonaProtegida, paso, rama, base, commit,
  esperaPor }); el Coordinador las vuelve a probar (rebase, build, pruebas, envíos) y llama /:id/revisar_de_nuevo. Solo lee.
  Ver services/trabajador.ts.
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
