"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  Copy,
  Download,
  Eye,
  EyeOff,
  Mail,
  MoreVertical,
  MessageCircle,
  MessagesSquare,
  Search,
  Trash2,
  RotateCcw,
  Sparkles,
  Users2,
  Clock3,
} from "lucide-react";
import type { ContactosContact, ContactosData } from "../types";
import { cn } from "@/lib/utils";
import { TAG_BADGE_CLASS } from "@/lib/tag-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteContactAction, resetContactAction, toggleContactCrmHiddenAction } from "@/app/actions/chats-actions";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ContactAvatar } from "@/components/chats/contact-avatar";
import { Separator } from "@/components/ui/separator";

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
  appendRow(["Rango", `Últimos ${data.reportRangeDays} días`]);
  appendRow(["Generado", new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date())]);
  appendRow(["Total de contactos", data.stats.total]);
  appendRow(["Con chats", data.stats.withConversations]);
  appendRow(["Sin chat", data.stats.withoutConversations]);
  appendRow(["Con email", data.stats.withEmail]);
  lines.push("");

  appendRow(["Resumen por día"]);
  appendRow(["Día", "Fecha", "Total", ...Array.from({ length: 24 }, (_, hour) => formatHeatmapHourLabel(hour))]);
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
  appendRow(["Nombre", "Teléfono", "Chats", "Email", "Última actividad"]);
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
      return "Respuesta rápida";
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
    <Card className="rounded-none border border-border/70 shadow-none">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardDescription className="text-[10px] font-semibold uppercase tracking-[0.18em]">{label}</CardDescription>
          <CardTitle className="text-[1.35rem] leading-none tracking-[-0.05em]">{value}</CardTitle>
        </div>
        <CardAction className="inline-flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </CardAction>
      </CardHeader>
    </Card>
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

  return (
    <Link href={href} className="group block">
      <Card
        className={cn(
          "rounded-none border border-border/70 py-3 shadow-none transition",
          isSelected ? "border-primary/30 bg-primary/5" : "hover:border-primary/20 hover:bg-accent/30",
        )}
      >
        <CardContent className="flex items-start gap-2.5">
        <ContactAvatar
          avatarUrl={contact.avatarUrl}
          label={name}
          className="h-11 w-11 shrink-0 rounded-xl border-0 bg-transparent text-muted-foreground after:border-0"
          fallbackClassName="rounded-xl bg-transparent text-muted-foreground"
        />

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-[14px] font-semibold leading-4 text-foreground">{name}</h3>
            </div>

            <ArrowRight className="mt-0.5 h-3.5 w-3.5 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
          </div>

          <div className="flex flex-wrap gap-1">
            <Badge variant="outline" className="h-auto gap-1 rounded-full px-2 py-0.5 text-[10px] font-normal text-muted-foreground">
              <MessagesSquare className="h-3 w-3" />
              {contact.totalConversations} chats
            </Badge>
            {contact.email ? (
              <Badge variant="secondary" className="h-auto gap-1 rounded-full px-2 py-0.5 text-[10px] font-normal">
                <Mail className="h-3 w-3" />
                Email
              </Badge>
            ) : null}
            {lastConversation ? (
              <Badge variant="outline" className="h-auto gap-1 rounded-full border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-normal text-primary">
                <Clock3 className="h-3 w-3" />
                {formatRelative(lastConversation.lastMessageAt || lastConversation.updatedAt)}
              </Badge>
            ) : (
              <Badge variant="outline" className="h-auto rounded-full px-2 py-0.5 text-[10px] font-normal text-muted-foreground">
                Sin historial
              </Badge>
            )}
          </div>

        </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// Botón de submit del borrado: se deshabilita mientras la acción corre para evitar
// clicks repetidos (que disparaban varias eliminaciones).
function DeleteContactSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="inline-flex h-10 items-center gap-2 rounded-2xl bg-rose-600 px-4 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Eliminando..." : "Eliminar contacto"}
    </button>
  );
}

export function ContactosWorkspace({ data, activeView }: { data: ContactosData; activeView: "contacto" | "informe" }) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [crmHiddenPending, startCrmHiddenTransition] = useTransition();
  const router = useRouter();
  const selectedContact = data.selectedContact;
  const pagination = data.pagination;

  async function copyToClipboard(value: string, field: string) {
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    window.setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 1200);
  }

  function handleToggleCrmHidden(contactId: string, nextHidden: boolean) {
    startCrmHiddenTransition(async () => {
      const result = await toggleContactCrmHiddenAction(contactId, nextHidden);
      if ("error" in result) {
        console.error("[ContactosWorkspace] toggle_crm_hidden_failed", result.error);
        return;
      }
      router.refresh();
    });
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
        <div className="flex items-start justify-between gap-2">
          <PageHeader icon={Users2} title="Contactos" className="min-w-0 max-md:pl-10" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="relative z-20 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground transition hover:bg-accent hover:text-foreground"
                aria-label="Más opciones de contactos"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44 rounded-2xl">
              <DropdownMenuItem
                onClick={() =>
                  router.push(
                    getContactosHref({
                      searchQuery: data.searchQuery,
                      agentFilterId: data.agentFilterId,
                      selectedContactId: data.selectedContactId,
                      range: data.reportRangeDays,
                      page: pagination.page,
                      view: "informe",
                    }),
                  )
                }
                className="gap-2"
              >
                <BarChart3 className="h-4 w-4" />
                Informe
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {data.agentFilterName ? (
          <p className="text-xs font-medium text-muted-foreground">Filtrado por {data.agentFilterName}</p>
        ) : null}

      </div>

      {activeView === "informe" ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
          </div>

          <div className="rounded-[28px] border border-[var(--line)] bg-white p-4 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.16)] sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Tráfico de creación</h2>
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
                    <SelectValue placeholder="Últimos 7 días" />
                  </SelectTrigger>
                  <SelectContent
                    align="start"
                    sideOffset={8}
                    alignItemWithTrigger={false}
                    className="min-w-[180px] rounded-2xl border border-slate-200 bg-white p-1 shadow-[0_18px_48px_-24px_rgba(15,23,42,0.24)]"
                  >
                    <SelectItem key={7} value="7">
                      Últimos 7 días
                    </SelectItem>
                    <SelectItem key={14} value="14">
                      Últimos 14 días
                    </SelectItem>
                    <SelectItem key={30} value="30">
                      Últimos 30 días
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
                            title={`${day.dateLabel} · ${formatHeatmapHourLabel(hour.hour)} · ${hour.count} contacto${hour.count === 1 ? "" : "s"}`}
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
      ) : null}

      {activeView === "contacto" ? (
        <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="rounded-none flex h-full flex-col border border-border/70 shadow-none">
          <CardHeader className="border-b p-4 sm:p-5">
            <form method="get" className="space-y-3">
              {data.agentFilterId ? <input type="hidden" name="agentId" value={data.agentFilterId} /> : null}
              <input type="hidden" name="range" value={String(data.reportRangeDays)} />
              <input type="hidden" name="view" value={activeView} />
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  name="q"
                  defaultValue={data.searchQuery}
                  placeholder="Nombre, telefono, email o nota"
                  className="h-11 rounded-xl bg-background pl-9"
                />
              </div>
            </form>
          </CardHeader>

          <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 sm:p-4">
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
              <Card className="rounded-none border border-dashed border-border/70 bg-muted/30 py-10 shadow-none">
                <CardContent className="text-center">
                <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-background text-muted-foreground">
                    <Users2 className="h-5 w-5" />
                  </span>
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold text-foreground">No hay contactos para mostrar</h3>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Prueba quitando el filtro o revisa si ya llegaron conversaciones a tu bandeja.
                    </p>
                  </div>
                </div>
                </CardContent>
              </Card>
            )}
          </CardContent>

          <div className="mt-auto flex flex-col gap-2 border-t px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="text-xs text-muted-foreground">
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
              <span className="text-xs text-muted-foreground">
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
        </Card>

        <Card className="rounded-none border border-border/70 shadow-none">
          {selectedContact ? (
            <div className="flex h-full flex-col">
              <div className="border-b p-3.5 sm:p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <ContactAvatar
                      avatarUrl={selectedContact.avatarUrl}
                      label={getContactDisplayName(selectedContact)}
                      className="h-12 w-12 shrink-0 rounded-[20px] border border-border bg-muted text-muted-foreground"
                      fallbackClassName="rounded-[20px] bg-muted text-muted-foreground"
                    />

                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[1.05rem] font-semibold tracking-[-0.02em] text-foreground">
                          {getContactDisplayName(selectedContact)}
                        </h2>
                        {selectedConversation?.automationPaused ? (
                          <Badge variant="outline" className="rounded-full px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                            IA pausada
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-sm leading-5 tracking-[-0.015em] text-muted-foreground">{selectedContact.phoneNumber}</p>
                      {selectedContact.email ? <p className="text-sm leading-5 tracking-[-0.015em] text-muted-foreground">{selectedContact.email}</p> : null}
                      {selectedContact.tags.length ? (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {selectedContact.tags.map((tag) => (
                            <Badge
                              key={`${selectedContact.id}:${tag.label}`}
                              className={`max-w-full border-transparent text-white shadow-none ${TAG_BADGE_CLASS}`}
                              style={getTagBadgeStyle(tag.color)}
                              title={tag.label}
                            >
                              <span className="truncate">{tag.label}</span>
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-lg"
                      onClick={() => void copyToClipboard(selectedContact.phoneNumber, "phone")}
                      aria-label={copiedField === "phone" ? "Telefono copiado" : "Copiar telefono"}
                      title={copiedField === "phone" ? "Copiado" : "Copiar"}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button asChild size="icon-lg">
                      <Link href={selectedHref} aria-label="Abrir chat" title="Abrir chat">
                      <MessageCircle className="h-4 w-4" />
                      </Link>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" size="icon-lg" aria-label="Acciones del contacto">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
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
                          onClick={() => handleToggleCrmHidden(selectedContact.id, !selectedContact.excludedFromCrm)}
                          disabled={crmHiddenPending}
                          className="gap-2"
                        >
                          {selectedContact.excludedFromCrm ? (
                            <>
                              <Eye className="h-4 w-4" />
                              Mostrar en CRM
                            </>
                          ) : (
                            <>
                              <EyeOff className="h-4 w-4" />
                              Ocultar del CRM
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setResetModalOpen(true)}
                          className="gap-2 text-amber-600 focus:text-amber-700"
                        >
                          <RotateCcw className="h-4 w-4" />
                          Empezar de 0
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setDeleteModalOpen(true)}
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

              <div className="grid gap-4 p-4 sm:p-5">
                <Card className="rounded-none border border-border/70 bg-muted/30 shadow-none">
                  <CardHeader>
                    <CardDescription className="text-[10px] font-semibold uppercase tracking-[0.18em]">Resumen</CardDescription>
                  </CardHeader>
                  <CardContent className="mt-1 flex flex-col gap-2 text-sm text-muted-foreground">
                    <p>
                      <span className="font-medium text-foreground">{selectedContact.totalConversations}</span> conversaciones
                    </p>
                    <p>
                      <span className="font-medium text-foreground">{selectedContact.totalMessages}</span> mensajes relacionados
                    </p>
                    <p>Creado: {formatDateLabel(selectedContact.createdAt)}</p>
                    <p>Ultima actividad: {formatDateLabel(selectedContact.lastActivityAt)}</p>
                  </CardContent>
                  <CardFooter className="flex flex-col gap-3 border-none bg-transparent p-4 pt-0">
                    {getCurrentProductName(selectedContact) ? (
                      <Card size="sm" className="rounded-none w-full shadow-none">
                        <CardHeader>
                          <CardDescription className="text-[10px] font-semibold uppercase tracking-[0.18em]">
                            Producto activo
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="text-[10px] font-semibold uppercase tracking-[0.08em]">
                            {getCurrentProductName(selectedContact)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            Lo que está activo ahora en la conversación
                          </span>
                        </CardContent>
                      </Card>
                    ) : null}

                    {selectedContact.latestMatch ? (
                      <Card size="sm" className="rounded-none w-full shadow-none">
                        <CardHeader>
                          <CardDescription className="text-[10px] font-semibold uppercase tracking-[0.18em]">
                            Ultimo match
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="text-[10px] font-semibold uppercase tracking-[0.08em]">
                            {selectedContact.latestMatch.targetName}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {getMatchSourceLabel(selectedContact.latestMatch.sourceType)} ·{" "}
                            {formatDateLabel(selectedContact.latestMatch.detectedAt)}
                          </span>
                        </CardContent>
                      </Card>
                    ) : null}

                    {selectedContact.matchHistory.length > 0 ? (
                      <Card size="sm" className="rounded-none w-full shadow-none">
                        <CardHeader>
                          <div className="flex items-center justify-between gap-2">
                            <CardDescription className="text-[10px] font-semibold uppercase tracking-[0.18em]">
                              Historial de matches
                            </CardDescription>
                            <Badge variant="outline">{selectedContact.matchHistory.length}</Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-2">
                          {selectedContact.matchHistory.map((match) => (
                            <Card key={match.id} size="sm" className="rounded-none bg-muted/40 shadow-none">
                              <CardContent className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-foreground">{match.targetName}</p>
                                  <p className="text-[11px] text-muted-foreground">
                                    {getMatchSourceLabel(match.sourceType)} · {formatDateLabel(match.detectedAt)}
                                  </p>
                                </div>
                                <Badge variant="outline">
                                  {match.matchType === "FLOW" ? "Flujo" : "Producto"}
                                </Badge>
                              </CardContent>
                            </Card>
                          ))}
                        </CardContent>
                      </Card>
                    ) : null}
                  </CardFooter>
                </Card>
              </div>

              <div className="grid gap-4 p-4 sm:p-5">
                <Separator />
                <Card className="rounded-none border border-border/70 shadow-none">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="text-sm">Conversaciones recientes</CardTitle>
                      <Badge variant="outline">{selectedContact.recentConversations.length} hilos</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {selectedContact.recentConversations.length > 0 ? (
                      selectedContact.recentConversations.map((conversation) => (
                        <Card
                          key={conversation.id}
                          size="sm"
                          className="rounded-none border border-border/70 bg-muted/30 shadow-none"
                        >
                          <CardContent className="flex flex-col gap-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0 space-y-1">
                              <p className="text-sm font-medium text-foreground">
                                {conversation.agent?.name ?? "Chat sin agente asignado"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {conversation.channel?.name ?? "Canal"} · {conversation.status}
                              </p>
                              </div>
                              <Badge variant="outline">
                                {formatDateLabel(conversation.lastMessageAt || conversation.updatedAt)}
                              </Badge>
                            </div>

                            {conversation.lastMessage?.content ? (
                              <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
                                {conversation.lastMessage.content}
                              </p>
                            ) : (
                              <p className="text-sm text-muted-foreground">Sin mensaje visible en este hilo.</p>
                            )}

                            <div className="flex flex-wrap items-center gap-2">
                              <Button asChild variant="outline" size="sm">
                                <Link href={`/cliente/chats?chatKey=agent:${conversation.id}`}>
                                  Abrir conversacion
                                  <ArrowRight className="h-3.5 w-3.5" />
                                </Link>
                              </Button>
                              {conversation.automationPaused ? (
                                <Badge variant="outline">IA pausada</Badge>
                              ) : null}
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    ) : (
                      <Card className="rounded-none border border-dashed border-border/70 bg-muted/30 py-8 text-center shadow-none">
                        <CardContent>
                        <p className="text-sm font-medium text-foreground">Todavia no hay conversaciones</p>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          Este contacto todavia no ha entrado al flujo de chats.
                        </p>
                        </CardContent>
                      </Card>
                    )}
                  </CardContent>
                </Card>

                {selectedContact.notes ? (
                  <Card className="rounded-none border border-border/70 shadow-none">
                    <CardHeader>
                      <CardDescription className="text-[10px] font-semibold uppercase tracking-[0.18em]">Notas</CardDescription>
                    </CardHeader>
                    <CardContent>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      {selectedContact.notes}
                    </p>
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex min-h-[36rem] items-center justify-center p-6 text-center">
              <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <Users2 className="h-5 w-5" />
                </span>
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-foreground">Selecciona un contacto</h3>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Aqui veras su informacion, las conversaciones recientes y el acceso directo al chat.
                  </p>
                </div>
              </div>
            </div>
          )}
        </Card>
        </div>
          ) : null}

      {selectedContact && resetModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-label="Empezar de 0"
          onClick={() => setResetModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-[28px] border border-amber-200 bg-white shadow-[0_28px_90px_-40px_rgba(15,23,42,0.5)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-slate-100 px-5 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-600">Reiniciar conversación</p>
              <h3 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-slate-950">Empezar de 0</h3>
            </div>
            <form action={resetContactAction} className="space-y-4 px-5 py-5">
              <input type="hidden" name="contactId" value={selectedContact.id} />
              <input type="hidden" name="returnTo" value={deleteReturnTo} />
              <p className="text-sm leading-6 text-slate-600">
                Se borrarán las conversaciones, mensajes, seguimientos y el estado del agente de{" "}
                <span className="font-medium text-slate-900">{getContactDisplayName(selectedContact)}</span>. El contacto se
                conserva (nombre, etiquetas, etapa y notas) y, al volver a escribir, el agente lo saludará con la bienvenida
                como si fuera la primera vez.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setResetModalOpen(false)}
                  className="h-10 rounded-2xl border border-slate-200 px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="h-10 rounded-2xl bg-amber-500 px-4 text-sm font-semibold text-white transition hover:bg-amber-600"
                >
                  Empezar de 0
                </button>
              </div>
            </form>
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
                Se eliminará <span className="font-medium text-slate-900">{getContactDisplayName(selectedContact)}</span>
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
                <DeleteContactSubmitButton />
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
