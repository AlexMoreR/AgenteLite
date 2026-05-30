"use client";

import { useActionState, useEffect, useState } from "react";
import { BarChart3, CheckCircle2, CircleSlash2, MoreHorizontal, Trash2, TrendingUp, Users2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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

type SelectOption = {
  value: string;
  label: string;
  color?: string;
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
  const [pendingDeleteRule, setPendingDeleteRule] = useState<PendingDeleteRule>(null);
  const [deleteActionState, deleteFormAction, deletePending] = useActionState(
    deleteFollowRuleAction,
    { error: "" } as DeleteFollowRuleActionState,
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
          <h1 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">Seguimientos</h1>
        </div>
        <NewFollowDialog workspaceName={workspaceName} channels={channels} contacts={contacts} sourceOptions={sourceOptions} crmStages={crmStages} />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-[22px] border border-[#c7d8ff] bg-[#f6f9ff] px-4 py-3.5 shadow-[0_10px_26px_-20px_rgba(37,99,235,0.28)]">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d8e3ff] bg-[#edf3ff] text-[#3b63ff]">
              <Users2 className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.95rem] font-medium text-[#5b74a8]">Total</p>
            </div>
            <p className="shrink-0 text-[1.45rem] font-semibold leading-none tracking-[-0.06em] text-[#0f172a]">{String(counts.total)}</p>
          </div>
        </Card>
        <Card className="rounded-[22px] border border-[#c7d8ff] bg-[#f6f9ff] px-4 py-3.5 shadow-[0_10px_26px_-20px_rgba(37,99,235,0.28)]">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d8e3ff] bg-[#edf3ff] text-[#3b63ff]">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.95rem] font-medium text-[#5b74a8]">En proceso</p>
            </div>
            <p className="shrink-0 text-[1.45rem] font-semibold leading-none tracking-[-0.06em] text-[#0f172a]">{String(counts.pending)}</p>
          </div>
        </Card>
        <Card className="rounded-[22px] border border-[#c7d8ff] bg-[#f6f9ff] px-4 py-3.5 shadow-[0_10px_26px_-20px_rgba(37,99,235,0.28)]">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d8e3ff] bg-[#edf3ff] text-[#3b63ff]">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.95rem] font-medium text-[#5b74a8]">Ejecutados</p>
            </div>
            <p className="shrink-0 text-[1.45rem] font-semibold leading-none tracking-[-0.06em] text-[#0f172a]">{String(counts.executed)}</p>
          </div>
        </Card>
        <Card className="rounded-[22px] border border-[#c7d8ff] bg-[#f6f9ff] px-4 py-3.5 shadow-[0_10px_26px_-20px_rgba(37,99,235,0.28)]">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d8e3ff] bg-[#edf3ff] text-[#3b63ff]">
              <CircleSlash2 className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.95rem] font-medium text-[#5b74a8]">Cancelados</p>
            </div>
            <p className="shrink-0 text-[1.45rem] font-semibold leading-none tracking-[-0.06em] text-[#0f172a]">{String(counts.cancelled)}</p>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card className="overflow-hidden border border-slate-200/80 bg-white p-0 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.34)]">
          <div className="px-6 py-5">
            <h2 className="text-lg font-semibold tracking-[-0.03em] text-slate-950">Reglas activas</h2>
          </div>
          <Separator />
          <div className="divide-y divide-slate-200/80">
            {rules.length ? (
              rules.map((rule) => (
                <div key={rule.id} className="px-6 py-5">
                  <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-slate-50/70 px-4 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-semibold text-slate-950">{rule.name}</p>
                          <Badge variant={rule.isActive ? "secondary" : "outline"}>{rule.isActive ? "Activa" : "Pausada"}</Badge>
                          <Badge variant="outline">{rule.sourceType}</Badge>
                          <Badge variant="outline">{rule.messageType}</Badge>
                        </div>
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                            aria-label={`Acciones de ${rule.name}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-44 rounded-2xl">
                          <DropdownMenuItem
                            onSelect={() => setPendingDeleteRule({ id: rule.id, name: rule.name })}
                            className="gap-2 text-rose-600 focus:text-rose-700"
                          >
                            <Trash2 className="h-4 w-4" />
                            Eliminar regla
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="mt-4 grid gap-2 text-sm text-slate-600">
                      <p>Origen: {sourceLabel(rule.sourceType, rule.sourceId)}</p>
                      <p>Programacion: cada {rule.timeValue} {rule.timeType.toLowerCase()}</p>
                      <p>Canal: {rule.channel?.name ?? "Canal por defecto"}</p>
                      <p>Seguimientos generados: {rule._count?.follows ?? 0}</p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-6 py-8 text-sm text-slate-500">Todavia no hay reglas creadas.</div>
            )}
          </div>
        </Card>

        <Card className="overflow-hidden border border-slate-200/80 bg-white p-0 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.34)]">
          <div className="px-6 py-5">
            <h2 className="text-lg font-semibold tracking-[-0.03em] text-slate-950">Seguimientos recientes</h2>
          </div>
          <Separator />
          <div className="divide-y divide-slate-200/80">
            {follows.length ? (
              follows.map((follow) => (
                <div key={follow.id} className="px-6 py-5">
                  <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-slate-50/70 px-4 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold tracking-[-0.03em] text-slate-950">{follow.name ?? follow.followRule?.name ?? "Sin nombre"}</p>
                      <Badge variant={follow.status === "PENDING" ? "secondary" : follow.status === "EXECUTED" ? "default" : "outline"}>
                        {follow.status}
                      </Badge>
                      <span className="text-xs uppercase tracking-[0.18em] text-slate-400">{follow.messageType}</span>
                    </div>
                    <div className="mt-4 grid gap-2 text-sm text-slate-600">
                      <p>Ejecuta: {formatDate(follow.executeAt)}</p>
                      <p className="truncate">Contacto: {follow.contactId}</p>
                      {follow.followRule ? <p className="truncate">Regla: {follow.followRule.name}</p> : null}
                      {follow.executionError ? <p className="text-rose-600">Error: {follow.executionError}</p> : null}
                    </div>
                    <Separator className="my-4" />
                    <p className="text-xs text-slate-500">Creado {formatDate(follow.createdAt)}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-6 py-8 text-sm text-slate-500">Todavia no hay seguimientos registrados.</div>
            )}
          </div>
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
              <h3 className="text-base font-semibold text-slate-950">Eliminar regla</h3>
              <p className="mt-1 text-sm text-slate-600">
                Vas a eliminar <span className="font-medium text-slate-900">{pendingDeleteRule.name}</span>. Esta accion no se puede deshacer.
              </p>
            </div>

            <form action={deleteFormAction} className="space-y-4 px-5 py-5">
              <input type="hidden" name="followRuleId" value={pendingDeleteRule.id} />
              <input type="hidden" name="followRuleName" value={pendingDeleteRule.name} />

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setPendingDeleteRule(null)} disabled={deletePending}>
                  Cancelar
                </Button>
                <Button type="submit" className="bg-rose-600 text-white hover:bg-rose-700" disabled={deletePending}>
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
