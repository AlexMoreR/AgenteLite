import type { EstadoReunion, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/*
  BUSCAR REUNIONES por texto en el título, la transcripción y el acta, dentro del negocio.

  Es un ILIKE (Prisma `mode: "insensitive"`): para la cantidad de reuniones que se esperan no hace
  falta un índice nuevo. La usan la pantalla y el MCP (listar_reuniones).
  Cada resultado trae su sala fija (o null si es una reunión suelta, «Sin sala»). Con `soloSinSala`
  salen solo las sueltas: es la lista «Sin sala» de la pantalla cuando no se busca nada.
*/

export type ReunionDeLaLista = {
  id: string;
  titulo: string;
  codigo: string;
  origen: string;
  sinGrabar: boolean;
  estado: EstadoReunion;
  aviso: string | null;
  motivoError: string | null;
  createdAt: Date;
  empezoEn: Date | null;
  terminoEn: Date | null;
  creadaPor: string | null;
  creadaPorId: string | null;
  participantes: number;
  resumen: string | null;
  salaFija: { id: string; nombre: string } | null;
};

export async function buscarReuniones(
  workspaceId: string,
  texto?: string | null,
  tope = 50,
  { soloSinSala = false }: { soloSinSala?: boolean } = {},
): Promise<ReunionDeLaLista[]> {
  const buscado = texto?.trim().slice(0, 120);
  const where: Prisma.ReunionWhereInput = { workspaceId };
  if (soloSinSala) {
    where.salaFijaId = null;
  }
  if (buscado) {
    where.OR = [
      { titulo: { contains: buscado, mode: "insensitive" } },
      { textoTranscripcion: { contains: buscado, mode: "insensitive" } },
      { textoActa: { contains: buscado, mode: "insensitive" } },
    ];
  }
  const filas = await prisma.reunion.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(tope, 1), 200),
    select: {
      id: true,
      titulo: true,
      codigo: true,
      origen: true,
      sinGrabar: true,
      estado: true,
      aviso: true,
      motivoError: true,
      createdAt: true,
      empezoEn: true,
      terminoEn: true,
      acta: true,
      creadaPorId: true,
      creadaPor: { select: { name: true, email: true } },
      salaFija: { select: { id: true, nombre: true } },
      _count: { select: { participantes: { where: { NOT: { identidad: { startsWith: "EG_" } } } } } },
    },
  });
  return filas.map((fila) => ({
    id: fila.id,
    titulo: fila.titulo,
    codigo: fila.codigo,
    origen: fila.origen,
    sinGrabar: fila.sinGrabar,
    estado: fila.estado,
    aviso: fila.aviso,
    motivoError: fila.motivoError,
    createdAt: fila.createdAt,
    empezoEn: fila.empezoEn,
    terminoEn: fila.terminoEn,
    creadaPor: fila.creadaPor?.name?.trim() || fila.creadaPor?.email || null,
    creadaPorId: fila.creadaPorId,
    participantes: fila._count.participantes,
    resumen: resumenDelActa(fila.acta),
    salaFija: fila.salaFija,
  }));
}

export function resumenDelActa(acta: unknown): string | null {
  if (!acta || typeof acta !== "object") {
    return null;
  }
  const resumen = (acta as { resumen?: unknown }).resumen;
  return typeof resumen === "string" && resumen.trim() ? resumen.trim() : null;
}
