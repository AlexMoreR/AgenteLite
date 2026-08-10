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
  // Rango que se esta mirando (YYYY-MM-DD, hora de Bogota). Los dos inclusive.
  desde: string;
  hasta: string;
  leadsACargo: number;
  porEtapa: Array<{ stage: CrmStage; count: number }>;
  // Los tres, DENTRO del rango elegido.
  movidos: number;
  llamadas: number;
  ventas: number;
  // Leads suyos, vivos, que llevan +5 dias sin que nadie los toque. Es la fuga personal.
  // Va contra HOY siempre: "se enfria" es una alerta del presente, no del rango.
  enfriandose: number;
};

const ETAPAS_VIVAS: CrmStage[] = ["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION"];

export async function getMiTableroData(input: {
  workspaceId: string;
  userId: string;
  advisorName: string;
  // Rango a mirar (YYYY-MM-DD, los dos inclusive). Sin esto, hoy.
  desde?: string | null;
  hasta?: string | null;
}): Promise<MiTableroData> {
  const now = new Date();
  const esFecha = (valor?: string | null) => Boolean(valor?.match(/^\d{4}-\d{2}-\d{2}$/));
  const hoy = diaDeHoyBogota(now);

  // Si viene al reves (se eligio primero el final), se da vuelta en vez de devolver cero.
  let desdeTexto = esFecha(input.desde) ? input.desde! : hoy;
  let hastaTexto = esFecha(input.hasta) ? input.hasta! : desdeTexto;
  if (desdeTexto > hastaTexto) {
    [desdeTexto, hastaTexto] = [hastaTexto, desdeTexto];
  }

  const inicioRango = inicioDeLaFecha(desdeTexto, now);
  // El final es INCLUSIVE: se suma un dia para abarcar hasta las 23:59 del ultimo.
  const finRango = new Date(inicioDeLaFecha(hastaTexto, now).getTime() + 24 * 60 * 60 * 1000);
  const hace5Dias = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

  const vacio: MiTableroData = {
    generatedAt: now.toISOString(),
    advisorName: input.advisorName,
    desde: desdeTexto,
    hasta: hastaTexto,
    leadsACargo: 0,
    porEtapa: [],
    movidos: 0,
    llamadas: 0,
    ventas: 0,
    enfriandose: 0,
  };

  try {
    const mias = { workspaceId: input.workspaceId, assignedToUserId: input.userId };

    const [leadsACargo, movidos, ventas, enfriandose, llamadas] = await Promise.all([
      prisma.conversation.count({
        where: { ...mias, contact: { excludedFromCrm: false } },
      }),
      prisma.conversation.count({
        where: {
          ...mias,
          lastMessageAt: { gte: inicioRango, lt: finRango },
          contact: { excludedFromCrm: false },
        },
      }),
      prisma.conversation.count({
        where: { ...mias, contact: { crmStage: "GANADO", wonAt: { gte: inicioRango, lt: finRango } } },
      }),
      prisma.conversation.count({
        where: {
          ...mias,
          lastMessageAt: { lt: hace5Dias },
          contact: { excludedFromCrm: false, crmStage: { in: ETAPAS_VIVAS } },
        },
      }),
      prisma.callAttempt.count({
        where: {
          workspaceId: input.workspaceId,
          calledByUserId: input.userId,
          calledAt: { gte: inicioRango, lt: finRango },
        },
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
      movidos,
      llamadas,
      ventas,
      enfriandose,
    };
  } catch (error) {
    console.error("[getMiTableroData] error", error);
    return vacio;
  }
}
