import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { terminarInicioDeSesion } from "@/features/cerebro/services/conexion";
import { origenDelPedido } from "../../origen";

export const dynamic = "force-dynamic";

const PANTALLA = "/cliente/negocio/cerebro";

/* Regreso de Google: guarda el permiso (cifrado) y vuelve a la pantalla del Cerebro para elegir la carpeta. */
export async function GET(request: Request) {
  const origen = origenDelPedido(request);
  const parametros = new URL(request.url).searchParams;
  const volver = (consulta: string) => NextResponse.redirect(`${origen}${PANTALLA}?${consulta}`);
  if (parametros.get("error")) return volver(`error=${encodeURIComponent("Google no dio el permiso. Puedes intentar de nuevo.")}`);
  const sesion = await auth();
  const codigo = parametros.get("code");
  if (!sesion?.user?.id || !codigo) return volver(`error=${encodeURIComponent("No llegó el permiso de Google. Intenta de nuevo.")}`);
  try {
    await terminarInicioDeSesion({ codigo, estado: parametros.get("state"), origen, userIdActual: sesion.user.id });
    return volver("conectado=1");
  } catch (fallo) {
    return volver(`error=${encodeURIComponent(fallo instanceof Error ? fallo.message : "No se pudo conectar Google.")}`);
  }
}
