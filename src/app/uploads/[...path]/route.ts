import path from "node:path";
import { NextRequest } from "next/server";

import { servirArchivoSubido } from "@/lib/archivos-subidos";

/*
  Los archivos que se suben con la app ya andando (los de antes del build los sirve Next directo).
  Toda la logica (ETag, 304, Range, HEAD, por partes, que nombres se guardan un año) esta en
  src/lib/archivos-subidos.ts. Sin sesion: WAHA y Evolution los bajan por su URL publica.
*/
type Contexto = { params: Promise<{ path: string[] }> };

function raiz() {
  return path.join(process.cwd(), "public", "uploads");
}

export async function GET(request: NextRequest, context: Contexto) {
  const { path: segmentos } = await context.params;
  return servirArchivoSubido(request, segmentos, { raiz: raiz() });
}

export async function HEAD(request: NextRequest, context: Contexto) {
  const { path: segmentos } = await context.params;
  return servirArchivoSubido(request, segmentos, { raiz: raiz(), soloEncabezados: true });
}
