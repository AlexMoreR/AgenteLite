import { prisma } from "@/lib/prisma";

import { rangoDelDia } from "../reglas";
import type {
  AciertoDelCoach,
  ErrorDelCoach,
  PendienteDelCoach,
  PuntajesDelCoach,
  ResumenDeAsesoraGuardado,
  ResumenDelEquipo,
} from "../tipos";

export type ParteDeAsesora = {
  userId: string;
  nombre: string;
  chats: number;
  puntaje: number | null;
  puntajes: PuntajesDelCoach | null;
  aciertos: AciertoDelCoach[];
  errores: ErrorDelCoach[];
  pendientes: PendienteDelCoach[];
  resumen: ResumenDeAsesoraGuardado | null;
};

export type InformeDelCoach = {
  id: string;
  dia: string;
  estado: string;
  origen: string;
  versionPolitica: string;
  modelo: string | null;
  chatsLeidos: number;
  llamadasIA: number;
  tokensEntrada: number;
  tokensSalida: number;
  costoUsd: number;
  error: string | null;
  iniciadoEn: Date;
  terminadoEn: Date | null;
  resumenEquipo: ResumenDelEquipo | null;
  asesoras: ParteDeAsesora[];
};

function lista<T>(valor: unknown): T[] {
  return Array.isArray(valor) ? (valor as T[]) : [];
}

function aParte(fila: {
  userId: string;
  nombre: string;
  chats: number;
  puntaje: { toString(): string } | null;
  puntajes: unknown;
  aciertos: unknown;
  errores: unknown;
  pendientes: unknown;
  resumen: unknown;
}): ParteDeAsesora {
  return {
    userId: fila.userId,
    nombre: fila.nombre,
    chats: fila.chats,
    puntaje: fila.puntaje === null ? null : Number(fila.puntaje.toString()),
    puntajes: (fila.puntajes as PuntajesDelCoach | null) ?? null,
    aciertos: lista<AciertoDelCoach>(fila.aciertos),
    errores: lista<ErrorDelCoach>(fila.errores),
    pendientes: lista<PendienteDelCoach>(fila.pendientes),
    resumen: (fila.resumen as ResumenDeAsesoraGuardado | null) ?? null,
  };
}

/**
 * El informe de un dia. Con `soloUserId`, trae SOLO la parte de esa asesora y sin el resumen del
 * equipo: lo que ve una asesora no incluye a las demas (ni su puntaje ni sus errores).
 */
export async function leerInformeDelCoach(
  workspaceId: string,
  dia: string,
  opciones: { soloUserId?: string } = {},
): Promise<InformeDelCoach | null> {
  const { clave } = rangoDelDia(dia);
  const informe = await prisma.coachInforme.findUnique({
    where: { workspaceId_fecha: { workspaceId, fecha: clave } },
    include: {
      asesoras: {
        where: opciones.soloUserId ? { userId: opciones.soloUserId } : undefined,
        orderBy: { nombre: "asc" },
      },
    },
  });
  if (!informe) return null;
  return {
    id: informe.id,
    dia,
    estado: informe.estado,
    origen: informe.origen,
    versionPolitica: informe.versionPolitica,
    modelo: informe.modelo,
    chatsLeidos: informe.chatsLeidos,
    llamadasIA: informe.llamadasIA,
    tokensEntrada: informe.tokensEntrada,
    tokensSalida: informe.tokensSalida,
    costoUsd: Number(informe.costoUsd.toString()),
    error: informe.error,
    iniciadoEn: informe.iniciadoEn,
    terminadoEn: informe.terminadoEn,
    resumenEquipo: opciones.soloUserId ? null : ((informe.resumenEquipo as ResumenDelEquipo | null) ?? null),
    asesoras: informe.asesoras.map(aParte),
  };
}

/** Para "Mi día": los pendientes que le dejo el coach del ultimo informe listo (de los ultimos 3 dias). */
export async function leerPendientesDelCoach(workspaceId: string, userId: string) {
  const fila = await prisma.coachAsesora.findFirst({
    where: {
      workspaceId,
      userId,
      informe: { estado: "LISTO", fecha: { gte: new Date(Date.now() - 3 * 24 * 3_600_000) } },
    },
    orderBy: { informe: { fecha: "desc" } },
    select: { pendientes: true, informe: { select: { fecha: true } } },
  });
  if (!fila) return null;
  return {
    dia: fila.informe.fecha.toISOString().slice(0, 10),
    pendientes: lista<PendienteDelCoach>(fila.pendientes),
  };
}
