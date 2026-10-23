import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { prisma } from "@/lib/prisma";
import { rutaDeArchivo, tipoDeAudio } from "@/features/reuniones/servicios/archivos-de-reuniones";
import { linkFirmadoValido, secretoDeLosLinks } from "@/features/reuniones/servicios/link-firmado";

export const dynamic = "force-dynamic";

/*
  ESCUCHAR UNA PISTA de una reunión, con el link firmado que vence en 1 hora (lo arma la pantalla
  del detalle). Sin firma válida, 403. Acepta Range para poder adelantar el audio.
*/

export async function GET(request: Request, { params }: { params: Promise<{ pistaId: string }> }) {
  const { pistaId } = await params;
  const parametros = new URL(request.url).searchParams;
  const secreto = secretoDeLosLinks();
  if (!secreto || !linkFirmadoValido(pistaId, parametros.get("vence"), parametros.get("firma"), secreto)) {
    return new Response("El link venció o no es válido.", { status: 403 });
  }

  const pista = await prisma.reunionPista.findUnique({ where: { id: pistaId }, select: { archivo: true, estado: true } });
  if (!pista?.archivo || pista.estado === "GRABANDO") {
    return new Response("El audio no está disponible.", { status: 404 });
  }

  let ruta: string;
  let tamano: number;
  try {
    ruta = rutaDeArchivo(pista.archivo);
    tamano = (await stat(ruta)).size;
  } catch {
    return new Response("No se encontró el audio.", { status: 404 });
  }

  const cabeceras: Record<string, string> = {
    "Content-Type": tipoDeAudio(ruta),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };

  const rango = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (rango && (rango[1] || rango[2])) {
    const inicio = rango[1] ? Number(rango[1]) : Math.max(0, tamano - Number(rango[2]));
    const fin = rango[1] && rango[2] ? Math.min(Number(rango[2]), tamano - 1) : tamano - 1;
    if (inicio >= tamano || inicio > fin) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${tamano}` } });
    }
    const cuerpo = Readable.toWeb(createReadStream(ruta, { start: inicio, end: fin })) as unknown as ReadableStream;
    return new Response(cuerpo, {
      status: 206,
      headers: { ...cabeceras, "Content-Range": `bytes ${inicio}-${fin}/${tamano}`, "Content-Length": String(fin - inicio + 1) },
    });
  }

  const cuerpo = Readable.toWeb(createReadStream(ruta)) as unknown as ReadableStream;
  return new Response(cuerpo, { headers: { ...cabeceras, "Content-Length": String(tamano) } });
}
