import { NextResponse } from "next/server";

import { workspacePorLlaveDeGestion } from "@/lib/origen-de-venta-crm";
import { CUERPO_MAXIMO_BYTES, responderPagoAProveedora } from "@/lib/pago-a-proveedora";
import { enviarPagoAProveedora } from "@/lib/pago-a-proveedora-envio";
import { CUERPO_DEMASIADO_GRANDE, leerCuerpoConTope, taparNumeros } from "@/lib/recibo-de-caja";

/**
 * POST /api/gestion/pago-proveedora — Gestión entrega aquí cada pago a una proveedora cuando se sube su
 * comprobante (los datos del pago + la foto o el PDF).
 *
 * Llave: `Authorization: Bearer <la misma llave de la conexión con Gestión>` (igual que el recibo de
 * caja); la llave dice de qué negocio es. 401 llave mala, 400 cuerpo no válido (o comprobante de más de
 * 10 MB), 200 con `{ estado: 'enviado' | 'ya_enviado' | 'apagado' | 'sin_telefono' | 'fallo' }`.
 * Nace APAGADO (ver pago-a-proveedora.ts). La llave se revisa ANTES de leer el cuerpo. Nunca escribe en
 * el log la llave ni el comprobante.
 */
export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const respuesta = await responderPagoAProveedora(
      {
        autorizacion: request.headers.get("authorization"),
        leerCuerpo: async () => {
          // Si dice de entrada que pasa del tope, ni se lee.
          const largo = Number(request.headers.get("content-length") ?? 0);
          if (Number.isFinite(largo) && largo > CUERPO_MAXIMO_BYTES) return CUERPO_DEMASIADO_GRANDE;
          return leerCuerpoConTope(request.body, CUERPO_MAXIMO_BYTES);
        },
      },
      { workspacePorLlave: workspacePorLlaveDeGestion, procesar: enviarPagoAProveedora },
    );
    return NextResponse.json(respuesta.body, { status: respuesta.status, headers: sinCache });
  } catch (error) {
    console.error("[pago-a-proveedora] pedido_fallido", { error: error instanceof Error ? taparNumeros(error.message).slice(0, 200) : "desconocido" });
    return NextResponse.json({ error: "error_interno" }, { status: 500, headers: sinCache });
  }
}
