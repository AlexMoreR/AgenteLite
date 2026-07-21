"use client";

import Link from "next/link";
import { MessageCircle, Clock, Flame } from "lucide-react";
import { ContactAvatar } from "@/components/chats/contact-avatar";
import { CRM_STAGE_META } from "../domain/crm-config";
import type { CrmStage } from "../types";
import type { MiDiaData } from "../services/getMiDiaData";

function formatSince(hours: number) {
  if (hours < 1) return "hace un rato";
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}

function StageBadge({ stage }: { stage: CrmStage }) {
  const meta = CRM_STAGE_META[stage];
  if (!meta) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-[1px] text-[10px] font-semibold ${meta.borderClassName} ${meta.backgroundClassName} ${meta.accentClassName}`}
    >
      {meta.label}
    </span>
  );
}

export function MiDiaView({ data }: { data: MiDiaData }) {
  const { leads } = data;
  const waiting = leads.filter((lead) => lead.waitingOnUs).length;

  return (
    <section className="space-y-3 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Mi día</h1>
          <p className="text-sm text-muted-foreground">A quién contactar hoy, de más urgente a menos.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-[var(--primary)]">
            {leads.length} por contactar
          </span>
          {waiting > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-3 py-1 text-sm font-semibold text-rose-700 dark:bg-rose-500/10">
              <Flame className="h-3.5 w-3.5" />
              {waiting} esperan respuesta
            </span>
          ) : null}
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-background/60 px-4 py-12 text-center">
          <p className="text-sm font-medium text-foreground">Todo al día 🎉</p>
          <p className="mt-1 text-sm text-muted-foreground">
            No hay leads del embudo esperando seguimiento. Cuando alguien cotizado quede sin
            respuesta, aparece acá.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {leads.map((lead) => (
            <li key={lead.conversationId}>
              <Link
                href={`/cliente/chats?chatKey=${encodeURIComponent(lead.chatKey)}`}
                className={`flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 transition hover:bg-muted/50 ${
                  lead.waitingOnUs ? "border-rose-200 dark:border-rose-500/30" : "border-border"
                }`}
              >
                <ContactAvatar
                  avatarUrl={lead.avatarUrl}
                  label={lead.name}
                  className="size-11 shrink-0 rounded-full"
                  fallbackClassName="rounded-full bg-muted text-muted-foreground"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">{lead.name}</p>
                    <StageBadge stage={lead.stage} />
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{lead.lastMessagePreview}</p>
                  <div className="mt-1 flex items-center gap-2 text-[11px]">
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatSince(lead.hoursSinceContact)}
                    </span>
                    {lead.waitingOnUs ? (
                      <span className="font-semibold text-rose-600 dark:text-rose-400">Te escribió · sin responder</span>
                    ) : (
                      <span className="text-muted-foreground">Sin respuesta · hacé seguimiento</span>
                    )}
                  </div>
                </div>

                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--primary)] px-3 py-1.5 text-[13px] font-semibold text-white">
                  <MessageCircle className="h-4 w-4" />
                  Abrir
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
