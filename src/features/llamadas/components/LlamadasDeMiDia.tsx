"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, MessageCircle } from "lucide-react";

import { ContactAvatar } from "@/components/chats/contact-avatar";
import { Button } from "@/components/ui/button";
import { getCrmStageMeta } from "@/features/crm/domain/crm-config";
import type { CrmStage } from "@/features/crm/types";
import { claimLeadOnOpenAction } from "@/app/actions/crm-actions";
import type { LlamadaLead, LlamadasVendedoraData } from "@/features/llamadas/services/getLlamadasData";
import { BotonLlamar } from "@/features/llamadas/components/BotonLlamar";
import { RegisterCallDialog, type PresetContact } from "@/features/llamadas/components/RegisterCallDialog";

/*
  Las listas de llamadas del dia, aparte para poder usarlas en "Mi dia" (Alex, 15-sep-2026).

  Antes vivian dentro de la pantalla de Llamadas, en su propia pestaña "Mi dia", y la asesora tenia
  DOS "Mi dia": el del CRM (a quien contactar y a quien responder) y este (a quien llamar). Saltaba
  de uno a otro y lo que estaba en el que no miraba se le pasaba.
*/

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

/**
 * Las llamadas del dia dentro de "Mi dia".
 *
 * `momento`:
 *  - "urgente": lo que ya paso y hay que cerrar (clasificar la llamada) y lo agendado para hoy.
 *  - "despues": lo que conviene hacer si queda tiempo (tibios agendados y leads nuevos sin tocar).
 * Partido en dos para poder meter en el medio la lista de chats del CRM, que es lo mas urgente.
 */
export function LlamadasDeMiDia({
  vendedora,
  marcadorUrl,
  momento,
}: {
  vendedora: LlamadasVendedoraData;
  marcadorUrl: string | null;
  momento: "urgente" | "despues";
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [preset, setPreset] = useState<PresetContact | null>(null);

  const openRegister = useCallback((next: PresetContact | null) => {
    setPreset(next);
    setDialogOpen(true);
  }, []);

  const puedeMarcarEnLaApp = Boolean(marcadorUrl);

  return (
    <div className="space-y-5">
      {momento === "urgente" ? (
        <>
          {/* Solo si hay algo: una seccion vacia permanente arriba de todo entrena a saltearla. */}
          {vendedora.sinRegistrar.length > 0 ? (
            <Section
              title="📞 Sin registrar"
              hint="Ya hablaste, falta decir cómo quedó"
              leads={vendedora.sinRegistrar}
              mode="pending"
              onRegister={openRegister}
              puedeMarcarEnLaApp={puedeMarcarEnLaApp}
              emptyText=""
            />
          ) : null}
          {vendedora.llamarHoy.length > 0 ? (
            <Section
              title="🔴 Llamar hoy"
              hint="Calientes con contacto para hoy"
              leads={vendedora.llamarHoy}
              mode="call"
              onRegister={openRegister}
              puedeMarcarEnLaApp={puedeMarcarEnLaApp}
              emptyText=""
            />
          ) : null}
        </>
      ) : (
        <>
          {vendedora.whatsappHoy.length > 0 ? (
            <Section
              title="🟡 WhatsApp hoy"
              hint="Tibios con contacto para hoy"
              leads={vendedora.whatsappHoy}
              mode="whatsapp"
              onRegister={openRegister}
              puedeMarcarEnLaApp={puedeMarcarEnLaApp}
              emptyText=""
            />
          ) : null}
          <Section
            title="⚪ Nuevos sin tocar"
            hint="Máx. 10 sugeridos"
            leads={vendedora.nuevos}
            mode="new"
            onRegister={openRegister}
            puedeMarcarEnLaApp={puedeMarcarEnLaApp}
            emptyText="No hay leads nuevos sin llamar."
          />
        </>
      )}

      <RegisterCallDialog open={dialogOpen} onOpenChange={setDialogOpen} preset={preset} />
    </div>
  );
}
