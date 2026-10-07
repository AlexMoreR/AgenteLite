import { NextResponse } from "next/server";

import { responderConsultaDeOrigen } from "@/lib/origen-de-venta";
import { origenPorTelefono, workspacePorLlaveDeGestion } from "@/lib/origen-de-venta-crm";

/**
 * GET /api/origen?telefono=573001234567 — SOLO LECTURA.
 *
 * Lo usa el script de relleno de Gestión (ventas viejas, sin cotización ligada): con el teléfono
 * del cliente busca su ficha aquí y aplica la regla de la línea del chat (ver origen-de-venta.ts).
 * Llave: `Authorization: Bearer <la misma llave de la conexión con Gestión>`; la llave dice de qué
 * negocio es. Nunca devuelve nombre ni teléfono: solo origen, detalle y línea.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const respuesta = await responderConsultaDeOrigen(
      { autorizacion: request.headers.get("authorization"), telefono: url.searchParams.get("telefono") },
      { workspacePorLlave: workspacePorLlaveDeGestion, origenPorTelefono },
    );
    return NextResponse.json(respuesta.body, { status: respuesta.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[origen-ventas] consulta_fallida", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "error_interno" }, { status: 500 });
  }
}
