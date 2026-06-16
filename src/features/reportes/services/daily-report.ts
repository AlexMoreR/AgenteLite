import { randomUUID } from "crypto";

import { Prisma, type ReportSentiment } from "@prisma/client";

import { getPublicBaseUrl } from "@/lib/app-url";
import { sendEvolutionTextMessageWithReconnect } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";

// Colombia no tiene horario de verano: offset fijo UTC-5.
const BOGOTA_OFFSET_MINUTES = -5 * 60;
const MAX_TABLE_ROWS = 50;

export type DailyReportRow = {
  phone: string;
  name: string;
  tags: Array<{ name: string; color: string }>;
  summary: string;
  stage: string;
};

export type DailyReportMetrics = {
  inboundCount: number;
  outboundCount: number;
  newContacts: number;
  wonCount: number;
  lostCount: number;
  wonAmount: number;
  lostAmount: number;
  rows: DailyReportRow[];
};

/**
 * Devuelve el rango [inicio, fin) del día indicado (o de hoy) en America/Bogota,
 * expresado como instantes UTC para consultar la BD.
 */
export function resolveBogotaDayRange(date?: Date): { dayStart: Date; dayEnd: Date; reportDate: Date } {
  const base = date ?? new Date();
  // Llevar el instante a "hora local Bogota" sumando el offset, para extraer Y-M-D local.
  const local = new Date(base.getTime() + BOGOTA_OFFSET_MINUTES * 60 * 1000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  // Medianoche local de ese día, convertida a UTC (restar el offset).
  const dayStart = new Date(Date.UTC(y, m, d, 0, 0, 0) - BOGOTA_OFFSET_MINUTES * 60 * 1000);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  // reportDate: usamos la medianoche UTC del día local como ancla estable para el @@unique.
  const reportDate = new Date(Date.UTC(y, m, d, 0, 0, 0));
  return { dayStart, dayEnd, reportDate };
}

/** Construye un YYYY-MM-DD a partir de la fecha local de Bogota. */
export function formatBogotaDate(date: Date): string {
  const local = new Date(date.getTime() + BOGOTA_OFFSET_MINUTES * 60 * 1000);
  const y = local.getUTCFullYear();
  const m = `${local.getUTCMonth() + 1}`.padStart(2, "0");
  const d = `${local.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parsea YYYY-MM-DD a un instante (mediodía UTC) seguro para resolver el día local. */
export function parseBogotaDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const [, y, m, d] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 12, 0, 0));
}

const STAGE_LABELS: Record<string, string> = {
  NUEVO: "Nuevo",
  CALIFICADO: "Calificado",
  PROPUESTA: "Propuesta",
  NEGOCIACION: "Negociación",
  GANADO: "Ganado",
  PERDIDO: "Perdido",
};

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

export async function computeDailyMetrics(
  workspaceId: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<DailyReportMetrics> {
  const range = { gte: dayStart, lt: dayEnd };

  const contactSelect = {
    id: true,
    name: true,
    phoneNumber: true,
    aiSummary: true,
    crmStage: true,
    ContactTag: { select: { Tag: { select: { name: true, color: true } } } },
  } as const;

  const [inboundCount, outboundCount, newContactsList, movedContacts, messagedContacts, incomeAgg, expenseAgg] =
    await Promise.all([
      prisma.message.count({
        where: { workspaceId, direction: "INBOUND", isStatusBroadcast: false, createdAt: range },
      }),
      prisma.message.count({
        where: { workspaceId, direction: "OUTBOUND", isStatusBroadcast: false, createdAt: range },
      }),
      prisma.contact.findMany({
        where: { workspaceId, createdAt: range },
        orderBy: { createdAt: "desc" },
        select: contactSelect,
      }),
      prisma.contact.findMany({
        where: { workspaceId, crmStage: { in: ["GANADO", "PERDIDO"] }, updatedAt: range },
        orderBy: { updatedAt: "desc" },
        select: contactSelect,
      }),
      // Contactos que intercambiaron mensajes hoy (aunque no sean nuevos ni cambiaran de etapa).
      prisma.contact.findMany({
        where: {
          workspaceId,
          messages: { some: { isStatusBroadcast: false, createdAt: range } },
        },
        orderBy: { updatedAt: "desc" },
        take: MAX_TABLE_ROWS,
        select: contactSelect,
      }),
      // Aproximación de monto ganado/perdido: ingresos/egresos del día (el contacto no tiene importe propio).
      prisma.financeTransaction.aggregate({
        where: { workspaceId, type: "INCOME", date: range },
        _sum: { amount: true },
      }),
      prisma.financeTransaction.aggregate({
        where: { workspaceId, type: "EXPENSE", date: range },
        _sum: { amount: true },
      }),
    ]);

  const wonCount = movedContacts.filter((c) => c.crmStage === "GANADO").length;
  const lostCount = movedContacts.filter((c) => c.crmStage === "PERDIDO").length;

  // Combinar (sin duplicar): cambiaron de etapa → con mensajes hoy → nuevos.
  const byId = new Map<string, (typeof messagedContacts)[number]>();
  for (const c of [...movedContacts, ...messagedContacts, ...newContactsList]) {
    if (!byId.has(c.id)) {
      byId.set(c.id, c);
    }
  }

  const rows: DailyReportRow[] = Array.from(byId.values())
    .slice(0, MAX_TABLE_ROWS)
    .map((c) => ({
      phone: c.phoneNumber ?? "",
      name: c.name?.trim() || "Sin nombre",
      tags: c.ContactTag.map((ct) => ({ name: ct.Tag.name, color: ct.Tag.color })),
      summary: c.aiSummary?.trim() || "",
      stage: c.crmStage,
    }));

  return {
    inboundCount,
    outboundCount,
    newContacts: newContactsList.length,
    wonCount,
    lostCount,
    wonAmount: Number(incomeAgg._sum.amount ?? 0),
    lostAmount: Number(expenseAgg._sum.amount ?? 0),
    rows,
  };
}

type ReportInsight = { sentiment: ReportSentiment; summary: string };

const INSIGHT_SYSTEM_PROMPT = [
  "Eres un analista comercial. Recibes las métricas del día de un negocio que atiende clientes por WhatsApp.",
  "Devuelve SOLO un JSON válido con esta forma exacta:",
  '{"sentiment":"SAD|NEUTRAL|HAPPY","summary":"..."}',
  "sentiment = HAPPY si el día fue bueno (varias ventas ganadas o buena actividad),",
  "NEUTRAL si fue un día normal, SAD si no se logró nada relevante (0 ventas y poca actividad).",
  "summary: 1-2 frases en español, tono cercano y honesto, sin saludar ni usar viñetas. Máximo 280 caracteres.",
].join(" ");

function buildInsightInput(metrics: DailyReportMetrics): string {
  return [
    `Mensajes recibidos: ${metrics.inboundCount}`,
    `Mensajes enviados: ${metrics.outboundCount}`,
    `Personas nuevas: ${metrics.newContacts}`,
    `Negocios ganados: ${metrics.wonCount}`,
    `Negocios perdidos: ${metrics.lostCount}`,
    `Ingresos del día: ${metrics.wonAmount}`,
  ].join("\n");
}

function heuristicInsight(metrics: DailyReportMetrics): ReportInsight {
  if (metrics.wonCount > 0 || metrics.wonAmount > 0) {
    return {
      sentiment: "HAPPY",
      summary: `¡Buen día! ${metrics.wonCount} negocio(s) ganado(s) y ${metrics.newContacts} persona(s) nueva(s).`,
    };
  }
  if (metrics.inboundCount === 0 && metrics.newContacts === 0) {
    return {
      sentiment: "SAD",
      summary: "Hoy no hubo actividad: ni mensajes ni contactos nuevos. Vale la pena retomar el seguimiento.",
    };
  }
  return {
    sentiment: "NEUTRAL",
    summary: `Día con movimiento: ${metrics.inboundCount} mensaje(s) y ${metrics.newContacts} persona(s) nueva(s), sin ventas cerradas.`,
  };
}

async function callOpenAIInsight(input: string, apiKey: string): Promise<ReportInsight | null> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: INSIGHT_SYSTEM_PROMPT },
        { role: "user", content: `Métricas:\n${input}` },
      ],
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}`);
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
  return parseInsight(data.choices?.[0]?.message?.content);
}

async function callGeminiInsight(input: string, apiKey: string): Promise<ReportInsight | null> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: INSIGHT_SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: `Métricas:\n${input}` }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 200, responseMimeType: "application/json" },
      }),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(`Gemini ${response.status}`);
  }
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text?.trim() || "").find(Boolean);
  return parseInsight(text);
}

function parseInsight(raw: string | null | undefined): ReportInsight | null {
  if (!raw) {
    return null;
  }
  try {
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned) as { sentiment?: string; summary?: string };
    const sentiment = parsed.sentiment?.toUpperCase();
    if (sentiment !== "SAD" && sentiment !== "NEUTRAL" && sentiment !== "HAPPY") {
      return null;
    }
    return {
      sentiment,
      summary: (parsed.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 280),
    };
  } catch {
    return null;
  }
}

export async function generateReportInsight(metrics: DailyReportMetrics): Promise<ReportInsight> {
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  const input = buildInsightInput(metrics);

  const attempts: Array<{ provider: string; run: () => Promise<ReportInsight | null> }> = [];
  if (openAiApiKey) {
    attempts.push({ provider: "openai", run: () => callOpenAIInsight(input, openAiApiKey) });
  }
  if (geminiApiKey) {
    attempts.push({ provider: "gemini", run: () => callGeminiInsight(input, geminiApiKey) });
  }

  for (const attempt of attempts) {
    try {
      const insight = await attempt.run();
      if (insight && insight.summary) {
        return insight;
      }
    } catch (error) {
      console.error(`[DAILY_REPORT] insight_failed:${attempt.provider}`, error);
    }
  }

  return heuristicInsight(metrics);
}

const SENTIMENT_FACE: Record<ReportSentiment, string> = {
  SAD: "😞",
  NEUTRAL: "😐",
  HAPPY: "😀",
};

function buildWhatsAppMessage(reportDate: Date, metrics: DailyReportMetrics, insight: ReportInsight, url: string) {
  const face = SENTIMENT_FACE[insight.sentiment];
  return [
    `${face} *Reporte del día ${formatBogotaDate(reportDate)}*`,
    "",
    insight.summary,
    "",
    `📥 Mensajes recibidos: ${metrics.inboundCount}`,
    `👤 Personas nuevas: ${metrics.newContacts}`,
    `✅ Ganados: ${metrics.wonCount}`,
    `❌ Perdidos: ${metrics.lostCount}`,
    "",
    `🔗 Ver reporte: ${url}`,
  ].join("\n");
}

/** Selecciona un canal Evolution activo del workspace para enviar el reporte. */
async function resolveSendingInstance(workspaceId: string): Promise<string | null> {
  const channel = await prisma.whatsAppChannel.findFirst({
    where: { workspaceId, provider: "EVOLUTION", isActive: true, evolutionInstanceName: { not: null } },
    orderBy: [{ status: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
    select: { evolutionInstanceName: true },
  });
  return channel?.evolutionInstanceName?.trim() || null;
}

export type GenerateReportResult = {
  reportId: string;
  shareToken: string;
  reportDate: Date;
  sentiment: ReportSentiment;
  delivered: string[];
};

export async function generateDailyReportForWorkspace(
  workspaceId: string,
  options: { date?: Date; force?: boolean } = {},
): Promise<GenerateReportResult> {
  const { dayStart, dayEnd, reportDate } = resolveBogotaDayRange(options.date);

  const metrics = await computeDailyMetrics(workspaceId, dayStart, dayEnd);
  const insight = await generateReportInsight(metrics);

  const shareToken = randomUUID().replace(/-/g, "");

  const report = await prisma.dailyReport.upsert({
    where: { workspaceId_reportDate: { workspaceId, reportDate } },
    create: {
      workspaceId,
      reportDate,
      shareToken,
      inboundCount: metrics.inboundCount,
      outboundCount: metrics.outboundCount,
      newContacts: metrics.newContacts,
      wonCount: metrics.wonCount,
      lostCount: metrics.lostCount,
      wonAmount: new Prisma.Decimal(metrics.wonAmount),
      lostAmount: new Prisma.Decimal(metrics.lostAmount),
      sentiment: insight.sentiment,
      aiSummary: insight.summary,
      rows: metrics.rows as unknown as Prisma.InputJsonValue,
    },
    update: {
      inboundCount: metrics.inboundCount,
      outboundCount: metrics.outboundCount,
      newContacts: metrics.newContacts,
      wonCount: metrics.wonCount,
      lostCount: metrics.lostCount,
      wonAmount: new Prisma.Decimal(metrics.wonAmount),
      lostAmount: new Prisma.Decimal(metrics.lostAmount),
      sentiment: insight.sentiment,
      aiSummary: insight.summary,
      rows: metrics.rows as unknown as Prisma.InputJsonValue,
    },
  });

  // Envío por WhatsApp a los destinatarios configurados (best-effort).
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { dailyReportRecipients: true },
  });
  const recipients = (workspace?.dailyReportRecipients ?? []).map((n) => n.trim()).filter(Boolean);
  const delivered: string[] = [];

  if (recipients.length > 0) {
    const instanceName = await resolveSendingInstance(workspaceId);
    if (instanceName) {
      const baseUrl = getPublicBaseUrl();
      const url = `${baseUrl}/reportes/${report.shareToken}`;
      const text = buildWhatsAppMessage(reportDate, metrics, insight, url);
      for (const phoneNumber of recipients) {
        try {
          await sendEvolutionTextMessageWithReconnect({ instanceName, phoneNumber, text });
          delivered.push(phoneNumber);
        } catch (error) {
          console.error("[DAILY_REPORT] send_failed", phoneNumber, error);
        }
      }
    } else {
      console.warn("[DAILY_REPORT] no_active_evolution_channel", workspaceId);
    }
  }

  if (delivered.length > 0) {
    await prisma.dailyReport.update({
      where: { id: report.id },
      data: { deliveredTo: delivered as unknown as Prisma.InputJsonValue },
    });
  }

  return {
    reportId: report.id,
    shareToken: report.shareToken,
    reportDate,
    sentiment: insight.sentiment,
    delivered,
  };
}

export async function generateDailyReportsForEnabledWorkspaces(
  options: { date?: Date } = {},
): Promise<{ processed: number; reports: GenerateReportResult[]; errors: Array<{ workspaceId: string; error: string }> }> {
  const workspaces = await prisma.workspace.findMany({
    where: { dailyReportEnabled: true, isActive: true },
    select: { id: true },
  });

  const reports: GenerateReportResult[] = [];
  const errors: Array<{ workspaceId: string; error: string }> = [];

  for (const ws of workspaces) {
    try {
      const result = await generateDailyReportForWorkspace(ws.id, { date: options.date });
      reports.push(result);
    } catch (error) {
      errors.push({ workspaceId: ws.id, error: error instanceof Error ? error.message : String(error) });
      console.error("[DAILY_REPORT] workspace_failed", ws.id, error);
    }
  }

  return { processed: workspaces.length, reports, errors };
}
