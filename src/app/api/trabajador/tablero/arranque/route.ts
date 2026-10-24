import { NextResponse } from "next/server";

import { arranqueDelTrabajador } from "@/features/tableros-inteligentes/services/trabajador";
import { SIN_CACHE, contextoDelPedido, respuestaDeError, sinClave } from "../autenticar";

export const dynamic = "force-dynamic";

/*
  POST /api/trabajador/tablero/arranque — el Coordinador avisa que acaba de arrancar (sin parámetros).

  Lo que el negocio tenía en PLANEANDO o EN_CURSO con candado lo tenía el proceso anterior, que murió: vuelve a
  la fila (APROBADO / PLAN_APROBADO) sin ERROR y sin gastar el intento, con una fila de intentos
  (coordinador_cortado, esperar). SUBIENDO no se toca (pudo haber empujado a main: sigue como hoy y vence).
  Contesta `{ ok, sueltas: [ids] }`. Ver services/trabajador.ts.
*/
export async function POST(request: Request) {
  const contexto = await contextoDelPedido(request);
  if (!contexto) return sinClave();
  try {
    const respuesta = await arranqueDelTrabajador(contexto);
    return NextResponse.json(respuesta, { headers: SIN_CACHE });
  } catch (fallo) {
    return respuestaDeError(fallo);
  }
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
