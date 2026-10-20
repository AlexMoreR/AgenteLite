import { NextResponse } from "next/server";

import { ACCIONES_DEL_TRABAJADOR, type AccionDelTrabajador } from "@/features/tableros-inteligentes/services/reglas-trabajador";
import { accionDelTrabajador } from "@/features/tableros-inteligentes/services/trabajador";
import { SIN_CACHE, contextoDelPedido, respuestaDeError, sinClave } from "../../autenticar";

export const dynamic = "force-dynamic";

/*
  POST /api/trabajador/tablero/<tarjetaId>/<accion> — lo que el trabajador avisa de una tarjeta que tomó:
  - latido    {}                                  corre el vencimiento del candado (hasta el tope).
  - plan      { plan }                            PLANEANDO -> PLAN_LISTO.
  - resultado { resumen, pruebas, paso, rama, linkRama, commit, migracion }   EN_CURSO -> POR_REVISAR.
  - subida    { commit, version }                 SUBIENDO -> HECHO.
  - error     { motivo, zonaProtegida? }          PLANEANDO | EN_CURSO | SUBIENDO -> ERROR.
  409 si la tarjeta no está en el estado de esa acción. Ver services/trabajador.ts.
*/
export async function POST(request: Request, { params }: { params: Promise<{ id: string; accion: string }> }) {
  const contexto = await contextoDelPedido(request);
  if (!contexto) return sinClave();
  const { id, accion } = await params;
  if (!(ACCIONES_DEL_TRABAJADOR as readonly string[]).includes(accion)) {
    return NextResponse.json({ ok: false, error: "Esa acción no existe." }, { status: 404, headers: SIN_CACHE });
  }
  let cuerpo: Record<string, unknown> = {};
  try {
    const leido = await request.json();
    if (leido && typeof leido === "object" && !Array.isArray(leido)) cuerpo = leido as Record<string, unknown>;
  } catch {
    // Sin cuerpo (el latido no lo necesita).
  }
  try {
    const respuesta = await accionDelTrabajador(contexto, id, accion as AccionDelTrabajador, cuerpo);
    return NextResponse.json(respuesta, { headers: SIN_CACHE });
  } catch (fallo) {
    return respuestaDeError(fallo);
  }
}
