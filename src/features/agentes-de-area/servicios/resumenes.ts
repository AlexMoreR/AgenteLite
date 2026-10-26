import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import type { Area, ResumenAGuardar } from "../dominio/reglas";

/**
 * EL RESUMEN DEL DÍA DEL AGENTE DE ÁREA. Un resumen por negocio, área y día: si se guarda dos veces
 * el mismo día se REEMPLAZA (no queda repetido).
 */

// Prisma pide un valor especial para guardar un JSON vacío: DbNull deja la columna en NULL.
const json = (valor: unknown) => (valor === null || valor === undefined ? Prisma.DbNull : (valor as Prisma.InputJsonValue));

export async function guardarResumenDelDia(workspaceId: string, area: Area, resumen: ResumenAGuardar) {
  const datos = {
    esPrueba: resumen.esPrueba,
    salioTarde: resumen.salioTarde,
    notaDeRetraso: resumen.notaDeRetraso,
    numeros: json(resumen.numeros),
    meta: json(resumen.meta),
    subagentes: json(resumen.subagentes),
    sugeridos: json(resumen.sugeridos),
    mensajes: json(resumen.mensajes),
    resumen: resumen.resumen,
  };
  return prisma.agenteDeAreaDia.upsert({
    where: { workspaceId_area_fecha: { workspaceId, area, fecha: resumen.fecha } },
    create: { workspaceId, area, fecha: resumen.fecha, ...datos },
    update: datos,
  });
}

export async function leerResumenDelDia(workspaceId: string, area: Area, fecha: string) {
  return prisma.agenteDeAreaDia.findUnique({ where: { workspaceId_area_fecha: { workspaceId, area, fecha } } });
}

export async function leerUltimosResumenes(workspaceId: string, area: Area, cuantos = 14) {
  return prisma.agenteDeAreaDia.findMany({
    where: { workspaceId, area },
    orderBy: { fecha: "desc" },
    take: cuantos,
    select: { fecha: true, esPrueba: true, salioTarde: true, resumen: true, actualizadoEn: true },
  });
}

export async function leerEnviosDelDia(workspaceId: string, area: Area, fecha: string) {
  return prisma.agenteDeAreaEnvio.findMany({
    where: { workspaceId, area, fecha },
    orderBy: { creadoEn: "asc" },
    select: { id: true, tipo: true, numero: true, destinatario: true, texto: true, estado: true, motivo: true, creadoEn: true },
  });
}
