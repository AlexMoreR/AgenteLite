import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { leerResumenDelAgente, type ResumenDelAgente } from "../dominio/reglas";
import { agenteActivo } from "./config";

/**
 * El resumen del día de un agente de área. Un resumen por negocio, área y día: guardarlo dos veces el
 * mismo día lo REEMPLAZA (el PC puede reintentar sin dejar repetidos). `esPrueba` lo decide el servidor:
 * es verdad si el interruptor estaba apagado al guardar.
 */
export async function guardarResumenDelDia(input: {
  workspaceId: string;
  area: string;
  args: Record<string, unknown>;
  hoy: string;
}): Promise<{ fecha: string; esPrueba: boolean; reemplazo: boolean }> {
  const resumen: ResumenDelAgente = leerResumenDelAgente(input.args, input.hoy, input.area);
  const esPrueba = !(await agenteActivo(input.workspaceId, input.area));
  const datos = {
    esPrueba,
    salioTarde: resumen.salioTarde,
    notaTarde: resumen.notaTarde,
    numeros: (resumen.numeros ?? undefined) as Prisma.InputJsonValue | undefined,
    meta: (resumen.meta ?? undefined) as Prisma.InputJsonValue | undefined,
    subagentes: resumen.subagentes as Prisma.InputJsonValue,
    sugeridos: resumen.sugeridos as unknown as Prisma.InputJsonValue,
    textoAlexander: resumen.textoAlexander,
  };
  const donde = { workspaceId_area_fecha: { workspaceId: input.workspaceId, area: input.area, fecha: resumen.fecha } };
  const previo = await prisma.agenteDeAreaDia.findUnique({ where: donde, select: { id: true } });
  await prisma.agenteDeAreaDia.upsert({
    where: donde,
    create: { workspaceId: input.workspaceId, area: input.area, fecha: resumen.fecha, ...datos },
    update: datos,
  });
  return { fecha: resumen.fecha, esPrueba, reemplazo: !!previo };
}

export async function leerResumenesRecientes(workspaceId: string, area: string, limite = 14) {
  return prisma.agenteDeAreaDia.findMany({
    where: { workspaceId, area },
    orderBy: { fecha: "desc" },
    take: limite,
  });
}

export async function leerEnviosDelDia(workspaceId: string, area: string, fecha: string) {
  return prisma.agenteDeAreaEnvio.findMany({
    where: { workspaceId, area, fecha },
    orderBy: { createdAt: "asc" },
  });
}

/** Cuántos mensajes salieron y cuántos se bloquearon, por día (para el historial). */
export async function contarEnvios(workspaceId: string, area: string, fechas: string[]) {
  if (!fechas.length) return new Map<string, { enviados: number; bloqueados: number }>();
  const filas = await prisma.agenteDeAreaEnvio.findMany({
    where: { workspaceId, area, fecha: { in: fechas } },
    select: { fecha: true, estado: true },
  });
  const cuenta = new Map<string, { enviados: number; bloqueados: number }>();
  for (const fila of filas) {
    const actual = cuenta.get(fila.fecha) ?? { enviados: 0, bloqueados: 0 };
    if (fila.estado === "ENVIADO") actual.enviados += 1;
    else if (fila.estado === "BLOQUEADO" || fila.estado === "FALLO") actual.bloqueados += 1;
    cuenta.set(fila.fecha, actual);
  }
  return cuenta;
}
