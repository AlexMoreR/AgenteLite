import { NextResponse } from "next/server";

import { getPublicBaseUrl } from "@/lib/app-url";
import { responderCartaParaGestion, type MaterialLeido } from "@/lib/carta-de-colores-para-gestion";
import { workspacePorLlaveDeGestion } from "@/lib/origen-de-venta-crm";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/gestion/carta-de-colores — SOLO LECTURA.
 *
 * Gestión lee aquí la carta de colores del CRM (la única carta, decisión del dueño del 4-nov-2026) para
 * cotizar y mandar a producir. Llave: `Authorization: Bearer <la misma llave de la conexión con Gestión>`
 * (igual que /api/origen); la llave dice de qué negocio es. 401 sin llave o con llave mala; 200 con
 * `{ materiales: [{ nombre, tipo, orden, colores: [{ id, codigo, nombre, fotoUrl, orden }] }] }`.
 * Los colores ocultos no salen. No crea los materiales base ni rehace imágenes: si no hay carta, lista vacía.
 * Nunca escribe en el log la llave.
 */
export const dynamic = "force-dynamic";

const sinCache = { "Cache-Control": "no-store" };

async function leerCarta(workspaceId: string): Promise<MaterialLeido[]> {
  return prisma.materialDeColores.findMany({
    where: { workspaceId },
    orderBy: [{ orden: "asc" }, { nombre: "asc" }],
    select: {
      nombre: true,
      tipo: true,
      orden: true,
      colores: {
        orderBy: [{ orden: "asc" }, { codigo: "asc" }],
        select: { id: true, codigo: true, nombre: true, fotoUrl: true, oculto: true, orden: true },
      },
    },
  });
}

export async function GET(request: Request) {
  try {
    const respuesta = await responderCartaParaGestion(
      { autorizacion: request.headers.get("authorization"), base: getPublicBaseUrl(request) },
      { workspacePorLlave: workspacePorLlaveDeGestion, leerCarta },
    );
    return NextResponse.json(respuesta.body, { status: respuesta.status, headers: sinCache });
  } catch (error) {
    console.error("[carta-de-colores-gestion] consulta_fallida", {
      error: error instanceof Error ? error.message.slice(0, 200) : "desconocido",
    });
    return NextResponse.json({ error: "error_interno" }, { status: 500, headers: sinCache });
  }
}
