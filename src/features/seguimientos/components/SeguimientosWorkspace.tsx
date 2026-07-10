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
  Loader,
  Send,
  Phone,
  MoreHorizontal,
  Pencil,
  Trash2,
  TrendingUp,
  Users2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { NewFollowDialog, type EditFollowRule } from "./NewFollowDialog";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle, ItemMedia } from "@/components/ui/item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type SelectOption = {
  value: string;
  label: string;
  color?: string;
  phoneNumber?: string;
};

type FollowRuleRow = {
  id: string;
  name: string;
  channelId: string | null;
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
  actions?: Array<{
    messageType: string;
    content: string | null;
    mediaUrl: string | null;
  }>;
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

function followStatusLabel(status: string) {
  if (status === "EXECUTED") return "Enviado";
  if (status === "PENDING") return "Pendiente";
  if (status === "CANCELLED") return "Cancelado";
  return status;
}

function normalizePhoneHref(phoneNumber: string) {
  const digits = phoneNumber.replace(/\D/g, "");
  return digits ? `tel:+${digits}` : "";
}

function toEditFollowRule(rule: FollowRuleRow): EditFollowRule {
  return {
    id: rule.id,
    name: rule.name,
    channelId: rule.channelId,
    sourceType: rule.sourceType as EditFollowRule["sourceType"],
    sourceId: rule.sourceId,
    timeType: rule.timeType as EditFollowRule["timeType"],
    timeValue: rule.timeValue,
    messageType: rule.messageType as EditFollowRule["messageType"],
    content: rule.content,
    mediaUrl: rule.mediaUrl,
    cancelOnActivity: rule.cancelOnActivity,
    isActive: rule.isActive,
    actions: (rule.actions ?? []).map((action) => ({
      messageType: action.messageType as EditFollowRule["messageType"],
      content: action.content,
      mediaUrl: action.mediaUrl,
    })),
  };
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
  const [editingRule, setEditingRule] = useState<EditFollowRule | null>(null);
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

  const statCards = [
    { label: "Total", value: counts.total, icon: Users2 },
    { label: "En proceso", value: counts.pending, icon: TrendingUp },
    { label: "Ejecutados", value: counts.executed, icon: CheckCircle2 },
    { label: "Cancelados", value: counts.cancelled, icon: CircleSlash2 },
  ];

  return (
    <section className="space-y-5 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <PageHeader icon={BarChart3} title="Seguimientos" />
        <NewFollowDialog
          workspaceName={workspaceName}
          channels={channels}
          contacts={contacts}
          sourceOptions={sourceOptions}
          crmStages={crmStages}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map(({ label, value, icon: Icon }) => (
          <Card key={label} size="sm">
            <CardContent className="flex items-center gap-3">
              <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">
                {label}
              </p>
              <p className="shrink-0 text-2xl font-semibold leading-none tracking-tight">
                {String(value)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Reglas</CardTitle>
          </CardHeader>
          <ItemGroup className="gap-2.5 px-4 pb-4">
            {rules.length ? (
              rules.map((rule) => (
                <Item
                  key={rule.id}
                  variant="outline"
                  className="items-start gap-3 px-3.5 py-3"
                >
                  <ItemMedia
                    variant="icon"
                    className="mt-0.5 size-10 rounded-lg bg-primary/10 text-primary"
                  >
                    <span className="text-xs font-semibold">
                      {rule.name.slice(0, 1).toUpperCase()}
                    </span>
                  </ItemMedia>

                  <ItemContent className="min-w-0 flex-1">
                    <ItemTitle className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold">
                        {rule.name}
                      </span>
                      <Badge variant={rule.isActive ? "secondary" : "outline"}>
                        {rule.isActive ? "Activa" : "Pausada"}
                      </Badge>
                      <Badge variant="outline">
                        <Clock3 className="h-3 w-3" />
                        cada {rule.timeValue} {rule.timeType.toLowerCase()}
                      </Badge>
                    </ItemTitle>
                    <ItemDescription>
                      Seguimientos generados: {rule._count?.follows ?? 0}
                    </ItemDescription>
                  </ItemContent>

                  <ItemContent className="flex-none items-end gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Acciones de ${rule.name}`}
                          />
                        }
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44">
                        <DropdownMenuItem
                          onClick={() => setEditingRule(toEditFollowRule(rule))}
                        >
                          <Pencil className="h-4 w-4" />
                          Editar regla
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() =>
                            setPendingDeleteRule({
                              id: rule.id,
                              name: rule.name,
                            })
                          }
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
              <div className="px-1 py-4 text-sm text-muted-foreground">
                Todavia no hay reglas creadas.
              </div>
            )}
          </ItemGroup>
        </Card>

        <Card className="max-h-[32rem]">
          <CardHeader>
            <CardTitle>Seguimientos Recientes</CardTitle>
          </CardHeader>
          <ItemGroup className="min-h-0 flex-1 gap-2.5 overflow-y-auto px-4 pb-4">
            {follows.length ? (
              follows.map((follow) => (
                <Item
                  key={follow.id}
                  variant="outline"
                  size="sm"
                  className="items-center gap-2.5 px-3 py-2"
                >
                  <ItemMedia
                    variant="icon"
                    className="size-9 rounded-lg bg-primary/10 text-primary"
                  >
                    <Send className="h-4 w-4" />
                  </ItemMedia>

                  <ItemContent className="min-w-0 flex-1 gap-0.5">
                    <ItemTitle>
                      <span className="truncate font-normal">
                        {follow.name ?? follow.followRule?.name ?? "Sin nombre"}
                      </span>
                    </ItemTitle>
                    <div className="inline-flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      <Phone className="h-3 w-3 shrink-0" />
                      {contactPhoneById.get(follow.contactId) ? (
                        <a
                          href={normalizePhoneHref(contactPhoneById.get(follow.contactId) || "")}
                          className="font-medium no-underline hover:text-foreground"
                        >
                          {contactPhoneById.get(follow.contactId)}
                        </a>
                      ) : (
                        follow.contactId
                      )}
                    </div>
                  </ItemContent>

                  <ItemContent className="flex-none items-end gap-1 text-right">
                    {follow.executionError ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Badge
                              variant={
                                follow.status === "PENDING" ? "secondary" : "outline"
                              }
                              className="cursor-default"
                            >
                              {follow.status === "EXECUTED" ? (
                                <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
                              ) : null}
                              {follow.status === "PENDING" ? (
                                <Loader className="h-3 w-3 animate-spin text-orange-500" />
                              ) : null}
                              {follow.status === "CANCELLED" ? (
                                <CircleSlash2 className="h-3 w-3 text-muted-foreground" />
                              ) : null}
                              {followStatusLabel(follow.status)}
                            </Badge>
                          }
                        />
                        <TooltipContent>
                          {follow.status === "CANCELLED" ? "Cancelado" : "Error"}: {follow.executionError}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Badge
                        variant={
                          follow.status === "PENDING" ? "secondary" : "outline"
                        }
                      >
                        {follow.status === "EXECUTED" ? (
                          <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
                        ) : null}
                        {follow.status === "PENDING" ? (
                          <Loader className="h-3 w-3 animate-spin text-orange-500" />
                        ) : null}
                        {follow.status === "CANCELLED" ? (
                          <CircleSlash2 className="h-3 w-3 text-muted-foreground" />
                        ) : null}
                        {followStatusLabel(follow.status)}
                      </Badge>
                    )}
                    <ItemDescription className="inline-flex items-center gap-1 text-[11px]">
                      {formatDate(follow.executeAt)}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              ))
            ) : (
              <div className="px-1 py-4 text-sm text-muted-foreground">
                Todavia no hay seguimientos registrados.
              </div>
            )}
          </ItemGroup>
        </Card>
      </div>

      <NewFollowDialog
        mode="edit"
        editRule={editingRule}
        open={editingRule !== null}
        onOpenChange={(open) => {
          if (!open) setEditingRule(null);
        }}
        workspaceName={workspaceName}
        channels={channels}
        contacts={contacts}
        sourceOptions={sourceOptions}
        crmStages={crmStages}
      />

      <Dialog
        open={pendingDeleteRule !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteRule(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar regla</DialogTitle>
            <DialogDescription>
              Vas a eliminar{" "}
              <span className="font-medium text-foreground">
                {pendingDeleteRule?.name}
              </span>
              . Esta accion no se puede deshacer.
            </DialogDescription>
          </DialogHeader>

          <form action={deleteFormAction}>
            <input
              type="hidden"
              name="followRuleId"
              value={pendingDeleteRule?.id ?? ""}
            />
            <input
              type="hidden"
              name="followRuleName"
              value={pendingDeleteRule?.name ?? ""}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPendingDeleteRule(null)}
                disabled={deletePending}
              >
                Cancelar
              </Button>
              <Button type="submit" variant="destructive" disabled={deletePending}>
                {deletePending ? "Eliminando..." : "Eliminar regla"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
