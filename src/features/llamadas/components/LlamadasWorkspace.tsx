"use client";

import Link from "next/link";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Phone, MessageCircle, Search, Clock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { ContactAvatar } from "@/components/chats/contact-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  CALL_RESULTS,
  CALL_RESULT_LOST,
  CRM_LOST_REASONS,
  getCrmStageMeta,
} from "@/features/crm/domain/crm-config";
import type { CrmStage } from "@/features/crm/types";
import { claimLeadOnOpenAction } from "@/app/actions/crm-actions";
import {
  registerCallAttemptAction,
  searchContactsForCallAction,
  type CallContactSearchItem,
} from "@/app/actions/call-actions";
import type {
  LlamadaLead,
  LlamadasOwnerData,
  LlamadasVendedoraData,
} from "@/features/llamadas/services/getLlamadasData";
import type { ResumenDiaData } from "@/features/llamadas/services/getResumenDia";
import { ResumenDiaView } from "@/features/llamadas/components/ResumenDiaView";

type PresetContact = {
  contactId: string;
  name: string;
  phoneNumber?: string;
  /**
   * Cuando viene, el diálogo COMPLETA esa llamada en vez de anotar una nueva.
   *
   * Es la llamada que WaCalls ya registró sola y a la que solo le falta el resultado. Sin esto,
   * clasificarla crearía un segundo intento y el lead figuraría con el doble de llamadas.
   */
  pendingAttemptId?: string | null;
};

function todayInputValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

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

// ── Diálogo de registro de llamada ────────────────────────────────────────────────────────────

function RegisterCallDialog({
  open,
  onOpenChange,
  preset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset: PresetContact | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Contacto elegido: el preset (desde una tarjeta) o el que se busca (registro retroactivo).
  const [selected, setSelected] = useState<PresetContact | null>(preset);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<CallContactSearchItem[]>([]);
  const [searching, setSearching] = useState(false);

  const [result, setResult] = useState<string>(CALL_RESULTS[0].value);
  const [summary, setSummary] = useState("");
  const [nextContact, setNextContact] = useState("");
  const [lostReason, setLostReason] = useState<string>(CRM_LOST_REASONS[0].value);
  const [calledAt, setCalledAt] = useState(todayInputValue());

  // Sincroniza el preset cuando se abre desde otra tarjeta.
  const effectivePreset = preset;
  const resetAndSelect = useCallback((contact: PresetContact | null) => {
    setSelected(contact);
    setResult(CALL_RESULTS[0].value);
    setSummary("");
    setNextContact("");
    setLostReason(CRM_LOST_REASONS[0].value);
    setCalledAt(todayInputValue());
    setSearchTerm("");
    setSearchResults([]);
  }, []);

  // Al ABRIR (sea por interacción o porque el padre lo abre para otra tarjeta), reinicia el
  // formulario con el contacto correcto. El open programático del padre no dispara onOpenChange,
  // por eso el sync va en un efecto sobre [open, preset].
  useEffect(() => {
    if (open) {
      resetAndSelect(effectivePreset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, effectivePreset]);

  const handleOpenChange = useCallback((next: boolean) => onOpenChange(next), [onOpenChange]);

  const runSearch = useCallback((term: string) => {
    setSearchTerm(term);
    if (term.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    searchContactsForCallAction(term)
      .then((res) => setSearchResults(res.items))
      .catch(() => setSearchResults([]))
      .finally(() => setSearching(false));
  }, []);

  const isLost = result === CALL_RESULT_LOST;

  const handleSubmit = useCallback(() => {
    if (!selected) {
      toast.error("Elegí un contacto primero.");
      return;
    }
    if (isLost && !lostReason) {
      toast.error("Elegí el motivo de pérdida.");
      return;
    }
    startTransition(async () => {
      const res = await registerCallAttemptAction({
        contactId: selected.contactId,
        result,
        summary: summary.trim() || undefined,
        nextContactAt: nextContact || undefined,
        lostReason: isLost ? lostReason : undefined,
        calledAt: calledAt || undefined,
        completeAttemptId: selected.pendingAttemptId || undefined,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(selected.pendingAttemptId ? "Llamada clasificada" : "Llamada registrada");
      onOpenChange(false);
      router.refresh();
    });
  }, [selected, isLost, lostReason, result, summary, nextContact, calledAt, onOpenChange, router]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {selected?.pendingAttemptId ? "¿Cómo quedó la llamada?" : "Registrar llamada"}
          </DialogTitle>
          <DialogDescription>
            {selected ? selected.name : "Buscá el contacto al que llamaste."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Buscador de contacto (solo cuando no vino de una tarjeta). */}
          {!effectivePreset ? (
            <div className="space-y-2">
              {selected ? (
                <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                  <span className="font-medium">{selected.name}</span>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                    Cambiar
                  </Button>
                </div>
              ) : (
                <div>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchTerm}
                      onChange={(event) => runSearch(event.target.value)}
                      placeholder="Buscar por nombre o teléfono…"
                      className="pl-8"
                    />
                  </div>
                  {searching ? (
                    <p className="mt-1 px-1 text-xs text-muted-foreground">Buscando…</p>
                  ) : null}
                  {searchResults.length > 0 ? (
                    <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-border">
                      {searchResults.map((item) => (
                        <button
                          key={item.contactId}
                          type="button"
                          onClick={() =>
                            setSelected({ contactId: item.contactId, name: item.name, phoneNumber: item.phoneNumber })
                          }
                          className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
                        >
                          <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{item.phoneNumber}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          {/* Resultado (lista fija). */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Resultado</label>
            <NativeSelect value={result} onChange={(event) => setResult(event.target.value)}>
              {CALL_RESULTS.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          {/* Motivo de pérdida (obligatorio solo si Perdido). */}
          {isLost ? (
            <div className="space-y-1">
              <label className="text-xs font-medium text-rose-600">Motivo de pérdida (obligatorio)</label>
              <NativeSelect value={lostReason} onChange={(event) => setLostReason(event.target.value)}>
                {CRM_LOST_REASONS.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          ) : null}

          {/* Resumen breve. */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Resumen (qué dijo)</label>
            <Textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="Ej: pide fotos del combo negro, llamar el lunes."
              rows={2}
            />
          </div>

          {/*
            Al clasificar una llamada que el sistema ya anotó, la fecha no se ofrece: la hora real
            la puso WaCalls cuando la llamada ocurrió y se conserva. Un campo editable que el
            servidor ignora es peor que no tenerlo.
          */}
          <div className={selected?.pendingAttemptId ? "" : "grid grid-cols-2 gap-3"}>
            {/* Próximo contacto. */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Próximo contacto</label>
              <Input type="date" value={nextContact} onChange={(event) => setNextContact(event.target.value)} />
            </div>
            {/* Fecha de la llamada (editable para registro retroactivo). */}
            {selected?.pendingAttemptId ? null : (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Fecha de la llamada</label>
                <Input type="date" value={calledAt} onChange={(event) => setCalledAt(event.target.value)} />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !selected}>
            {isPending ? "Guardando…" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Tarjeta de lead (vista vendedora) ─────────────────────────────────────────────────────────

function LeadCard({ lead, mode, onRegister }: { lead: LlamadaLead; mode: "call" | "whatsapp" | "new" | "pending"; onRegister: (preset: PresetContact) => void }) {
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
          <a href={telLink} aria-label="Llamar">
            <Button variant="outline" size="icon" className="h-8 w-8 text-sky-600">
              <Phone className="h-4 w-4" />
            </Button>
          </a>
        )}
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
          {lead.pendingAttemptId ? "Clasificar" : "Registrar"}
        </Button>
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
}: {
  title: string;
  hint: string;
  leads: LlamadaLead[];
  mode: "call" | "whatsapp" | "new" | "pending";
  onRegister: (preset: PresetContact) => void;
  emptyText: string;
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
            <LeadCard key={lead.contactId} lead={lead} mode={mode} onRegister={onRegister} />
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
}: {
  vendedora: LlamadasVendedoraData;
  owner: LlamadasOwnerData | null;
  canSeeOwner: boolean;
  resumen: ResumenDiaData;
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
          emptyText=""
        />
      ) : null}
      <Section
        title="🔴 Llamar hoy"
        hint="Calientes con contacto para hoy"
        leads={vendedora.llamarHoy}
        mode="call"
        onRegister={openRegister}
        emptyText="Nada urgente para llamar hoy."
      />
      <Section
        title="🟡 WhatsApp hoy"
        hint="Tibios con contacto para hoy"
        leads={vendedora.whatsappHoy}
        mode="whatsapp"
        onRegister={openRegister}
        emptyText="Sin tibios agendados para hoy."
      />
      <Section
        title="⚪ Nuevos sin tocar"
        hint="Máx. 10 sugeridos"
        leads={vendedora.nuevos}
        mode="new"
        onRegister={openRegister}
        emptyText="No hay leads nuevos sin llamar."
      />
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Llamadas</h1>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" /> A quién llamar hoy y qué pasó la última vez.
          </p>
        </div>
        <Button onClick={() => openRegister(null)}>Registrar llamada</Button>
      </div>

      {/* "Resumen" lo ve CUALQUIERA (cada una manda el suyo); "Tablero" solo el dueño. */}
      <Tabs defaultValue="vendedora">
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
