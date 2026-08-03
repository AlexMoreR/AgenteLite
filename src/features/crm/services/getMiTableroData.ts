import { prisma } from "@/lib/prisma";
import type { CrmStage } from "@/features/crm/types";

/**
 * El tablero de UNA asesora.
 *
 * El informe del CRM es del negocio: sirve para el jefe, pero a quien vende no le dice nada
 * sobre su propio trabajo (y de paso le muestra las ventas de las companeras). Esto responde
 * cuatro preguntas suyas: cuantos leads tengo, cuantos movi hoy, cuanto llame, cuanto cerre.
 *
 * Todo sale de la ASIGNACION del chat, que ahora se reparte sola: la primera que contesta un
 * chat sin dueño se lo queda.
 */

const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

function inicioDelDiaBogota(now: Date) {
  const enBogota = new Date(now.getTime() - BOGOTA_OFFSET_MS);
  const medianoche = Date.UTC(enBogota.getUTCFullYear(), enBogota.getUTCMonth(), enBogota.getUTCDate());
  return new Date(medianoche + BOGOTA_OFFSET_MS);
}

/** "2026-08-03" (dia de Bogota) -> el instante en que arranca ese dia. */
function inicioDeLaFecha(dia: string | null, now: Date): Date {
  const partes = (dia ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!partes) {
    return inicioDelDiaBogota(now);
  }
  const medianoche = Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
  return new Date(medianoche + BOGOTA_OFFSET_MS);
}

/** El dia de hoy en Bogota, en el formato del <input type="date">. */
export function diaDeHoyBogota(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(now);
}

export type MiTableroData = {
  generatedAt: string;
  advisorName: string;
  // Dia que se esta mirando (YYYY-MM-DD, hora de Bogota).
  dia: string;
  leadsACargo: number;
  porEtapa: Array<{ stage: CrmStage; count: number }>;
  movidosHoy: number;
  llamadasHoy: number;
  llamadasSemana: number;
  ventasSemana: number;
  // Ventas cerradas EN ese dia (el de arriba son los ultimos 7 dias).
  ventasDelDia: number;
  // Leads suyos, vivos, que llevan +5 dias sin que nadie los toque. Es la fuga personal.
  enfriandose: number;
};

const ETAPAS_VIVAS: CrmStage[] = ["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION"];

export async function getMiTableroData(input: {
  workspaceId: string;
  userId: string;
  advisorName: string;
  // Dia a mirar (YYYY-MM-DD). Sin esto, hoy.
  dia?: string | null;
}): Promise<MiTableroData> {
  const now = new Date();
  const inicioHoy = inicioDeLaFecha(input.dia ?? null, now);
  const finHoy = new Date(inicioHoy.getTime() + 24 * 60 * 60 * 1000);
  const inicioSemana = new Date(inicioHoy.getTime() - 6 * 24 * 60 * 60 * 1000);
  const diaMirado = input.dia?.match(/^\d{4}-\d{2}-\d{2}$/) ? input.dia : diaDeHoyBogota(now);
  const hace5Dias = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

  const vacio: MiTableroData = {
    generatedAt: now.toISOString(),
    advisorName: input.advisorName,
    dia: diaMirado,
    leadsACargo: 0,
    porEtapa: [],
    movidosHoy: 0,
    llamadasHoy: 0,
    llamadasSemana: 0,
    ventasSemana: 0,
    ventasDelDia: 0,
    enfriandose: 0,
  };

  try {
    const mias = { workspaceId: input.workspaceId, assignedToUserId: input.userId };

    const [leadsACargo, movidosHoy, ventasSemana, ventasDelDia, enfriandose, llamadas] = await Promise.all([
      prisma.conversation.count({
        where: { ...mias, contact: { excludedFromCrm: false } },
      }),
      prisma.conversation.count({
        where: {
          ...mias,
          lastMessageAt: { gte: inicioHoy, lt: finHoy },
          contact: { excludedFromCrm: false },
        },
      }),
      prisma.conversation.count({
        where: { ...mias, contact: { crmStage: "GANADO", wonAt: { gte: inicioSemana, lt: finHoy } } },
      }),
      prisma.conversation.count({
        where: { ...mias, contact: { crmStage: "GANADO", wonAt: { gte: inicioHoy, lt: finHoy } } },
      }),
      prisma.conversation.count({
        where: {
          ...mias,
          lastMessageAt: { lt: hace5Dias },
          contact: { excludedFromCrm: false, crmStage: { in: ETAPAS_VIVAS } },
        },
      }),
      prisma.callAttempt.findMany({
        where: {
          workspaceId: input.workspaceId,
          calledByUserId: input.userId,
          calledAt: { gte: inicioSemana, lt: finHoy },
        },
        select: { calledAt: true },
      }),
    ]);

    // El desglose por etapa se cuenta sobre los contactos de SUS chats.
    const etapas = await prisma.contact.groupBy({
      by: ["crmStage"],
      where: {
        workspaceId: input.workspaceId,
        excludedFromCrm: false,
        conversations: { some: { assignedToUserId: input.userId } },
      },
      _count: { _all: true },
    });

    const porEtapaOrdenado = [...ETAPAS_VIVAS, "GANADO" as CrmStage, "PERDIDO" as CrmStage].map((stage) => ({
      stage,
      count: etapas.find((fila) => fila.crmStage === stage)?._count._all ?? 0,
    }));

    return {
      ...vacio,
      leadsACargo,
      porEtapa: porEtapaOrdenado,
      movidosHoy,
      llamadasHoy: llamadas.filter(
        (llamada) => llamada.calledAt >= inicioHoy && llamada.calledAt < finHoy,
      ).length,
      llamadasSemana: llamadas.length,
      ventasSemana,
      ventasDelDia: ventasDelDia,
      enfriandose,
    };
  } catch (error) {
    console.error("[getMiTableroData] error", error);
    return vacio;
  }
}
