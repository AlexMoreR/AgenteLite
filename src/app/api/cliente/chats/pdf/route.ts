import { NextResponse } from "next/server";

import { cargarConversacionParaExportar, descargarMedios, nombreDeDescarga } from "@/lib/exportar-conversacion";
import { construirPdfDeConversacion } from "@/lib/pdf-de-conversacion";

/**
 * Descargar un chat entero como PDF.
 *
 * Se arma en el SERVIDOR y no en el navegador por dos motivos: el navegador solo tiene los
 * mensajes que ya bajó (la bandeja carga de a 10) y no puede leer los medios de Evolution, que
 * necesitan la apikey. Acá están los dos.
 *
 * Las fotos van incrustadas; los audios, videos y documentos quedan como enlaces. Un PDF no puede
 * reproducir un audio en los visores que usa el equipo (Chrome, el celular, WhatsApp): para
 * escucharlos ahí mismo está la descarga con audios (`/api/cliente/chats/html`).
 */

export const dynamic = "force-dynamic";
// Un chat largo con decenas de fotos tarda: el límite por defecto lo cortaba a la mitad.
export const maxDuration = 120;

export async function GET(request: Request) {
  const cargada = await cargarConversacionParaExportar(request);
  if (!cargada.ok) {
    return cargada.respuesta;
  }
  const { datos } = cargada;

  // Más de 80 fotos y el archivo pesa más de lo que sirve; una foto de WhatsApp nunca llega a 5 MB.
  await descargarMedios(datos.mensajes, {
    tipos: ["IMAGE", "STICKER"],
    maximo: 80,
    maxBytesPorArchivo: 5 * 1024 * 1024,
    presupuestoTotal: 60 * 1024 * 1024,
  });

  let pdf: Uint8Array;
  try {
    pdf = await construirPdfDeConversacion({
      titulo: datos.titulo,
      telefono: datos.telefono,
      mensajes: datos.mensajes,
      descargadoPor: datos.descargadoPor,
    });
  } catch (error) {
    console.error("[chats/pdf] no se pudo armar el PDF", {
      chatKey: datos.chatKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false, error: "No se pudo armar el PDF" }, { status: 500 });
  }

  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": nombreDeDescarga(datos.titulo, "pdf"),
      "Cache-Control": "private, no-store",
    },
  });
}
