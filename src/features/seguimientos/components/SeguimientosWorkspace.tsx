"use client";

import {
  IconCircleCheckFilled,
} from "@tabler/icons-react"

import { useActionState, useEffect, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  CircleSlash2,
  Clock3,
  Phone,
  MoreHorizontal,
  Trash2,
  TrendingUp,
  Users2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deleteFollowRuleAction,
  type DeleteFollowRuleActionState,
} from "@/app/actions/follow-actions";
import { NewFollowDialog } from "./NewFollowDialog";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle, ItemMedia } from "@/components/ui/item";

type SelectOption = {
  value: string;
  label: string;
  color?: string;
  phoneNumber?: string;
};

type FollowRuleRow = {
  id: string;
  name: string;
  sourceType: string;
  sourceId: string | null;
  timeType: string;
  timeValue: number;
  messageType: string;
  content: string | null;
  mediaUrl: string | null;
  cancelOnActivity: boolean;
  isActive: boolean;
  createdAt: Date;
  channel?: {
    id: string;
    name: string;
    status: string;
    provider: string;
    evolutionInstanceName: string | null;
  } | null;
  _count?: {
    follows: number;
  };
};

type FollowRow = {
  id: string;
  contactId: string;
  name: string | null;
  timeType: string;
  timeValue: number;
  executeAt: Date;
  messageType: string;
  content: string | null;
  mediaUrl: string | null;
  status: string;
  provider: string;
  cancelOnActivity: boolean;
  executionError: string | null;
  executedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  followRule?: {
    id: string;
    name: string;
    sourceType: string;
    sourceId: string | null;
  } | null;
  channel?: {
    id: string;
    name: string;
    status: string;
    provider: string;
    evolutionInstanceName: string | null;
  } | null;
};

type SeguimientosWorkspaceProps = {
  workspaceName: string;
  counts: {
    total: number;
    pending: number;
    executed: number;
    cancelled: number;
  };
  rules: FollowRuleRow[];
  follows: FollowRow[];
  channels: SelectOption[];
  contacts: SelectOption[];
  sourceOptions: Array<{
    label: string;
    options: SelectOption[];
  }>;
  crmStages: SelectOption[];
};

type PendingDeleteRule = {
  id: string;
  name: string;
} | null;

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "N/A";
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function sourceLabel(sourceType: string, sourceId: string | null) {
  if (sourceType === "MANUAL") return "Manual";
  if (sourceType === "CRM_STAGE") return sourceId || "Etapa CRM";
  return sourceId || "Sin origen";
}

function normalizePhoneHref(phoneNumber: string) {
  const digits = phoneNumber.replace(/\D/g, "");
  return digits ? `tel:+${digits}` : "";
}

export function SeguimientosWorkspace({
  workspaceName,
  counts,
  rules,
  follows,
  channels,
  contacts,
  sourceOptions,
  crmStages,
}: SeguimientosWorkspaceProps) {
  const [pendingDeleteRule, setPendingDeleteRule] =
    useState<PendingDeleteRule>(null);
  const [deleteActionState, deleteFormAction, deletePending] = useActionState(
    deleteFollowRuleAction,
    { error: "" } as DeleteFollowRuleActionState,
  );
  const contactPhoneById = new Map(
    contacts
      .filter((contact) => contact.phoneNumber?.trim())
      .map((contact) => [contact.value, contact.phoneNumber?.trim() ?? ""] as const),
  );

  useEffect(() => {
    if ("success" in deleteActionState && deleteActionState.success) {
      toast.success(`Regla "${deleteActionState.name}" eliminada`);
      window.setTimeout(() => {
        setPendingDeleteRule(null);
      }, 0);
      return;
    }

    if ("error" in deleteActionState && deleteActionState.error) {
      toast.error(deleteActionState.error);
    }
  }, [deleteActionState]);

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-7 w-7 text-[#3b63ff]" />
          <h1 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">
            Seguimientos
          </h1>
        </div>
        <NewFollowDialog
          workspaceName={workspaceName}
          channels={channels}
          contacts={contacts}
          sourceOptions={sourceOptions}
          crmStages={crmStages}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-[22px] border border-[#c7d8ff] bg-[#f6f9ff] px-4 py-3.5 shadow-[0_10px_26px_-20px_rgba(37,99,235,0.28)]">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d8e3ff] bg-[#edf3ff] text-[#3b63ff]">
              <Users2 className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.95rem] font-medium text-[#5b74a8]">
                Total
              </p>
            </div>
            <p className="shrink-0 text-[1.45rem] font-semibold leading-none tracking-[-0.06em] text-[#0f172a]">
              {String(counts.total)}
            </p>
          </div>
        </Card>
        <Card className="rounded-[22px] border border-[#c7d8ff] bg-[#f6f9ff] px-4 py-3.5 shadow-[0_10px_26px_-20px_rgba(37,99,235,0.28)]">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d8e3ff] bg-[#edf3ff] text-[#3b63ff]">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.95rem] font-medium text-[#5b74a8]">
                En proceso
              </p>
            </div>
            <p className="shrink-0 text-[1.45rem] font-semibold leading-none tracking-[-0.06em] text-[#0f172a]">
              {String(counts.pending)}
            </p>
          </div>
        </Card>
        <Card className="rounded-[22px] border border-[#c7d8ff] bg-[#f6f9ff] px-4 py-3.5 shadow-[0_10px_26px_-20px_rgba(37,99,235,0.28)]">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d8e3ff] bg-[#edf3ff] text-[#3b63ff]">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.95rem] font-medium text-[#5b74a8]">
                Ejecutados
              </p>
            </div>
            <p className="shrink-0 text-[1.45rem] font-semibold leading-none tracking-[-0.06em] text-[#0f172a]">
              {String(counts.executed)}
            </p>
          </div>
        </Card>
        <Card className="rounded-[22px] border border-[#c7d8ff] bg-[#f6f9ff] px-4 py-3.5 shadow-[0_10px_26px_-20px_rgba(37,99,235,0.28)]">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d8e3ff] bg-[#edf3ff] text-[#3b63ff]">
              <CircleSlash2 className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.95rem] font-medium text-[#5b74a8]">
                Cancelados
              </p>
            </div>
            <p className="shrink-0 text-[1.45rem] font-semibold leading-none tracking-[-0.06em] text-[#0f172a]">
              {String(counts.cancelled)}
            </p>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Reglas</CardTitle>
          </CardHeader>
          <ItemGroup className="gap-3 px-6 pb-6">
            {rules.length ? (
              rules.map((rule) => (
                <Item
                  key={rule.id}
                  variant="outline"
                  className="items-start gap-4 rounded-2xl px-4 py-4"
                >
                  <ItemMedia
                    variant="icon"
                    className="mt-0.5 h-10 w-10 rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]"
                  >
                    <span className="text-[12px] font-semibold">
                      {rule.name.slice(0, 1).toUpperCase()}
                    </span>
                  </ItemMedia>

                  <ItemContent className="min-w-0 flex-1">
                    <ItemTitle className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-slate-950">
                        {rule.name}
                      </span>
                      <Badge variant={rule.isActive ? "secondary" : "outline"}>
                        {rule.isActive ? "Activa" : "Pausada"}
                      </Badge>
                      <Badge variant="outline">{rule.sourceType}</Badge>
                      <Badge variant="outline">{rule.messageType}</Badge>
                    </ItemTitle>
                    <ItemDescription>
                      Origen: {sourceLabel(rule.sourceType, rule.sourceId)}
                    </ItemDescription>
                    <ItemDescription>
                      Programacion: cada {rule.timeValue}{" "}
                      {rule.timeType.toLowerCase()}
                    </ItemDescription>
                    <ItemDescription>
                      Canal: {rule.channel?.name ?? "Canal por defecto"}
                    </ItemDescription>
                    <ItemDescription>
                      Seguimientos generados: {rule._count?.follows ?? 0}
                    </ItemDescription>
                  </ItemContent>

                  <ItemContent className="flex-none items-end gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                          aria-label={`Acciones de ${rule.name}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="min-w-44 rounded-2xl"
                      >
                        <DropdownMenuItem
                          onSelect={() =>
                            setPendingDeleteRule({
                              id: rule.id,
                              name: rule.name,
                            })
                          }
                          className="gap-2 text-rose-600 focus:text-rose-700"
                        >
                          <Trash2 className="h-4 w-4" />
                          Eliminar regla
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ItemContent>
                </Item>
              ))
            ) : (
              <div className="px-1 py-4 text-sm text-slate-500">
                Todavia no hay reglas creadas.
              </div>
            )}
          </ItemGroup>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Seguimientos Recientes</CardTitle>
          </CardHeader>
          <ItemGroup className="gap-3 px-6 pb-6">
            {follows.length ? (
              follows.map((follow) => (
                <Item
                  key={follow.id}
                  variant="outline"
                  className="items-start gap-4 rounded-2xl px-4 py-4"
                >
                  <ItemMedia
                    variant="icon"
                    className="mt-0.5 h-10 w-10 rounded-2xl bg-[color-mix(in_srgb,var(--primary)_10%,white)] text-[var(--primary)]"
                  >
                    <span className="text-[12px] font-semibold">
                      {(follow.name ?? follow.followRule?.name ?? "S")
                        .slice(0, 1)
                        .toUpperCase()}
                    </span>
                  </ItemMedia>

                  <ItemContent className="min-w-0 flex-1">
                    <ItemTitle className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-slate-950">
                        {follow.name ?? follow.followRule?.name ?? "Sin nombre"}
                      </span>
                      <Badge className="px-1.5 text-muted-foreground"
                        variant={
                          follow.status === "PENDING"
                            ? "secondary"
                            : follow.status === "EXECUTED"
                              ? "outline"
                              : "outline"
                        }
                      >
                        <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
                        {follow.status}
                      </Badge>
                    </ItemTitle>
                    <div className="inline-flex items-center gap-1.5 truncate text-sm text-slate-600">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      {contactPhoneById.get(follow.contactId) ? (
                        <a
                          href={normalizePhoneHref(contactPhoneById.get(follow.contactId) || "")}
                          className="font-medium text-slate-600 no-underline hover:text-slate-700"
                        >
                          {contactPhoneById.get(follow.contactId)}
                        </a>
                      ) : (
                        follow.contactId
                      )}
                    </div>
                    {follow.followRule ? (
                      <ItemDescription className="truncate">
                        Regla: {follow.followRule.name}
                      </ItemDescription>
                    ) : null}
                    {follow.executionError ? (
                      <ItemDescription className="text-rose-600">
                        Error: {follow.executionError}
                      </ItemDescription>
                    ) : null}
                  </ItemContent>

                  <ItemContent className="flex-none items-end gap-2 text-right">
                    <ItemDescription className="inline-flex items-center gap-1.5 text-xs">
                      <Clock3 className="h-3.5 w-3.5" />
                      {formatDate(follow.executeAt)}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              ))
            ) : (
              <div className="px-1 py-4 text-sm text-slate-500">
                Todavia no hay seguimientos registrados.
              </div>
            )}
          </ItemGroup>
        </Card>
      </div>

      {pendingDeleteRule ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Eliminar regla"
          onClick={() => setPendingDeleteRule(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-950">
                Eliminar regla
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Vas a eliminar{" "}
                <span className="font-medium text-slate-900">
                  {pendingDeleteRule.name}
                </span>
                . Esta accion no se puede deshacer.
              </p>
            </div>

            <form action={deleteFormAction} className="space-y-4 px-5 py-5">
              <input
                type="hidden"
                name="followRuleId"
                value={pendingDeleteRule.id}
              />
              <input
                type="hidden"
                name="followRuleName"
                value={pendingDeleteRule.name}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPendingDeleteRule(null)}
                  disabled={deletePending}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  className="bg-rose-600 text-white hover:bg-rose-700"
                  disabled={deletePending}
                >
                  {deletePending ? "Eliminando..." : "Eliminar regla"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
