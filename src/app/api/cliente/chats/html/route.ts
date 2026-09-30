import { NextResponse } from "next/server";

import { cargarConversacionParaExportar, descargarMedios, nombreDeDescarga } from "@/lib/exportar-conversacion";
import { construirHtmlDeConversacion } from "@/lib/html-de-conversacion";

/**
 * Descargar un chat entero como página web, con las notas de voz reproducibles ahí mismo.
 *
 * Es la hermana del PDF (`/api/cliente/chats/pdf`), con los mismos mensajes. La diferencia es que
 * acá los audios van ADENTRO del archivo y suenan con el reproductor del navegador, sin abrir otra
 * pestaña: un PDF no puede hacer eso en los visores que usa el equipo.
 */

export const dynamic = "force-dynamic";
// Además de las fotos, acá se bajan los audios: con un chat largo son más de cien archivos.
export const maxDuration = 180;

const MB = 1024 * 1024;

export async function GET(request: Request) {
  const cargada = await cargarConversacionParaExportar(request);
  if (!cargada.ok) {
    return cargada.respuesta;
  }
  const { datos } = cargada;

  /*
    Los topes. Los audios primero y con más presupuesto: son la razón de ser de este archivo.

    Una nota de voz de WhatsApp pesa unos 20 KB por cada 10 segundos, así que 60 MB son horas de
    audio. Lo que pase del tope no se pierde: se reproduce igual desde el servidor, con internet.
    En base64 todo pesa un tercio más, así que el archivo final puede rondar los 100 MB en el peor
    caso, que es un chat excepcional.
  */
  await descargarMedios(datos.mensajes, {
    tipos: ["AUDIO"],
    maximo: 300,
    maxBytesPorArchivo: 10 * MB,
    presupuestoTotal: 60 * MB,
  });
  await descargarMedios(datos.mensajes, {
    tipos: ["IMAGE", "STICKER"],
    maximo: 80,
    maxBytesPorArchivo: 5 * MB,
    // El presupuesto es acumulado: cuenta también lo que ya ocuparon los audios.
    presupuestoTotal: 80 * MB,
  });

  let html: string;
  try {
    html = construirHtmlDeConversacion({
      titulo: datos.titulo,
      telefono: datos.telefono,
      mensajes: datos.mensajes,
      descargadoPor: datos.descargadoPor,
    });
  } catch (error) {
    console.error("[chats/html] no se pudo armar el archivo", {
      chatKey: datos.chatKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false, error: "No se pudo armar el archivo" }, { status: 500 });
  }

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // `attachment` y no `inline`: abierta DENTRO de la app, la página correría con la sesión de
      // quien la baja. Como archivo suelto no tiene acceso a nada.
      "Content-Disposition": nombreDeDescarga(datos.titulo, "html"),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
