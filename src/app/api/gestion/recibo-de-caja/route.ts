import { NextResponse } from "next/server";

import { workspacePorLlaveDeGestion } from "@/lib/origen-de-venta-crm";
import { CUERPO_MAXIMO_BYTES, responderReciboDeCaja } from "@/lib/recibo-de-caja";
import { enviarReciboDeCaja } from "@/lib/recibo-de-caja-envio";

/**
 * POST /api/gestion/recibo-de-caja — Gestión entrega aquí cada recibo de caja (los datos del abono + el PDF).
 *
 * Llave: `Authorization: Bearer <la misma llave de la conexión con Gestión>` (igual que /api/origen); la
 * llave dice de qué negocio es. 401 llave mala, 400 cuerpo no válido, 200 con
 * `{ estado: 'enviado' | 'ya_enviado' | 'apagado' | 'fallo' }`. Nace APAGADO (ver recibo-de-caja.ts).
 * Nunca escribe en el log la llave ni el PDF.
 */
export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const largo = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(largo) && largo > CUERPO_MAXIMO_BYTES) {
      return NextResponse.json({ error: "cuerpo_invalido", detalle: "pdfBase64: El PDF pasa de 10 MB" }, { status: 400, headers: sinCache });
    }
    const cuerpo = await request.json().catch(() => null);
    const respuesta = await responderReciboDeCaja(
      { autorizacion: request.headers.get("authorization"), cuerpo },
      { workspacePorLlave: workspacePorLlaveDeGestion, procesar: enviarReciboDeCaja },
    );
    return NextResponse.json(respuesta.body, { status: respuesta.status, headers: sinCache });
  } catch (error) {
    console.error("[recibo-de-caja] pedido_fallido", { error: error instanceof Error ? error.message.slice(0, 200) : "desconocido" });
    return NextResponse.json({ error: "error_interno" }, { status: 500, headers: sinCache });
  }
}
