import { NextResponse } from "next/server";

import {
  ErrorDelTrabajador,
  validarClaveTrabajador,
  type ContextoTrabajador,
} from "@/features/tableros-inteligentes/services/trabajador";

/*
  Lo común de la API del TRABAJADOR del Tablero IA (/api/trabajador/tablero/*).

  Acceso: `Authorization: Bearer aizen_trab_...` (la clave del trabajador, que se crea en la pantalla
  del Tablero IA, panel Trabajador). La clave define el negocio. Sin sesión ni cookies: la usa un PC
  aparte que pregunta cada minuto (solo HTTPS saliente desde ese PC). No pasa por el middleware (que
  no corre en /api).
*/

export const SIN_CACHE = { "Cache-Control": "no-store" };

export async function contextoDelPedido(request: Request): Promise<ContextoTrabajador | null> {
  const autorizacion = request.headers.get("authorization") ?? "";
  const clave = autorizacion.toLowerCase().startsWith("bearer ") ? autorizacion.slice(7).trim() : "";
  return validarClaveTrabajador(clave);
}

export const sinClave = () =>
  NextResponse.json({ ok: false, error: "Clave de trabajador inválida o revocada." }, { status: 401, headers: SIN_CACHE });

/** Un error de la acción, con su código (409 = el estado no corresponde; 400 = datos; 404 = no existe). */
export function respuestaDeError(fallo: unknown) {
  if (fallo instanceof ErrorDelTrabajador) {
    return NextResponse.json({ ok: false, error: fallo.message }, { status: fallo.status, headers: SIN_CACHE });
  }
  console.error("[trabajador-tablero] falló", fallo);
  return NextResponse.json({ ok: false, error: "No se pudo completar." }, { status: 500, headers: SIN_CACHE });
}
