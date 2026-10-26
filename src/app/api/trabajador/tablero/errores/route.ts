import { NextResponse } from "next/server";

import { erroresDelTrabajador } from "@/features/tableros-inteligentes/services/trabajador";
import { SIN_CACHE, contextoDelPedido, respuestaDeError, sinClave } from "../autenticar";

export const dynamic = "force-dynamic";

/*
  POST /api/trabajador/tablero/errores — lo que el Coordinador necesita para recoger los errores viejos (una vez al día) y
  lo que muestra el panel (26-oct-2026). Solo lee:
    `{ ok, enError: [{ id, titulo, detalle, repo, tienePlan, plan, reparaciones, intentos, esParte, yaPartida, cayoEn, motivo,
                       categoria, ultimosIntentos, ultimoError, recogidas, recogidaEn, lineaDueno, actualizadoEn, link }],
       esperando: [{ id, titulo, etiqueta, esperaA: [{ id, titulo, estado }], link }] }`
  `esperando` son las tarjetas que no arrancan porque dependen de otra que no está HECHO ("Esperando a «X»").
  Para recoger una tarjeta: POST /api/trabajador/tablero/<id>/recoger. Ver services/trabajador.ts.
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
