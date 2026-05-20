"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  Copy,
  Download,
  Mail,
  MoreVertical,
  MessageCircle,
  MessagesSquare,
  Phone,
  Search,
  Trash2,
  Sparkles,
  Users2,
  Clock3,
} from "lucide-react";
import type { ContactosContact, ContactosData } from "../types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteContactAction } from "@/app/actions/chats-actions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ContactAvatar } from "@/components/chats/contact-avatar";

const contactDateFormatter = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDateLabel(value: string | null) {
  if (!value) {
    return "Sin actividad";
  }

  return contactDateFormatter.format(new Date(value)).replace(/\u00A0/g, " ");
}

function formatRelative(value: string) {
  const date = new Date(value);
  const diffHours = Math.max(0, Math.round((Date.now() - date.getTime()) / 3_600_000));

  if (diffHours < 1) return "Hace menos de 1 h";
  if (diffHours < 24) return `Hace ${diffHours} h`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays === 1) return "Hace 1 d";
  if (diffDays < 7) return `Hace ${diffDays} d`;
  return formatDateLabel(value);
}

function formatHeatmapHourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function getHeatmapCellColor(count: number, maxCount: number) {
  if (!count || maxCount <= 0) {
    return "rgb(248 250 252)";
  }

  const ratio = Math.min(1, count / maxCount);
  const mix = 14 + ratio * 76;
  return `color-mix(in srgb, var(--primary) ${mix}%, white)`;
}

function escapeCsvCell(value: string | number | null | undefined) {
  const normalized = value === null || value === undefined ? "" : String(value);
  return `"${normalized.replace(/"/g, '""')}"`;
}

function buildContactsReportCsv(data: ContactosData) {
  const lines: string[] = [];
  const appendRow = (cells: Array<string | number | null | undefined>) => {
    lines.push(cells.map(escapeCsvCell).join(","));
  };

  appendRow(["Reporte", data.workspaceName]);
  appendRow(["Rango", `Ãšltimos ${data.reportRangeDays} dÃ­as`]);
  appendRow(["Generado", new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date())]);
  appendRow(["Total de contactos", data.stats.total]);
  appendRow(["Con chats", data.stats.withConversations]);
  appendRow(["Sin chat", data.stats.withoutConversations]);
  appendRow(["Con email", data.stats.withEmail]);
  lines.push("");

  appendRow(["Resumen por dÃ­a"]);
  appendRow(["DÃ­a", "Fecha", "Total", ...Array.from({ length: 24 }, (_, hour) => formatHeatmapHourLabel(hour))]);
  data.creationHeatmap.days.forEach((day) => {
    appendRow([
      day.dayLabel,
      day.dateLabel,
      day.total,
      ...day.hours.map((hour) => hour.count),
    ]);
  });
  lines.push("");

  appendRow(["Top contactos"]);
  appendRow(["Nombre", "TelÃ©fono", "Chats", "Email", "Ãšltima actividad"]);
  data.contacts
    .slice()
    .sort((left, right) => (right.totalConversations - left.totalConversations) || ((right.lastActivityAt ? new Date(right.lastActivityAt).getTime() : 0) - (left.lastActivityAt ? new Date(left.lastActivityAt).getTime() : 0)))
    .slice(0, 10)
    .forEach((contact) => {
      appendRow([
        contact.name ?? "",
        contact.phoneNumber,
        contact.totalConversations,
        contact.email ?? "",
        contact.lastActivityAt ? formatDateLabel(contact.lastActivityAt) : "Sin actividad",
      ]);
    });

  return `${lines.join("\n")}\n`;
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getContactDisplayName(contact: ContactosContact) {
  return contact.name?.trim() || contact.phoneNumber;
}

function getCurrentProductName(contact: ContactosContact) {
  return contact.recentConversations[0]?.activeProductContext?.productName?.trim() || null;
}

function getConversationHref(contact: ContactosContact) {
  const conversation = contact.recentConversations[0];
  return conversation ? `/cliente/chats?chatKey=agent:${conversation.id}` : "/cliente/chats";
}

function getContactosHref({
  searchQuery,
  agentFilterId,
  selectedContactId,
  range,
  page,
  view,
}: {
  searchQuery: string;
  agentFilterId: string | null;
  selectedContactId: string | null;
  range: number;
  page: number;
  view: "contacto" | "informe";
}) {
  const params = new URLSearchParams();

  if (searchQuery.trim()) {
    params.set("q", searchQuery.trim());
  }

  if (agentFilterId) {
    params.set("agentId", agentFilterId);
  }

  if (selectedContactId) {
    params.set("contactId", selectedContactId);
  }

  params.set("range", String(range));
  params.set("page", String(page));
  params.set("view", view);

  return `/cliente/contactos?${params.toString()}`;
}

function getContactosListHref(data: ContactosData) {
  return getContactosHref({
    searchQuery: data.searchQuery,
    agentFilterId: data.agentFilterId,
    selectedContactId: null,
    range: data.reportRangeDays,
    page: data.pagination.page,
    view: "contacto",
  });
}

function getTagBadgeStyle(color?: string | null) {
  const normalized = color?.trim();
  return {
    backgroundColor: normalized || "var(--primary)",
  };
}

function getMatchSourceLabel(sourceType: "KNOWLEDGE" | "FLOW" | "QUICK_RESPONSE" | "AI") {
  switch (sourceType) {
    case "KNOWLEDGE":
      return "Conocimiento";
    case "FLOW":
      return "Flujo";
    case "QUICK_RESPONSE":
      return "Respuesta rÃ¡pida";
    case "AI":
      return "IA";
  }
}

function ContactMetric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-[var(--line)] bg-white p-4 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.16)]">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className="text-[1.35rem] font-semibold leading-none tracking-[-0.05em] text-slate-950">{value}</p>
        </div>
        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]">
          {icon}
        </div>
      </div>
    </div>
  );
}

function ContactCard({
  contact,
  isSelected,
  href,
}: {
  contact: ContactosContact;
  isSelected: boolean;
  href: string;
}) {
  const name = getContactDisplayName(contact);
  const lastConversation = contact.recentConversations[0] ?? null;
  const activeProductName = lastConversation?.activeProductContext?.productName?.trim() || null;
  const latestMatchName = contact.latestMatch?.targetName?.trim() || null;

  return (
    <Link
      href={href}
      className={cn(
        "group block rounded-[20px] border px-3.5 py-3 transition",
        isSelected
          ? "border-[color:color-mix(in_srgb,var(--primary)_20%,white)] bg-[color:color-mix(in_srgb,var(--primary)_4%,white)] shadow-[0_14px_28px_-24px_rgba(37,99,235,0.24)]"
          : "border-[var(--line)] bg-white shadow-[0_14px_28px_-24px_rgba(15,23,42,0.12)] hover:-translate-y-0.5 hover:shadow-[0_18px_32px_-26px_rgba(15,23,42,0.16)]",
      )}
    >
      <div className="flex items-start gap-2.5">
        <ContactAvatar
          avatarUrl={contact.avatarUrl}
          label={name}
          className="h-9 w-9 shrink-0 rounded-xl border border-[rgba(148,163,184,0.12)] bg-slate-100 text-slate-500"
          fallbackClassName="rounded-xl bg-slate-100 text-xs font-semibold text-slate-700"
        />

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-[14px] font-semibold leading-4 text-slate-950">{name}</h3>
            </div>

            <ArrowRight className="mt-0.5 h-3.5 w-3.5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-[var(--primary)]" />
          </div>

          <div className="flex flex-wrap gap-1">
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600">
              <MessagesSquare className="h-3 w-3" />
              {contact.totalConversations} chats
            </span>
            {contact.email ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
                <Mail className="h-3 w-3" />
                Email
              </span>
            ) : null}
            {lastConversation ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[color:color-mix(in_srgb,var(--primary)_16%,white)] bg-white px-2 py-0.5 text-[10px] text-[var(--primary)]">
                <Clock3 className="h-3 w-3" />
                {formatRelative(lastConversation.lastMessageAt || lastConversation.updatedAt)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
                Sin historial
              </span>
            )}
          </div>

          {activeProductName ? (
            <div className="flex flex-wrap gap-1">
              <span className="inline-flex items-center gap-1 rounded-full border border-[color:color-mix(in_srgb,var(--primary)_16%,white)] bg-[color:color-mix(in_srgb,var(--primary)_6%,white)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--primary)]">
                <span className="h-1 w-1 rounded-full bg-[var(--primary)]" />
                Activo
              </span>
              <span className="inline-flex max-w-full items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-700">
                <span className="truncate">{activeProductName}</span>
              </span>
            </div>
          ) : latestMatchName ? (
            <div className="flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-700">
                <span className="h-1 w-1 rounded-full bg-slate-400" />
                Historial
              </span>
              <span className="inline-flex max-w-full items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-600">
                <span className="truncate">{latestMatchName}</span>
              </span>
            </div>
          ) : null}

          {contact.latestMatch ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className="h-auto border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-700"
              >
                {contact.latestMatch.matchType === "FLOW" ? "Flujo" : "Producto"}
              </Badge>
              <Badge
                variant="outline"
                className="h-auto border-[color:color-mix(in_srgb,var(--primary)_16%,white)] bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--primary)]"
              >
                {contact.latestMatch.targetName}
              </Badge>
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
                {getMatchSourceLabel(contact.latestMatch.sourceType)}
              </span>
            </div>
          ) : null}

        </div>
      </div>
    </Link>
  );
}

export function ContactosWorkspace({ data, activeView }: { data: ContactosData; activeView: "contacto" | "informe" }) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const router = useRouter();
  const selectedContact = data.selectedContact;
  const pagination = data.pagination;

  async function copyToClipboard(value: string, field: string) {
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    window.setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 1200);
  }

  const selectedConversation = selectedContact?.recentConversations[0] ?? null;
  const selectedHref = selectedContact ? getConversationHref(selectedContact) : "";
  const deleteReturnTo = getContactosListHref(data);
  const heatmapDays = data.creationHeatmap.days;
  const heatmapMaxCount = data.creationHeatmap.maxCount;

  function handleDownloadReport() {
    const workspaceSlug = data.workspaceName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "contactos";

    const dateStamp = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(new Date())
      .replaceAll("/", "-");

    const csv = buildContactsReportCsv(data);
    downloadTextFile(`contactos-reporte-${workspaceSlug}-${dateStamp}.csv`, csv, "text/csv;charset=utf-8");
  }

  function handleReportRangeChange(range: string | null) {
    if (range === null) {
      return;
    }

    const nextRange = Number(range);
    if (!Number.isFinite(nextRange)) {
      return;
    }

    router.push(
      getContactosHref({
        searchQuery: data.searchQuery,
        agentFilterId: data.agentFilterId,
        selectedContactId: data.selectedContactId,
        range: nextRange,
        page: pagination.page,
        view: activeView,
      }),
    );
  }

  function handlePageChange(nextPage: number) {
    router.push(
      getContactosHref({
        searchQuery: data.searchQuery,
        agentFilterId: data.agentFilterId,
        selectedContactId: data.selectedContactId,
        range: data.reportRangeDays,
        page: nextPage,
        view: activeView,
      }),
    );
  }

  return (
    <section className="space-y-2">
      <div className="space-y-1">
        <div className="flex items-start gap-3">
          <Users2 className="mt-1 h-5 w-5 shrink-0 text-[var(--primary)]" />
          <h1 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">Contactos</h1>
        </div>
        <p className="max-w-3xl text-sm text-slate-600">
          Organiza los contactos.
        </p>
        {data.agentFilterName ? (
          <p className="text-xs font-medium text-slate-500">Filtrado por {data.agentFilterName}</p>
        ) : null}
        <div className="flex items-center gap-1 rounded-2xl border border-[rgba(148,163,184,0.14)] bg-white p-1 shadow-[0_12px_30px_-26px_rgba(15,23,42,0.14)]">
          {[
            { key: "contacto" as const, label: "Contacto" },
            { key: "informe" as const, label: "Informe" },
          ].map((tab) => {
            const active = activeView === tab.key;

            return (
              <button
                key={tab.key}
                type="button"
                onClick={() =>
                  router.push(
                    getContactosHref({
                      searchQuery: data.searchQuery,
                      agentFilterId: data.agentFilterId,
                      selectedContactId: data.selectedContactId,
                      range: data.reportRangeDays,
                      page: pagination.page,
                      view: tab.key,
                    }),
                  )
                }
                className={`inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-medium transition ${
                  active
                    ? "bg-[var(--primary)] text-white shadow-[0_16px_30px_-20px_color-mix(in_srgb,var(--primary)_55%,black)]"
                    : "text-slate-600 hover:bg-slate-50 hover:text-[var(--primary)]"
                }`}
              >
                {tab.key === "informe" ? <BarChart3 className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeView === "informe" ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <ContactMetric
              label="Total"
              value={String(data.stats.total)}
              icon={<Users2 className="h-5 w-5" />}
            />
            <ContactMetric
              label="Con chats"
              value={String(data.stats.withConversations)}
              icon={<MessagesSquare className="h-5 w-5" />}
            />
            <ContactMetric
              label="Sin chat"
              value={String(data.stats.withoutConversations)}
              icon={<Sparkles className="h-5 w-5" />}
            />
            <ContactMetric
              label="Con email"
              value={String(data.stats.withEmail)}
              icon={<Mail className="h-5 w-5" />}
            />
          </div>

          <div className="rounded-[28px] border border-[var(--line)] bg-white p-4 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.16)] sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">TrÃ¡fico de creaciÃ³n</h2>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    En vivo
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Select
                  value={String(data.reportRangeDays)}
                  onValueChange={(value) => handleReportRangeChange(value)}
                >
                  <SelectTrigger className="h-11 min-w-[180px] rounded-2xl border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-700 shadow-none transition hover:border-[color:color-mix(in_srgb,var(--primary)_18%,white)] hover:text-[var(--primary)] data-[state=open]:border-[var(--primary)] data-[state=open]:bg-white data-[state=open]:shadow-sm">
                    <SelectValue placeholder="Ãšltimos 7 dÃ­as" />
                  </SelectTrigger>
                  <SelectContent
                    align="start"
                    sideOffset={8}
                    alignItemWithTrigger={false}
                    className="min-w-[180px] rounded-2xl border border-slate-200 bg-white p-1 shadow-[0_18px_48px_-24px_rgba(15,23,42,0.24)]"
                  >
                    <SelectItem key={7} value="7">
                      Ãšltimos 7 dÃ­as
                    </SelectItem>
                    <SelectItem key={14} value="14">
                      Ãšltimos 14 dÃ­as
                    </SelectItem>
                    <SelectItem key={30} value="30">
                      Ãšltimos 30 dÃ­as
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-2xl border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-700 shadow-none hover:border-[color:color-mix(in_srgb,var(--primary)_18%,white)] hover:bg-slate-50 hover:text-[var(--primary)]"
                >
                  All inboxes
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDownloadReport}
                  className="h-11 rounded-2xl border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-700 shadow-none transition hover:border-[color:color-mix(in_srgb,var(--primary)_18%,white)] hover:bg-slate-50 hover:text-[var(--primary)]"
                >
                  <Download className="h-4 w-4" />
                  Descargar reporte
                </Button>
              </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-[24px] border border-slate-100">
              <div className="overflow-x-auto">
                <div className="min-w-[980px] p-4">
                  <div className="grid grid-cols-[112px_repeat(24,minmax(0,1fr))_72px] gap-1.5">
                    <div />
                    {Array.from({ length: 24 }, (_, hour) => (
                      <div
                        key={hour}
                        className="pb-2 text-center text-[10px] font-medium tracking-[0.12em] text-slate-400"
                      >
                        {hour % 3 === 0 ? formatHeatmapHourLabel(hour) : ""}
                      </div>
                    ))}
                    <div className="pb-2 text-center text-[10px] font-medium tracking-[0.12em] text-slate-400">Total</div>

                    {heatmapDays.map((day) => (
                      <div key={day.dayKey} className="contents">
                        <div className="flex min-h-10 flex-col justify-center pr-3">
                          <p className="truncate text-sm font-semibold text-slate-900">{day.dayLabel}</p>
                          <p className="text-xs text-slate-500">{day.dateLabel}</p>
                        </div>
                        {day.hours.map((hour) => (
                          <div
                            key={`${day.dayKey}-${hour.hour}`}
                            title={`${day.dateLabel} Â· ${formatHeatmapHourLabel(hour.hour)} Â· ${hour.count} contacto${hour.count === 1 ? "" : "s"}`}
                            className="aspect-square min-h-6 rounded-[6px] border transition-transform duration-150 hover:scale-[1.04]"
                            style={{
                              backgroundColor: getHeatmapCellColor(hour.count, heatmapMaxCount),
                              borderColor: hour.count > 0 ? "transparent" : "rgb(226 232 240)",
                            }}
                          />
                        ))}
                        <div className="flex items-center justify-end pr-1">
                          <span className="inline-flex min-w-12 justify-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                            {day.total}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ContactMetric
            label="Total"
            value={String(data.stats.total)}
            icon={<Users2 className="h-5 w-5" />}
          />
          <ContactMetric
            label="Con chats"
            value={String(data.stats.withConversations)}
            icon={<MessagesSquare className="h-5 w-5" />}
          />
          <ContactMetric
            label="Sin chat"
            value={String(data.stats.withoutConversations)}
            icon={<Sparkles className="h-5 w-5" />}
          />
          <ContactMetric
            label="Con email"
            value={String(data.stats.withEmail)}
            icon={<Mail className="h-5 w-5" />}
          />
        </div>
      )}

      {activeView === "contacto" ? (
        <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="rounded-[28px] border border-[var(--line)] bg-white shadow-[0_24px_54px_-42px_rgba(15,23,42,0.14)]">
          <div className="border-b border-slate-100 p-4 sm:p-5">
            <form method="get" className="space-y-3">
              {data.agentFilterId ? <input type="hidden" name="agentId" value={data.agentFilterId} /> : null}
              <input type="hidden" name="range" value={String(data.reportRangeDays)} />
              <input type="hidden" name="view" value={activeView} />
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <Search className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                  name="q"
                  defaultValue={data.searchQuery}
                  placeholder="Nombre, telefono, email o nota"
                  className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />
              </div>
            </form>
          </div>

          <div className="max-h-[calc(100vh-18rem)] space-y-2 overflow-y-auto p-3 sm:p-4">
            {data.contacts.length > 0 ? (
              data.contacts.map((contact) => (
                <ContactCard
                  key={contact.id}
                  contact={contact}
                  isSelected={contact.id === data.selectedContactId}
                  href={getContactosHref({
                    searchQuery: data.searchQuery,
                    agentFilterId: data.agentFilterId,
                    selectedContactId: contact.id,
                    range: data.reportRangeDays,
                    page: pagination.page,
                    view: activeView,
                  })}
                />
              ))
            ) : (
              <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center">
                <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm">
                    <Users2 className="h-5 w-5" />
                  </span>
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold text-slate-950">No hay contactos para mostrar</h3>
                    <p className="text-sm leading-6 text-slate-600">
                      Prueba quitando el filtro o revisa si ya llegaron conversaciones a tu bandeja.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="text-xs text-slate-500">
              Mostrando {pagination.rangeStart}-{pagination.rangeEnd} de {pagination.total}
            </p>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handlePageChange(Math.max(1, pagination.page - 1))}
                disabled={!pagination.hasPreviousPage}
              >
                Anterior
              </Button>
              <span className="text-xs text-slate-600">
                Pagina {pagination.page} de {pagination.totalPages}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handlePageChange(Math.min(pagination.totalPages, pagination.page + 1))}
                disabled={!pagination.hasNextPage}
              >
                Siguiente
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-[var(--line)] bg-white shadow-[0_24px_54px_-42px_rgba(15,23,42,0.14)]">
          {selectedContact ? (
            <div className="flex h-full flex-col">
              <div className="border-b border-slate-100 p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <ContactAvatar
                      avatarUrl={selectedContact.avatarUrl}
                      label={getContactDisplayName(selectedContact)}
                      className="h-14 w-14 shrink-0 rounded-[22px] border border-[rgba(148,163,184,0.12)] bg-slate-100 text-slate-500"
                      fallbackClassName="rounded-[22px] bg-slate-100 text-base font-semibold text-slate-700"
                    />

                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[1.15rem] font-semibold tracking-[-0.04em] text-slate-950">
                          {getContactDisplayName(selectedContact)}
                        </h2>
                        {selectedConversation?.automationPaused ? (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-medium text-amber-700">
                            IA pausada
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm text-slate-500">{selectedContact.phoneNumber}</p>
                      {selectedContact.email ? <p className="text-sm text-slate-500">{selectedContact.email}</p> : null}
                      {selectedContact.tags.length ? (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {selectedContact.tags.map((tag) => (
                            <span
                              key={`${selectedContact.id}:${tag.label}`}
                              className="inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white shadow-[0_8px_16px_-12px_rgba(15,23,42,0.45)]"
                              style={getTagBadgeStyle(tag.color)}
                              title={tag.label}
                            >
                              <span className="truncate">{tag.label}</span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void copyToClipboard(selectedContact.phoneNumber, "phone")}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                    >
                      <Copy className="h-4 w-4" />
                      {copiedField === "phone" ? "Copiado" : "Copiar"}
                    </button>
                    <Link
                      href={selectedHref}
                      className="inline-flex items-center gap-2 rounded-2xl bg-[var(--primary)] px-3.5 py-2 text-sm font-medium text-white transition hover:bg-[var(--primary-strong)]"
                    >
                      Abrir chat
                      <MessageCircle className="h-4 w-4" />
                    </Link>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                          aria-label="Acciones del contacto"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44 rounded-2xl">
                        <DropdownMenuItem asChild className="gap-2">
                          <a href={`/api/contactos/${selectedContact.id}/export-ejecucion?mode=simple`}>
                            <Download className="h-4 w-4" />
                            Exportar ejecución simple
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild className="gap-2">
                          <a href={`/api/contactos/${selectedContact.id}/export-ejecucion?mode=full`}>
                            <Download className="h-4 w-4" />
                            Exportar ejecución avanzada
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => setDeleteModalOpen(true)}
                          className="gap-2 text-rose-600 focus:text-rose-700"
                        >
                          <Trash2 className="h-4 w-4" />
                          Eliminar contacto
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
                <div className="rounded-[24px] border border-slate-100 bg-slate-50 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Resumen</p>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <p>
                      <span className="font-medium text-slate-900">{selectedContact.totalConversations}</span> conversaciones
                    </p>
                    <p>
                      <span className="font-medium text-slate-900">{selectedContact.totalMessages}</span> mensajes relacionados
                    </p>
                    <p>Creado: {formatDateLabel(selectedContact.createdAt)}</p>
                    <p>Ultima actividad: {formatDateLabel(selectedContact.lastActivityAt)}</p>
                  </div>

                  {getCurrentProductName(selectedContact) ? (
                    <div className="mt-4 rounded-[20px] border border-[color:color-mix(in_srgb,var(--primary)_14%,white)] bg-white p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Producto activo</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className="h-auto border-[color:color-mix(in_srgb,var(--primary)_16%,white)] bg-[color:color-mix(in_srgb,var(--primary)_6%,white)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--primary)]"
                        >
                          {getCurrentProductName(selectedContact)}
                        </Badge>
                        <span className="text-xs text-slate-500">
                          Lo que está activo ahora en la conversación
                        </span>
                      </div>
                    </div>
                  ) : null}

                {selectedContact.latestMatch ? (
                  <div className="mt-4 rounded-[20px] border border-slate-200 bg-white p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Ultimo match</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge
                          variant="outline"
                          className="h-auto border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-700"
                        >
                          {selectedContact.latestMatch.targetName}
                        </Badge>
                        <span className="text-xs text-slate-500">
                          {getMatchSourceLabel(selectedContact.latestMatch.sourceType)} Â·{" "}
                          {formatDateLabel(selectedContact.latestMatch.detectedAt)}
                        </span>
                      </div>
                    </div>
                  ) : null}

                  {selectedContact.matchHistory.length > 0 ? (
                    <div className="mt-3 rounded-[20px] border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Historial de matches</p>
                        <span className="text-[11px] text-slate-500">{selectedContact.matchHistory.length}</span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {selectedContact.matchHistory.map((match) => (
                          <div key={match.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-950">{match.targetName}</p>
                              <p className="text-[11px] text-slate-500">
                                {getMatchSourceLabel(match.sourceType)} Â· {formatDateLabel(match.detectedAt)}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className="h-auto border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-700"
                            >
                              {match.matchType === "FLOW" ? "Flujo" : "Producto"}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-[24px] border border-slate-100 bg-slate-50 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Acciones rapidas</p>
                  <div className="mt-3 space-y-2">
                    <button
                      type="button"
                      onClick={() => void copyToClipboard(selectedContact.phoneNumber, "phone")}
                      className="flex w-full items-center justify-between rounded-2xl border border-white bg-white px-3 py-2.5 text-sm text-slate-600 shadow-sm transition hover:border-[color:color-mix(in_srgb,var(--primary)_16%,white)]"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Phone className="h-4 w-4 text-slate-400" />
                        {selectedContact.phoneNumber}
                      </span>
                      <Copy className="h-4 w-4 text-slate-400" />
                    </button>

                    {selectedContact.email ? (
                      <button
                        type="button"
                        onClick={() => void copyToClipboard(selectedContact.email || "", "email")}
                        className="flex w-full items-center justify-between rounded-2xl border border-white bg-white px-3 py-2.5 text-sm text-slate-600 shadow-sm transition hover:border-[color:color-mix(in_srgb,var(--primary)_16%,white)]"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Mail className="h-4 w-4 text-slate-400" />
                          {selectedContact.email}
                        </span>
                        <Copy className="h-4 w-4 text-slate-400" />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 border-t border-slate-100 p-4 sm:p-5">
                <div className="rounded-[24px] border border-slate-100 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-950">Conversaciones recientes</h3>
                    <span className="text-[11px] text-slate-500">{selectedContact.recentConversations.length} hilos</span>
                  </div>

                  <div className="mt-3 space-y-3">
                    {selectedContact.recentConversations.length > 0 ? (
                      selectedContact.recentConversations.map((conversation) => (
                        <div
                          key={conversation.id}
                          className="rounded-[20px] border border-slate-100 bg-slate-50 p-4"
                        >
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 space-y-1">
                              <p className="text-sm font-medium text-slate-950">
                                {conversation.agent?.name ?? "Chat sin agente asignado"}
                              </p>
                              <p className="text-xs text-slate-500">
                                {conversation.channel?.name ?? "Canal"} Â· {conversation.status}
                              </p>
                            </div>
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-500">
                              {formatDateLabel(conversation.lastMessageAt || conversation.updatedAt)}
                            </span>
                          </div>

                          {conversation.lastMessage?.content ? (
                            <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">
                              {conversation.lastMessage.content}
                            </p>
                          ) : (
                            <p className="mt-3 text-sm text-slate-500">Sin mensaje visible en este hilo.</p>
                          )}

                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <Link
                              href={`/cliente/chats?chatKey=agent:${conversation.id}`}
                              className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[11px] font-medium text-[var(--primary)] ring-1 ring-[color:color-mix(in_srgb,var(--primary)_14%,white)] transition hover:bg-[color:color-mix(in_srgb,var(--primary)_5%,white)]"
                            >
                              Abrir conversacion
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                            {conversation.automationPaused ? (
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-700">
                                IA pausada
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[20px] border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                        <p className="text-sm font-medium text-slate-950">Todavia no hay conversaciones</p>
                        <p className="mt-1 text-sm leading-6 text-slate-500">
                          Este contacto todavia no ha entrado al flujo de chats.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {selectedContact.notes ? (
                  <div className="rounded-[24px] border border-slate-100 bg-[linear-gradient(180deg,#ffffff_0%,#fbfcfe_100%)] p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Notas</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                      {selectedContact.notes}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex min-h-[36rem] items-center justify-center p-6 text-center">
              <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">
                  <Users2 className="h-5 w-5" />
                </span>
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-slate-950">Selecciona un contacto</h3>
                  <p className="text-sm leading-6 text-slate-600">
                    Aqui veras su informacion, las conversaciones recientes y el acceso directo al chat.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
        </div>
          ) : null}

      {selectedContact && deleteModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-label="Eliminar contacto"
          onClick={() => setDeleteModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-[28px] border border-rose-200 bg-white shadow-[0_28px_90px_-40px_rgba(15,23,42,0.5)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-slate-100 px-5 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-600">Accion irreversible</p>
              <h3 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-slate-950">Eliminar contacto</h3>
            </div>
            <form action={deleteContactAction} className="space-y-4 px-5 py-5">
              <input type="hidden" name="contactId" value={selectedContact.id} />
              <input type="hidden" name="returnTo" value={deleteReturnTo} />
              <p className="text-sm leading-6 text-slate-600">
                Se eliminarÃ¡ <span className="font-medium text-slate-900">{getContactDisplayName(selectedContact)}</span>
                y todo su historial: conversaciones, mensajes, etiquetas y registros asociados a este contacto dentro del
                workspace.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteModalOpen(false)}
                  className="h-10 rounded-2xl border border-slate-200 px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="h-10 rounded-2xl bg-rose-600 px-4 text-sm font-semibold text-white transition hover:bg-rose-700"
                >
                  Eliminar contacto
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
