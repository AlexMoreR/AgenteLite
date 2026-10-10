import { prisma } from "@/lib/prisma";

import { elegirHabilidades } from "../habilidad";
import { informeColgado, rangoDelDia } from "../reglas";
import type {
  AciertoDelCoach,
  ErrorDelCoach,
  HabilidadDelDia,
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
  /** EN_CURSO de hace mas de 30 min: el servidor se reinicio y ya no esta corriendo. */
  colgado: boolean;
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
 * Informes de antes de habilidad-v1 (hasta el 9-oct) no traen la habilidad del dia: se calcula al
 * leer con el mismo codigo (puro, sin IA) y los errores ya guardados de TODAS las asesoras (para
 * saber que es del equipo). No escribe nada en la base.
 */
function completarHabilidades(partes: ParteDeAsesora[], dia: string) {
  const faltan = partes.some((p) => p.resumen && p.resumen.habilidad === undefined);
  const { porAsesora, problemasDelEquipo } = elegirHabilidades(
    partes.map((p) => ({
      userId: p.userId,
      nombre: p.nombre,
      errores: p.errores,
      puntajes: p.puntajes,
      pendientes: p.pendientes,
      metricas: p.resumen?.metricas ?? null,
    })),
    dia,
  );
  if (faltan) {
    for (const parte of partes) {
      if (parte.resumen && parte.resumen.habilidad === undefined) {
        parte.resumen = { ...parte.resumen, habilidad: porAsesora.get(parte.userId) ?? null };
      }
    }
  }
  return problemasDelEquipo;
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
    // Todas las asesoras: la habilidad de un informe viejo se calcula con las demas (equipo);
    // con `soloUserId` se filtra abajo y la asesora no recibe las otras partes.
    include: { asesoras: { orderBy: { nombre: "asc" } } },
  });
  if (!informe) return null;
  const todas = informe.asesoras.map(aParte);
  const problemas = informe.estado === "LISTO" ? completarHabilidades(todas, dia) : [];
  const resumenEquipo = (informe.resumenEquipo as ResumenDelEquipo | null) ?? null;
  return {
    id: informe.id,
    dia,
    estado: informe.estado,
    colgado: informeColgado(informe),
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
    resumenEquipo:
      opciones.soloUserId || !resumenEquipo
        ? null
        : { ...resumenEquipo, problemasDelEquipo: resumenEquipo.problemasDelEquipo ?? problemas },
    asesoras: opciones.soloUserId ? todas.filter((p) => p.userId === opciones.soloUserId) : todas,
  };
}

/**
 * Para "Mi día": los pendientes y la habilidad que le dejo el coach del ultimo informe listo (de
 * los ultimos 3 dias). Solo lo suyo: las demas partes se leen solo para calcular la habilidad de
 * un informe viejo y no salen de aca.
 */
export async function leerPendientesDelCoach(workspaceId: string, userId: string) {
  const fila = await prisma.coachAsesora.findFirst({
    where: {
      workspaceId,
      userId,
      informe: { estado: "LISTO", fecha: { gte: new Date(Date.now() - 3 * 24 * 3_600_000) } },
    },
    orderBy: { informe: { fecha: "desc" } },
    select: { pendientes: true, resumen: true, informeId: true, informe: { select: { fecha: true } } },
  });
  if (!fila) return null;
  const dia = fila.informe.fecha.toISOString().slice(0, 10);
  const resumen = (fila.resumen as ResumenDeAsesoraGuardado | null) ?? null;
  let habilidad: HabilidadDelDia | null = resumen?.habilidad ?? null;
  if (resumen && resumen.habilidad === undefined) {
    const filas = await prisma.coachAsesora.findMany({ where: { informeId: fila.informeId } });
    const todas = filas.map(aParte);
    completarHabilidades(todas, dia);
    habilidad = todas.find((p) => p.userId === userId)?.resumen?.habilidad ?? null;
  }
  return { dia, pendientes: lista<PendienteDelCoach>(fila.pendientes), habilidad };
}
