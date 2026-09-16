"use client";

import Link from "next/link";

import { Phone, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getCrmStageMeta } from "@/features/crm/domain/crm-config";
import type { LlamadasOwnerData } from "@/features/llamadas/services/getLlamadasData";
import type { ResumenDiaData } from "@/features/llamadas/services/getResumenDia";
import { ResumenDiaView } from "@/features/llamadas/components/ResumenDiaView";
import { TodasLasLlamadas } from "@/features/llamadas/components/TodasLasLlamadas";

// ── Tablero del dueño ─────────────────────────────────────────────────────────────────────────

function OwnerBoard({ data }: { data: LlamadasOwnerData }) {
  const maxStage = Math.max(1, ...data.stageDistribution.map((entry) => entry.count));
  const maxReason = Math.max(1, ...data.lostReasons.map((entry) => entry.count));

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Cómo viene cada una, en una fila. Ocupa el ancho completo porque es lo primero que
          Alex mira al abrir el tablero. */}
      <Card className="md:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Cómo viene cada una</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.equipo.length === 0 ? (
            <p className="px-6 pb-4 text-xs text-muted-foreground">Todavía no hay vendedoras cargadas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Vendedora</th>
                    <th className="px-3 py-2 text-right font-medium">Leads</th>
                    <th className="px-3 py-2 text-right font-medium">Movidos hoy</th>
                    <th className="px-3 py-2 text-right font-medium">Llamadas hoy</th>
                    <th className="px-3 py-2 text-right font-medium">Semana</th>
                    <th className="px-4 py-2 text-right font-medium">Ventas</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {data.equipo.map((persona) => (
                    <tr key={persona.userId ?? persona.name} className="border-b border-border/60 last:border-0">
                      <td className="max-w-[10rem] truncate px-4 py-2 font-medium">
                        {/* El nombre abre SU tablero completo: la fila resume, pero para saber
                            por que viene floja hace falta ver sus etapas y lo que se le enfria. */}
                        {persona.userId ? (
                          <Link
                            href={`/cliente/mi-tablero?userId=${encodeURIComponent(persona.userId)}`}
                            className="text-[var(--primary)] hover:underline"
                          >
                            {persona.name}
                          </Link>
                        ) : (
                          persona.name
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{persona.leadsACargo}</td>
                      <td className="px-3 py-2 text-right">{persona.conMovimientoHoy}</td>
                      <td className="px-3 py-2 text-right">{persona.llamadasHoy}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{persona.llamadasSemana}</td>
                      <td className="px-4 py-2 text-right font-semibold text-emerald-600">
                        {persona.ventasSemana}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="px-4 pb-3 pt-2 text-[11px] leading-4 text-muted-foreground">
            &quot;Movidos hoy&quot; son los chats suyos con movimiento hoy — escriba ella o escriba el
            cliente. Los mensajes no guardan quién los escribió, así que no se puede separar.
            &quot;Ventas&quot; y &quot;Semana&quot; van de los últimos 7 días.
          </p>
        </CardContent>
      </Card>

      {/* Cada llamada del equipo con su grabacion: esto es lo que se revisa para supervisar. */}
      <TodasLasLlamadas />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Llamadas por vendedor</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>Hoy: <b className="text-foreground">{data.callsToday}</b></span>
            <span>Semana: <b className="text-foreground">{data.callsThisWeek}</b></span>
          </div>
          {data.byUser.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin llamadas registradas todavía.</p>
          ) : (
            data.byUser.map((entry) => (
              <div key={entry.userId ?? "sin"} className="flex items-center justify-between">
                <span className="truncate">{entry.name}</span>
                <span className="text-xs text-muted-foreground">
                  hoy {entry.today} · semana {entry.week}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Leads por etapa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {data.stageDistribution.map((entry) => {
            const meta = getCrmStageMeta(entry.stage);
            return (
              <div key={entry.stage} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0">{meta.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary/70" style={{ width: `${(entry.count / maxStage) * 100}%` }} />
                </div>
                <span className="w-8 shrink-0 text-right font-medium">{entry.count}</span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Motivos de pérdida</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {data.lostReasons.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin pérdidas registradas.</p>
          ) : (
            data.lostReasons.map((entry) => (
              <div key={entry.reason} className="flex items-center gap-2 text-xs">
                <span className="w-28 shrink-0 truncate">{entry.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-rose-400" style={{ width: `${(entry.count / maxReason) * 100}%` }} />
                </div>
                <span className="w-6 shrink-0 text-right font-medium">{entry.count}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Leads que se enfrían ({data.rottingCount})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="mb-1 text-xs text-muted-foreground">+5 días sin ningún intento de llamada.</p>
          {data.rotting.length === 0 ? (
            <p className="text-xs text-muted-foreground">Ninguno. 👏</p>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {data.rotting.map((lead) => (
                <div key={lead.contactId} className="flex items-center justify-between text-xs">
                  <span className="min-w-0 truncate">{lead.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {lead.daysSinceLastCall === null ? "sin llamadas" : `hace ${lead.daysSinceLastCall}d`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────────────────────

export function LlamadasWorkspace({
  owner,
  canSeeOwner,
  resumen,
  pestanaInicial,
}: {
  owner: LlamadasOwnerData | null;
  canSeeOwner: boolean;
  resumen: ResumenDiaData;
  pestanaInicial: string;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5">
      {/*
        Sin pestaña "Mi dia" (Alex, 15-sep-2026): a quien llamar hoy, lo que falta clasificar y los
        leads nuevos se mudaron a Mi dia, junto con los chats. Habia DOS "Mi dia" -uno aca y otro en
        el CRM- y la asesora tenia que mirar los dos para saber que le tocaba.

        Aca queda lo que no es trabajo del dia: el resumen que ella manda y el tablero del jefe.
      */}
      <div className="mb-4">
        <Link
          href="/cliente/crm/mi-dia"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--primary)] hover:underline"
        >
          <Phone className="size-3.5" />
          A quién llamar hoy está en Mi día
        </Link>
      </div>

      {/* "Resumen" lo ve CUALQUIERA (cada una manda el suyo); "Tablero" solo el dueño. */}
      <Tabs defaultValue={pestanaInicial === "vendedora" ? "resumen" : pestanaInicial}>
        <TabsList className="mb-4">
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          {canSeeOwner && owner ? <TabsTrigger value="tablero">Tablero</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="resumen">
          <ResumenDiaView data={resumen} />
        </TabsContent>
        {canSeeOwner && owner ? (
          <TabsContent value="tablero">
            <OwnerBoard data={owner} />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
