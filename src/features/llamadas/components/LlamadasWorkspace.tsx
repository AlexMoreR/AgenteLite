"use client";

import Link from "next/link";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, MessageCircle, AlertTriangle } from "lucide-react";
import { ContactAvatar } from "@/components/chats/contact-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getCrmStageMeta } from "@/features/crm/domain/crm-config";
import type { CrmStage } from "@/features/crm/types";
import { claimLeadOnOpenAction } from "@/app/actions/crm-actions";
import type {
  LlamadaLead,
  LlamadasOwnerData,
  LlamadasVendedoraData,
} from "@/features/llamadas/services/getLlamadasData";
import type { ResumenDiaData } from "@/features/llamadas/services/getResumenDia";
import { ResumenDiaView } from "@/features/llamadas/components/ResumenDiaView";
import { BotonLlamar } from "@/features/llamadas/components/BotonLlamar";
import { RegisterCallDialog, type PresetContact } from "@/features/llamadas/components/RegisterCallDialog";

function StageChip({ stage }: { stage: CrmStage }) {
  const meta = getCrmStageMeta(stage);
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.backgroundClassName} ${meta.borderClassName} ${meta.accentClassName}`}
    >
      {meta.label}
    </span>
  );
}

// ── Tarjeta de lead (vista vendedora) ─────────────────────────────────────────────────────────

function LeadCard({ lead, mode, onRegister, puedeMarcarEnLaApp }: { lead: LlamadaLead; mode: "call" | "whatsapp" | "new" | "pending"; onRegister: (preset: PresetContact) => void; puedeMarcarEnLaApp: boolean }) {
  const router = useRouter();
  const [abriendo, setAbriendo] = useState(false);
  const telLink = lead.callablePhone ? `tel:${lead.callablePhone.replace(/[^0-9+]/g, "")}` : null;

  /**
   * El boton de WhatsApp abre el chat ACA, no wa.me.
   *
   * Sacando a la asesora a WhatsApp el mensaje no queda registrado, el lead no cambia de etapa y
   * nadie se entera de que lo trabajo. Y de paso, si el lead no tenia dueño, atenderlo lo
   * convierte en suyo y desaparece de la lista de las demas — que es lo que uno espera al
   * agarrar algo del monton.
   */
  const abrirChat = async () => {
    if (abriendo || !lead.conversationId) {
      return;
    }
    setAbriendo(true);
    const conversationId = lead.conversationId;
    try {
      await claimLeadOnOpenAction(conversationId);
    } finally {
      router.push(`/cliente/chats?chatKey=${encodeURIComponent(`agent:${conversationId}`)}`);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
      <ContactAvatar
        avatarUrl={lead.avatarUrl}
        label={lead.name}
        className="h-10 w-10 shrink-0 rounded-full border border-border bg-muted text-muted-foreground"
        fallbackClassName="rounded-full bg-muted text-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-sm font-semibold">{lead.name}</span>
          <StageChip stage={lead.stage} />
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {lead.callablePhone ?? "Sin número para llamar · escribile por WhatsApp"}
        </div>
        <div className="mt-0.5 truncate text-xs">
          {lead.lastResultLabel ? (
            <span className="text-foreground/70">
              Últ: {lead.lastResultLabel} · intento {lead.attemptCount}
            </span>
          ) : (
            <span className="text-muted-foreground italic">Sin llamadas aún · intento 0</span>
          )}
        </div>
        {/*
          La grabacion, al lado de la llamada que hay que clasificar.

          Es justo donde sirve: para elegir "interesada" o "lo piensa" la asesora tiene que acordarse
          de que le dijeron, y la llamada puede ser de hace una hora. `preload="none"` porque la lista
          trae hasta 20: sin eso el navegador bajaba 20 WAVs de varios megas al abrir la pantalla.
        */}
        {lead.recordingUrl ? (
          <audio
            controls
            preload="none"
            src={lead.recordingUrl}
            className="mt-1.5 h-8 w-full max-w-xs"
          />
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {/* Sin telefono no se ofrece "Llamar": se cae a WhatsApp, que es lo unico que anda. */}
        {mode === "whatsapp" || !telLink ? (
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 text-emerald-600"
            aria-label="Abrir el chat"
            title="Abrir el chat"
            disabled={abriendo || !lead.conversationId}
            onClick={() => void abrirChat()}
          >
            <MessageCircle className="h-4 w-4" />
          </Button>
        ) : (
          /*
            Llama por WhatsApp desde la app: la llamada queda flotando y la asesora sigue viendo
            la lista mientras habla. Sin el servicio configurado se cae al tel: del telefono.
          */
          puedeMarcarEnLaApp ? (
            <BotonLlamar
              telefono={lead.callablePhone}
              nombre={lead.name}
              avatarUrl={lead.avatarUrl}
            />
          ) : (
            <a href={telLink} aria-label="Llamar">
              <Button variant="outline" size="icon" className="h-8 w-8 text-sky-600">
                <Phone className="h-4 w-4" />
              </Button>
            </a>
          )
        )}
        {/*
          Solo cuando hay una llamada hablada sin clasificar (pedido de Alex, 14-sep-2026). Las
          llamadas del marcador ya se anotan solas -las no contestadas, con su resultado-, asi que
          "Registrar" en cada tarjeta era un paso de mas.
        */}
        {lead.pendingAttemptId ? (
          <Button
            size="sm"
            onClick={() =>
              onRegister({
                contactId: lead.contactId,
                name: lead.name,
                phoneNumber: lead.phoneNumber,
                pendingAttemptId: lead.pendingAttemptId ?? null,
              })
            }
          >
            ¿Cómo quedó?
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  leads,
  mode,
  onRegister,
  emptyText,
  puedeMarcarEnLaApp,
}: {
  title: string;
  hint: string;
  leads: LlamadaLead[];
  mode: "call" | "whatsapp" | "new" | "pending";
  onRegister: (preset: PresetContact) => void;
  emptyText: string;
  puedeMarcarEnLaApp: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">{hint}</span>
        <span className="ml-auto text-xs font-medium text-muted-foreground">{leads.length}</span>
      </div>
      {leads.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <div className="space-y-2">
          {leads.map((lead) => (
            <LeadCard
              key={lead.contactId}
              lead={lead}
              mode={mode}
              onRegister={onRegister}
              puedeMarcarEnLaApp={puedeMarcarEnLaApp}
            />
          ))}
        </div>
      )}
    </div>
  );
}

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
  vendedora,
  owner,
  canSeeOwner,
  resumen,
  marcadorUrl,
  pestanaInicial,
}: {
  vendedora: LlamadasVendedoraData;
  owner: LlamadasOwnerData | null;
  canSeeOwner: boolean;
  resumen: ResumenDiaData;
  /** Hay servicio de llamadas configurado: sin el, el boton se cae al marcador del telefono. */
  marcadorUrl: string | null;
  pestanaInicial: string;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [preset, setPreset] = useState<PresetContact | null>(null);

  const openRegister = useCallback((next: PresetContact | null) => {
    setPreset(next);
    setDialogOpen(true);
  }, []);

  const vendedoraView = (
    <div className="space-y-5">
      {/*
        Va primera y solo aparece si hay algo: son llamadas que YA pasaron y todavía no quedaron
        asentadas. Una sección vacía permanente arriba de todo entrena a saltearla.
      */}
      {vendedora.sinRegistrar.length > 0 ? (
        <Section
          title="📞 Sin registrar"
          hint="Ya hablaste, falta decir cómo quedó"
          leads={vendedora.sinRegistrar}
          mode="pending"
          onRegister={openRegister}
          puedeMarcarEnLaApp={Boolean(marcadorUrl)}
          emptyText=""
        />
      ) : null}
      <Section
        title="🔴 Llamar hoy"
        hint="Calientes con contacto para hoy"
        leads={vendedora.llamarHoy}
        mode="call"
        onRegister={openRegister}
        puedeMarcarEnLaApp={Boolean(marcadorUrl)}
        emptyText="Nada urgente para llamar hoy."
      />
      <Section
        title="🟡 WhatsApp hoy"
        hint="Tibios con contacto para hoy"
        leads={vendedora.whatsappHoy}
        mode="whatsapp"
        onRegister={openRegister}
        puedeMarcarEnLaApp={Boolean(marcadorUrl)}
        emptyText="Sin tibios agendados para hoy."
      />
      <Section
        title="⚪ Nuevos sin tocar"
        hint="Máx. 10 sugeridos"
        leads={vendedora.nuevos}
        mode="new"
        onRegister={openRegister}
        puedeMarcarEnLaApp={Boolean(marcadorUrl)}
        emptyText="No hay leads nuevos sin llamar."
      />
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5">
      {/*
        Sin titulo ni bajada: el encabezado de la app ya dice "Llamadas" dos centimetros mas
        arriba, y la bajada explicaba una pantalla que se explica sola.

        Sin "Registrar llamada" (Alex, 14-sep-2026): las llamadas se hacen desde el marcador del CRM,
        que las anota solas y las graba; lo unico que queda es decir como quedo.
      */}

      {/* "Resumen" lo ve CUALQUIERA (cada una manda el suyo); "Tablero" solo el dueño. */}
      <Tabs defaultValue={pestanaInicial}>
        <TabsList className="mb-4">
          <TabsTrigger value="vendedora">Mi día</TabsTrigger>
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          {canSeeOwner && owner ? <TabsTrigger value="tablero">Tablero</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="vendedora">{vendedoraView}</TabsContent>
        <TabsContent value="resumen">
          <ResumenDiaView data={resumen} />
        </TabsContent>
        {canSeeOwner && owner ? (
          <TabsContent value="tablero">
            <OwnerBoard data={owner} />
          </TabsContent>
        ) : null}
      </Tabs>

      <RegisterCallDialog open={dialogOpen} onOpenChange={setDialogOpen} preset={preset} />
    </div>
  );
}
