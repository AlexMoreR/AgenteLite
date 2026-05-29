import { BarChart3, CheckCircle2, CircleSlash2, TrendingUp, Users2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
  sourceOptions: Array<{
    label: string;
    options: SelectOption[];
  }>;
  crmStages: SelectOption[];
};

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
  sourceOptions,
  crmStages,
}: SeguimientosWorkspaceProps) {
  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-7 w-7 text-[#3b63ff]" />
          <h1 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">Seguimientos</h1>
        </div>
        <NewFollowDialog workspaceName={workspaceName} channels={channels} sourceOptions={sourceOptions} crmStages={crmStages} />
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
        <Card className="overflow-hidden border-slate-200">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-semibold tracking-[-0.03em] text-slate-950">Reglas activas</h2>
          </div>
          <div className="divide-y divide-slate-200">
            {rules.length ? (
              rules.map((rule) => (
                <div key={rule.id} className="space-y-2 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-950">{rule.name}</p>
                    <Badge variant={rule.isActive ? "secondary" : "outline"}>{rule.isActive ? "Activa" : "Pausada"}</Badge>
                    <Badge variant="outline">{rule.sourceType}</Badge>
                    <Badge variant="outline">{rule.messageType}</Badge>
                  </div>
                  <p className="text-sm text-slate-600">Origen: {sourceLabel(rule.sourceType, rule.sourceId)}</p>
                  <p className="text-sm text-slate-600">Programación: cada {rule.timeValue} {rule.timeType.toLowerCase()}</p>
                  <p className="text-sm text-slate-600">Canal: {rule.channel?.name ?? "Canal por defecto"}</p>
                  <p className="text-sm text-slate-600">Seguimientos generados: {rule._count?.follows ?? 0}</p>
                </div>
              ))
            ) : (
              <div className="px-5 py-8 text-sm text-slate-500">Todavía no hay reglas creadas.</div>
            )}
          </div>
        </Card>

        <Card className="overflow-hidden border-slate-200">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-semibold tracking-[-0.03em] text-slate-950">Seguimientos recientes</h2>
          </div>
          <div className="divide-y divide-slate-200">
            {follows.length ? (
              follows.map((follow) => (
                <div key={follow.id} className="space-y-2 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-950">{follow.messageType}</p>
                    <Badge variant={follow.status === "PENDING" ? "secondary" : follow.status === "EXECUTED" ? "default" : "outline"}>
                      {follow.status}
                    </Badge>
                    <Badge variant="outline">{follow.provider}</Badge>
                  </div>
                  <p className="text-sm text-slate-600">Ejecuta: {formatDate(follow.executeAt)}</p>
                  <p className="text-sm text-slate-600">Contacto: {follow.contactId}</p>
                  {follow.followRule ? <p className="text-sm text-slate-600">Regla: {follow.followRule.name}</p> : null}
                  {follow.executionError ? <p className="text-sm text-rose-600">Error: {follow.executionError}</p> : null}
                  <p className="text-xs text-slate-500">Creado {formatDate(follow.createdAt)}</p>
                </div>
              ))
            ) : (
              <div className="px-5 py-8 text-sm text-slate-500">Todavía no hay seguimientos registrados.</div>
            )}
          </div>
        </Card>
      </div>
    </section>
  );
}
