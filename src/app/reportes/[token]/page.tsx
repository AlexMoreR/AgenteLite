import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FiInbox, FiSend, FiUserPlus, FiThumbsUp, FiThumbsDown } from "react-icons/fi";

import { stageLabel, type DailyReportRow } from "@/features/reportes/services/daily-report";
import { getTagBadgeColors } from "@/lib/tag-badge";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reporte del día",
  robots: { index: false, follow: false },
};

type PageProps = {
  params: Promise<{ token: string }>;
};

const SENTIMENT: Record<string, { face: string; label: string; tone: string }> = {
  SAD: { face: "😞", label: "Día flojo", tone: "text-rose-600" },
  NEUTRAL: { face: "😐", label: "Día normal", tone: "text-amber-600" },
  HAPPY: { face: "😀", label: "¡Buen día!", tone: "text-emerald-600" },
};

const STAGE_TONE: Record<string, string> = {
  GANADO: "bg-emerald-100 text-emerald-700",
  PERDIDO: "bg-rose-100 text-rose-700",
  NUEVO: "bg-sky-100 text-sky-700",
};

function parseRows(value: unknown): DailyReportRow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value as DailyReportRow[];
}

export default async function DailyReportPublicPage({ params }: PageProps) {
  const { token } = await params;

  const report = await prisma.dailyReport.findUnique({ where: { shareToken: token } });
  if (!report) {
    notFound();
  }

  const sentiment = SENTIMENT[report.sentiment] ?? SENTIMENT.NEUTRAL;
  const rows = parseRows(report.rows);
  const dateLabel = report.reportDate.toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const metrics = [
    { label: "Mensajes recibidos", value: report.inboundCount, icon: FiInbox, tone: "text-sky-600" },
    { label: "Mensajes enviados", value: report.outboundCount, icon: FiSend, tone: "text-indigo-600" },
    { label: "Personas nuevas", value: report.newContacts, icon: FiUserPlus, tone: "text-violet-600" },
    { label: "Negocios ganados", value: report.wonCount, icon: FiThumbsUp, tone: "text-emerald-600" },
    { label: "Negocios perdidos", value: report.lostCount, icon: FiThumbsDown, tone: "text-rose-600" },
  ];

  return (
    <main className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <header className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Reporte del día</p>
          <h1 className="mt-1 text-xl font-semibold capitalize text-slate-900">{dateLabel}</h1>
          <div className="mt-4 flex flex-col items-center gap-2">
            <span className="text-6xl" role="img" aria-label={sentiment.label}>
              {sentiment.face}
            </span>
            <span className={`text-lg font-semibold ${sentiment.tone}`}>{sentiment.label}</span>
          </div>
          {report.aiSummary ? (
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-slate-600">{report.aiSummary}</p>
          ) : null}
        </header>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {metrics.map((m) => {
            const Icon = m.icon;
            return (
              <div key={m.label} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <Icon className={`size-4 ${m.tone}`} />
                  <p className="text-xl font-semibold text-slate-900">{m.value}</p>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{m.label}</p>
              </div>
            );
          })}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Detalle de contactos</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-500">No hubo contactos con actividad registrada hoy.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3 font-medium">Número</th>
                    <th className="py-2 pr-3 font-medium">Etiquetas</th>
                    <th className="py-2 pr-3 font-medium">Resumen</th>
                    <th className="py-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${row.phone}-${index}`} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap text-slate-800">
                        <div className="font-medium">{row.name}</div>
                        <div className="text-xs text-slate-500">{row.phone}</div>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {row.tags.length === 0 ? (
                            <span className="text-xs text-slate-400">—</span>
                          ) : (
                            row.tags.map((tag) => (
                              <span
                                key={tag.name}
                                className="rounded-[4px] px-1 py-0.5 text-[10px] font-normal uppercase tracking-wide"
                                style={getTagBadgeColors(tag.color)}
                              >
                                {tag.name}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-600">{row.summary || "—"}</td>
                      <td className="py-2">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            STAGE_TONE[row.stage] ?? "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {stageLabel(row.stage)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="pb-6 text-center text-xs text-slate-400">
          Generado automáticamente · {report.createdAt.toLocaleString("es-CO", { timeZone: "America/Bogota" })}
        </footer>
      </div>
    </main>
  );
}
