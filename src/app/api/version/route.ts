import { NextResponse } from "next/server";

/**
 * Que version esta corriendo el servidor AHORA.
 *
 * La app se queda abierta todo el dia en el celular de las asesoras y nosotros desplegamos
 * varias veces al dia. Cuando eso pasa, la pagina que ellas tienen cargada quedo con el codigo
 * viejo, y los botones que hablan con el servidor (mandar un archivo, responder, registrar una
 * llamada) fallan con "Failed to find Server Action" — que en pantalla se ve como un
 * "No se pudo enviar" sin ninguna explicacion.
 *
 * El navegador compara esto con la version que tiene cargada y, si no coinciden, avisa que hay
 * que recargar en vez de dejarlas peleando con botones que ya no funcionan.
 */

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { version: process.env.NEXT_PUBLIC_DEPLOYMENT_ID?.trim() || "" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
