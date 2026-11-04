import { NextResponse } from "next/server";

import { workspacePorLlaveDeGestion } from "@/lib/origen-de-venta-crm";
import { CUERPO_DEMASIADO_GRANDE, CUERPO_MAXIMO_BYTES, leerCuerpoConTope, responderReciboDeCaja, taparNumeros } from "@/lib/recibo-de-caja";
import { enviarReciboDeCaja } from "@/lib/recibo-de-caja-envio";

/**
 * POST /api/gestion/recibo-de-caja — Gestión entrega aquí cada recibo de caja (los datos del abono + el PDF).
 *
 * Llave: `Authorization: Bearer <la misma llave de la conexión con Gestión>` (igual que /api/origen); la
 * llave dice de qué negocio es. 401 llave mala, 400 cuerpo no válido (o PDF de más de 10 MB), 200 con
 * `{ estado: 'enviado' | 'ya_enviado' | 'apagado' | 'fallo' }`. Nace APAGADO (ver recibo-de-caja.ts).
 * La llave se revisa ANTES de leer el cuerpo. Nunca escribe en el log la llave ni el PDF.
 */
export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const respuesta = await responderReciboDeCaja(
      {
        autorizacion: request.headers.get("authorization"),
        leerCuerpo: async () => {
          // Si dice de entrada que pasa del tope, ni se lee.
          const largo = Number(request.headers.get("content-length") ?? 0);
          if (Number.isFinite(largo) && largo > CUERPO_MAXIMO_BYTES) return CUERPO_DEMASIADO_GRANDE;
          return leerCuerpoConTope(request.body, CUERPO_MAXIMO_BYTES);
        },
      },
      { workspacePorLlave: workspacePorLlaveDeGestion, procesar: enviarReciboDeCaja },
    );
    return NextResponse.json(respuesta.body, { status: respuesta.status, headers: sinCache });
  } catch (error) {
    console.error("[recibo-de-caja] pedido_fallido", { error: error instanceof Error ? taparNumeros(error.message).slice(0, 200) : "desconocido" });
    return NextResponse.json({ error: "error_interno" }, { status: 500, headers: sinCache });
  }
}
