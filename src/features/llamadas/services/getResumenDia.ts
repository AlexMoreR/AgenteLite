import { prisma } from "@/lib/prisma";
import { getCallResultLabel, getCrmLostReasonLabel } from "@/features/crm/domain/crm-config";
import { hoyEnBogota } from "@/features/agentes-de-area/dominio/reglas";
import { rangoDelDia } from "@/features/agentes-de-area/servicios/numeros";
import type { DesgloseDeOrigen, LeadsNuevosAgrupados } from "@/features/leads-nuevos/dominio/reglas";
import { leadsNuevosDelDia } from "@/features/leads-nuevos/servicios/leads-nuevos-del-dia";

// El día del informe es el día en Bogotá (UTC-5), no el del servidor: sale de hoyEnBogota.

export type ResumenLlamada = {
  name: string;
  phoneNumber: string;
  resultLabel: string;
  summary: string | null;
  nextContactAt: string | null;
  lostReasonLabel: string | null;
  answered: boolean;
  /** Solo las llamadas hechas desde el marcador del CRM tienen audio. */
  recordingUrl: string | null;
};

export type ResumenDiaData = {
  dateLabel: string;
  /** Día del informe en Colombia (AAAA-MM-DD). */
  date: string;
  advisorName: string;
  // SUS leads nuevos de hoy (chats asignados a ella), por origen.
  newLeads: { total: number; porOrigen: DesgloseDeOrigen };
  /** Conteo de toda la empresa; solo para el dueño y las administradoras. */
  empresa: LeadsNuevosAgrupados | null;
  // Llamadas que registró ESTA asesora hoy.
  calls: {
    total: number;
    answered: number;
    noAnswer: number;
    scheduled: number;
    items: ResumenLlamada[];
  };
  // Ventas cerradas hoy (fecha real de venta).
  sales: Array<{ name: string; phoneNumber: string }>;
};

const NO_ANSWER_RESULT = "no_contesto";

export async function getResumenDiaData(input: {
  workspaceId: string;
  userId: string;
  advisorName: string;
  esJefe?: boolean;
}): Promise<ResumenDiaData> {
  const now = new Date();
  const hoy = hoyEnBogota(now);
  const { desde: start, hasta: end } = rangoDelDia(hoy);

  const dateLabel = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Bogota",
  }).format(now);

  const empty: ResumenDiaData = {
    dateLabel,
    date: hoy,
    advisorName: input.advisorName,
    newLeads: { total: 0, porOrigen: { meta: 0, marketplace: { total: 0, por_texto: 0, por_linea: 0 }, directo: 0 } },
    empresa: null,
    calls: { total: 0, answered: 0, noAnswer: 0, scheduled: 0, items: [] },
    sales: [],
  };

  try {
    const [leads, empresa, calls, sales] = await Promise.all([
      leadsNuevosDelDia(input.workspaceId, hoy, { asesoraId: input.userId }),
      input.esJefe ? leadsNuevosDelDia(input.workspaceId, hoy).catch(() => null) : Promise.resolve(null),
      prisma.callAttempt.findMany({
        where: { workspaceId: input.workspaceId, calledByUserId: input.userId, calledAt: { gte: start, lt: end } },
        orderBy: { calledAt: "asc" },
        select: {
          result: true,
          summary: true,
          nextContactAt: true,
          lostReason: true,
          recordingUrl: true,
          contact: { select: { name: true, phoneNumber: true } },
        },
      }),
      prisma.contact.findMany({
        // Solo las ventas de sus chats.
        where: {
          workspaceId: input.workspaceId,
          crmStage: "GANADO",
          wonAt: { gte: start, lt: end },
          conversations: { some: { assignedToUserId: input.userId } },
        },
        select: { name: true, phoneNumber: true },
      }),
    ]);

    const items: ResumenLlamada[] = calls.map((call) => ({
      name: call.contact?.name?.trim() || call.contact?.phoneNumber || "Sin nombre",
      phoneNumber: call.contact?.phoneNumber ?? "",
      resultLabel: getCallResultLabel(call.result) ?? call.result,
      summary: call.summary,
      nextContactAt: call.nextContactAt ? call.nextContactAt.toISOString() : null,
      lostReasonLabel: call.lostReason ? getCrmLostReasonLabel(call.lostReason) : null,
      answered: call.result !== NO_ANSWER_RESULT,
      recordingUrl: call.recordingUrl,
    }));

    return {
      dateLabel,
      advisorName: input.advisorName,
      date: hoy,
      newLeads: { total: leads.total, porOrigen: leads.por_origen },
      empresa,
      calls: {
        total: items.length,
        answered: items.filter((item) => item.answered).length,
        noAnswer: items.filter((item) => !item.answered).length,
        scheduled: items.filter((item) => item.nextContactAt).length,
        items,
      },
      sales: sales.map((sale) => ({
        name: sale.name?.trim() || sale.phoneNumber,
        phoneNumber: sale.phoneNumber,
      })),
    };
  } catch (error) {
    console.error("[getResumenDiaData] error", error);
    return empty;
  }
}
