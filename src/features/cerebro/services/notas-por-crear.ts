import { prisma } from "@/lib/prisma";
import type { EstadoDeNota } from "./reglas";

/*
  CEREBRO: las notas NUEVAS que crea aizen1.

  La cuenta de servicio de Google edita los archivos de la carpeta del cerebro, pero NO puede crear uno nuevo en un
  Drive personal (403 storageQuotaExceeded: no tiene espacio propio). Esa carpeta es la bóveda D:\Magilus de aizen1,
  sincronizada con Google Drive para escritorio. Entonces:
    1. escribir.ts deja el pedido aquí (PENDIENTE) con la ruta relativa y el contenido completo;
    2. el Coordinador de aizen1 (trabajador-tablero/lib/notas-boveda.mjs), cada minuto, pide las pendientes por
       GET /api/trabajador/cerebro/notas-por-crear, escribe el archivo en <boveda.ruta>/<ruta> (nunca sobrescribe: si
       ya existe, agrega al final) y la marca CREADA (o ERROR con motivo) por POST;
    3. Drive para escritorio sube el archivo a nombre del dueño y, desde la siguiente sincronización, el CRM lo edita.
  Nunca se borra un pedido: queda como registro.
*/

export const MAXIMO_POR_VUELTA = 20;

export type NotaParaElTrabajador = { id: string; ruta: string; contenido: string; creadoEn: string };

/** Las pendientes del negocio de la clave, las más viejas primero (así una segunda nota a la misma ruta se agrega después). */
export async function notasPendientesParaElTrabajador(workspaceId: string, maximo = MAXIMO_POR_VUELTA): Promise<NotaParaElTrabajador[]> {
  const filas = await prisma.cerebroNotaPorCrear.findMany({
    where: { workspaceId, estado: "PENDIENTE" },
    orderBy: { creadoEn: "asc" },
    take: Math.min(Math.max(1, maximo), MAXIMO_POR_VUELTA),
    select: { id: true, ruta: true, contenido: true, creadoEn: true },
  });
  return filas.map((fila) => ({ ...fila, creadoEn: fila.creadoEn.toISOString() }));
}

export class ErrorDeNota extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type MarcaDeNota = { id: string; estado: "CREADA" | "ERROR"; motivo: string | null };

/** Lee y revisa el cuerpo del POST: { id, estado: "CREADA" | "ERROR", motivo? }. */
export function marcaDeEntrada(cuerpo: unknown): MarcaDeNota {
  const datos = (cuerpo ?? {}) as Record<string, unknown>;
  const id = typeof datos.id === "string" ? datos.id.trim() : "";
  if (!id || id.length > 100) throw new ErrorDeNota("Falta el id de la nota.", 400);
  if (datos.estado !== "CREADA" && datos.estado !== "ERROR") throw new ErrorDeNota('estado tiene que ser "CREADA" o "ERROR".', 400);
  const motivo = typeof datos.motivo === "string" && datos.motivo.trim() ? datos.motivo.trim().slice(0, 1000) : null;
  if (datos.estado === "ERROR" && !motivo) throw new ErrorDeNota("Un ERROR necesita su motivo.", 400);
  return { id, estado: datos.estado, motivo };
}

/**
 * Qué hacer con una marca según el estado actual: "cambiar", "igual" (ya estaba así: el Coordinador reintentó el aviso)
 * o un error 409 (ya quedó en otro estado final).
 */
export function decidirMarca(actual: EstadoDeNota | string, nuevo: MarcaDeNota["estado"]): "cambiar" | "igual" {
  if (actual === "PENDIENTE") return "cambiar";
  if (actual === nuevo) return "igual";
  throw new ErrorDeNota(`La nota ya está ${actual}: no se puede pasar a ${nuevo}.`, 409);
}

export async function marcarNotaPorCrear(workspaceId: string, cuerpo: unknown) {
  const marca = marcaDeEntrada(cuerpo);
  const fila = await prisma.cerebroNotaPorCrear.findFirst({ where: { id: marca.id, workspaceId }, select: { estado: true, ruta: true } });
  if (!fila) throw new ErrorDeNota("Esa nota no existe en este negocio.", 404);
  if (decidirMarca(fila.estado, marca.estado) === "igual") return { id: marca.id, estado: fila.estado, ruta: fila.ruta, cambio: false };
  // Solo cambia si sigue PENDIENTE (dos avisos a la vez no se pisan).
  const { count } = await prisma.cerebroNotaPorCrear.updateMany({
    where: { id: marca.id, workspaceId, estado: "PENDIENTE" },
    data: { estado: marca.estado, motivo: marca.motivo, ...(marca.estado === "CREADA" ? { creadaEn: new Date() } : {}) },
  });
  if (!count) throw new ErrorDeNota("La nota cambió mientras se marcaba: vuelve a pedir las pendientes.", 409);
  return { id: marca.id, estado: marca.estado, ruta: fila.ruta, cambio: true };
}

export type NotaReciente = { id: string; ruta: string; estado: string; motivo: string | null; quienNombre: string | null; creadoEn: string; creadaEn: string | null };

/** Las últimas notas para la pantalla y el MCP ("pendiente de crear en aizen1" / "creada" / "error"). */
export async function notasRecientes(workspaceId: string, maximo = 10): Promise<NotaReciente[]> {
  const filas = await prisma.cerebroNotaPorCrear.findMany({
    where: { workspaceId },
    orderBy: { creadoEn: "desc" },
    take: maximo,
    select: { id: true, ruta: true, estado: true, motivo: true, quienNombre: true, creadoEn: true, creadaEn: true },
  });
  return filas.map((fila) => ({ ...fila, creadoEn: fila.creadoEn.toISOString(), creadaEn: fila.creadaEn?.toISOString() ?? null }));
}
