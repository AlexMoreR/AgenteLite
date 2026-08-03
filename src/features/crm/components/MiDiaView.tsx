"use client";

import Link from "next/link";
import { useState } from "react";

import { MiDiaLeadDialog } from "./MiDiaLeadDialog";
import { MessageCircle, Clock, Flame, PhoneCall } from "lucide-react";
import { ContactAvatar } from "@/components/chats/contact-avatar";
import { CRM_STAGE_META } from "../domain/crm-config";
import type { CrmStage } from "../types";
import type { MiDiaLead } from "../services/getMiDiaData";

/** Ya paso la fecha en que quedo de llamar: no es "para hoy", esta atrasada. */
function esVencida(nextContactAt: string | null) {
  if (!nextContactAt) return false;
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date(nextContactAt));
  return dia < hoy;
}
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
  const [leadAbierto, setLeadAbierto] = useState<MiDiaLead | null>(null);
  const waiting = leads.filter((lead) => lead.waitingOnUs).length;
  // Desglose por etapa: la asesora ve de un golpe cuanto de lo que tiene entre manos es plata
  // cerca de cerrarse (Caliente) y cuanto es todavia frio, sin tener que contar filas.
  const mios = leads.filter((lead) => lead.esMio).length;
  const sinDuenio = leads.length - mios;
  const porEtapa = (["NEGOCIACION", "PROPUESTA", "CALIFICADO"] as CrmStage[])
    .map((stage) => ({ stage, total: leads.filter((lead) => lead.stage === stage).length }))
    .filter((fila) => fila.total > 0);
  const primero = leads[0] ?? null;

  return (
    <section className="space-y-3 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Mi día</h1>
          <p className="text-sm text-muted-foreground">
            {mios > 0 && sinDuenio > 0
              ? `${mios} ${mios === 1 ? "tuyo" : "tuyos"} y ${sinDuenio} sin dueño. De más urgente a menos.`
              : mios > 0
                ? "Tus leads, de más urgente a menos."
                : "Leads sin dueño: tomá los que puedas atender."}
          </p>
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

      {porEtapa.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {porEtapa.map(({ stage, total }) => (
            <span key={stage} className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <StageBadge stage={stage} />
              {total}
            </span>
          ))}
        </div>
      ) : null}

      {/* La PRIMERA tarea, destacada: sin esto la asesora abria la pantalla y tenia que decidir
          por donde empezar. Es la misma que encabeza la lista, puesta al frente. */}
      {primero ? (
        <div className="rounded-xl border border-[var(--primary)]/25 bg-primary/[0.04] px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--primary)]">
            Empezá por acá
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{primero.name}</span>
            <StageBadge stage={primero.stage} />
            <span className="text-[13px] text-muted-foreground">
              sin contacto {formatSince(primero.hoursSinceContact)}
              {primero.waitingOnUs ? " · está esperando respuesta" : ""}
            </span>
            <Link
              href={`/cliente/chats?chatKey=${encodeURIComponent(primero.chatKey)}`}
              onClick={(evento) => {
                evento.preventDefault();
                setLeadAbierto(primero);
              }}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)] px-3 py-1 text-[13px] font-semibold text-white transition hover:opacity-90"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Escribirle
            </Link>
          </div>
        </div>
      ) : null}

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
          {leads.map((lead, indice) => (
            <li key={lead.conversationId}>
              {/* Encabezado al empezar cada bloque. Va aca y no como etiqueta en cada fila
                  porque en el celular la etiqueta le comia el nombre al cliente ("An…", "M…"),
                  que es justo el dato que la asesora necesita leer de un vistazo. */}
              {indice === 0 || leads[indice - 1]!.esMio !== lead.esMio ? (
                <p className="px-1 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {lead.esMio ? "Tuyos" : "Sin dueño · tomá los que puedas"}
                </p>
              ) : null}
              <Link
                href={`/cliente/chats?chatKey=${encodeURIComponent(lead.chatKey)}`}
                onClick={(evento) => {
                  evento.preventDefault();
                  setLeadAbierto(lead);
                }}
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
                    {/* El compromiso agendado manda: si quedo de llamar, eso es lo que tiene
                        que hacer, mas alla de quien hablo ultimo. */}
                    {lead.callDue ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400">
                        <PhoneCall className="h-3 w-3" />
                        {esVencida(lead.nextContactAt) ? "Llamada vencida" : "Llamar hoy"}
                        {lead.lastCallResultLabel ? ` · ${lead.lastCallResultLabel}` : ""}
                      </span>
                    ) : lead.waitingOnUs ? (
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

      <MiDiaLeadDialog lead={leadAbierto} onClose={() => setLeadAbierto(null)} />
    </section>
  );
}
