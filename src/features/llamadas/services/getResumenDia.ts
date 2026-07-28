import { prisma } from "@/lib/prisma";
import { getCallResultLabel, getCrmLostReasonLabel } from "@/features/crm/domain/crm-config";

// El día del informe es el día en Bogotá (UTC-5), no el del servidor: si no, a las 7pm ya se
// estaría contando el día siguiente.
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

function bogotaDayRange(now: Date) {
  const bogotaNow = new Date(now.getTime() - BOGOTA_OFFSET_MS);
  const startUtc = Date.UTC(bogotaNow.getUTCFullYear(), bogotaNow.getUTCMonth(), bogotaNow.getUTCDate(), 0, 0, 0, 0);
  return {
    start: new Date(startUtc + BOGOTA_OFFSET_MS),
    end: new Date(startUtc + BOGOTA_OFFSET_MS + 24 * 60 * 60 * 1000),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Origen legible del lead. Sale de lo que dejó guardado el webhook al entrar por un anuncio
 * (metadata.source = "meta ads", sourceApp = instagram/facebook…) o de la carga manual.
 */
function resolveLeadOrigin(metadata: unknown): string {
  if (!isRecord(metadata)) {
    return "Otro";
  }

  const raw = (
    readString(metadata.sourceApp) ||
    readString(metadata.source) ||
    readString(metadata.crmOrigin) ||
    readString(metadata.origin) ||
    readString(metadata.leadOrigin) ||
    readString(metadata.campaignSource)
  ).toLowerCase();

  if (!raw) return "Otro";
  if (raw.includes("instagram")) return "Instagram";
  if (raw.includes("facebook") || raw.includes("fb")) return "Facebook";
  if (raw.includes("meta") || raw.includes("ads") || raw.includes("anuncio")) return "Meta Ads";
  if (raw.includes("marketplace")) return "Marketplace";
  if (raw.includes("recomend")) return "Recomendado";
  if (raw.includes("whatsapp")) return "WhatsApp directo";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export type ResumenLlamada = {
  name: string;
  phoneNumber: string;
  resultLabel: string;
  summary: string | null;
  nextContactAt: string | null;
  lostReasonLabel: string | null;
  answered: boolean;
};

export type ResumenDiaData = {
  dateLabel: string;
  advisorName: string;
  // Leads que entraron hoy, con su origen.
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
};

const NO_ANSWER_RESULT = "no_contesto";

export async function getResumenDiaData(input: {
  workspaceId: string;
  userId: string;
  advisorName: string;
}): Promise<ResumenDiaData> {
  const now = new Date();
  const { start, end } = bogotaDayRange(now);

  const dateLabel = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Bogota",
  }).format(now);

  const empty: ResumenDiaData = {
    dateLabel,
    advisorName: input.advisorName,
    newLeads: { total: 0, byOrigin: [] },
    calls: { total: 0, answered: 0, noAnswer: 0, scheduled: 0, items: [] },
    sales: [],
  };

  try {
    const [leads, calls, sales] = await Promise.all([
      prisma.contact.findMany({
        where: { workspaceId: input.workspaceId, excludedFromCrm: false, createdAt: { gte: start, lt: end } },
        select: { metadata: true },
      }),
      prisma.callAttempt.findMany({
        where: { workspaceId: input.workspaceId, calledByUserId: input.userId, calledAt: { gte: start, lt: end } },
        orderBy: { calledAt: "asc" },
        select: {
          result: true,
          summary: true,
          nextContactAt: true,
          lostReason: true,
          contact: { select: { name: true, phoneNumber: true } },
        },
      }),
      prisma.contact.findMany({
        where: { workspaceId: input.workspaceId, crmStage: "GANADO", wonAt: { gte: start, lt: end } },
        select: { name: true, phoneNumber: true },
      }),
    ]);

    const originCounts = new Map<string, number>();
    for (const lead of leads) {
      const origin = resolveLeadOrigin(lead.metadata);
      originCounts.set(origin, (originCounts.get(origin) ?? 0) + 1);
    }

    const items: ResumenLlamada[] = calls.map((call) => ({
      name: call.contact?.name?.trim() || call.contact?.phoneNumber || "Sin nombre",
      phoneNumber: call.contact?.phoneNumber ?? "",
      resultLabel: getCallResultLabel(call.result) ?? call.result,
      summary: call.summary,
      nextContactAt: call.nextContactAt ? call.nextContactAt.toISOString() : null,
      lostReasonLabel: call.lostReason ? getCrmLostReasonLabel(call.lostReason) : null,
      answered: call.result !== NO_ANSWER_RESULT,
    }));

    return {
      dateLabel,
      advisorName: input.advisorName,
      newLeads: {
        total: leads.length,
        byOrigin: Array.from(originCounts.entries())
          .map(([origin, count]) => ({ origin, count }))
          .sort((a, b) => b.count - a.count),
      },
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
