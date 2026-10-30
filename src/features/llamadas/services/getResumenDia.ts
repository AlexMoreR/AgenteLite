import { prisma } from "@/lib/prisma";
import { getCallResultLabel, getCrmLostReasonLabel } from "@/features/crm/domain/crm-config";
import { hoyEnBogota } from "@/features/agentes-de-area/dominio/reglas";
import type { DesgloseDeOrigen } from "@/features/leads-nuevos/dominio/reglas";
import { leadsNuevosDelDia, type LeadsNuevosDelDia } from "@/features/leads-nuevos/servicios/leads-nuevos-del-dia";

// El día del informe es el día en Bogotá (UTC-5), no el del servidor: si no, a las 7pm ya se
// estaría contando el día siguiente. La fecha sale de hoyEnBogota, la misma que usa el MCP.
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

function bogotaDayRange(fecha: string) {
  const start = new Date(new Date(`${fecha}T00:00:00Z`).getTime() + BOGOTA_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** Los orígenes del lead nuevo, con el nombre que se lee en el informe (solo los que tienen algo). */
function origenesLegibles(origen: DesgloseDeOrigen): Array<{ origin: string; count: number }> {
  return [
    { origin: "Meta", count: origen.meta },
    { origin: "Marketplace (por texto)", count: origen.marketplace.por_texto },
    { origin: "Marketplace (por línea)", count: origen.marketplace.por_linea },
    { origin: "Directo", count: origen.directo },
  ].filter((fila) => fila.count > 0);
}

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
  /** Día del informe, AAAA-MM-DD, en hora de Colombia. */
  fecha: string;
  dateLabel: string;
  advisorName: string;
  // Leads nuevos de ESTA asesora hoy (primer mensaje de la vida del cliente), por origen.
  newLeads: { total: number; byOrigin: Array<{ origin: string; count: number }> };
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
  // Conteo de toda la empresa: solo para el dueño y las administradoras (null para una asesora).
  empresa: LeadsNuevosDelDia | null;
};

const NO_ANSWER_RESULT = "no_contesto";

export async function getResumenDiaData(input: {
  workspaceId: string;
  userId: string;
  advisorName: string;
  esJefe?: boolean;
}): Promise<ResumenDiaData> {
  const now = new Date();
  const fecha = hoyEnBogota(now);
  const { start, end } = bogotaDayRange(fecha);

  const dateLabel = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Bogota",
  }).format(now);

  const empty: ResumenDiaData = {
    fecha,
    dateLabel,
    advisorName: input.advisorName,
    newLeads: { total: 0, byOrigin: [] },
    calls: { total: 0, answered: 0, noAnswer: 0, scheduled: 0, items: [] },
    sales: [],
    empresa: null,
  };

  try {
    const [leads, empresa, calls, sales] = await Promise.all([
      leadsNuevosDelDia(input.workspaceId, fecha, { asesoraId: input.userId }),
      input.esJefe ? leadsNuevosDelDia(input.workspaceId, fecha) : Promise.resolve(null),
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
        // Solo las ventas de SUS chats, no las de toda la empresa.
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
      fecha,
      dateLabel,
      advisorName: input.advisorName,
      newLeads: { total: leads.total, byOrigin: origenesLegibles(leads.por_origen) },
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
      empresa,
    };
  } catch (error) {
    console.error("[getResumenDiaData] error", error);
    return empty;
  }
}
