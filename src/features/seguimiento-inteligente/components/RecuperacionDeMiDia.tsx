"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, Mic, Phone, Timer } from "lucide-react";
import { toast } from "sonner";

import { deshacerDescarteDeRecuperacionAction, resolverAprobacionDeRecuperacionAction } from "@/app/actions/recuperacion-actions";
import { Button } from "@/components/ui/button";
import { BotonLlamar } from "@/features/llamadas/components/BotonLlamar";
import { RegisterCallDialog, type PresetContact } from "@/features/llamadas/components/RegisterCallDialog";

/**
 * RECUPERACIÓN 72 H en Mi día (y la aprobación en el Supervisor). Mobile-first: una tarjeta por
 * lead con los pasos Llamar → Audio → Espera 24 h, el botón del paso que toca, "Abrir chat" y el
 * guion. El sistema no le escribe al cliente: la llamada y el audio los hace la asesora.
 */

export type RecuperacionVista = {
  conversationId: string;
  contactId: string;
  channelId: string | null;
  nombre: string;
  telefonoFinal: string | null;
  telefonoParaLlamar: string | null;
  fase: string;
  prioridad: string;
  vence: string | null;
  plazoEn: string | null;
  llamadaEn: string | null;
  audioEn: string | null;
  fuerte: boolean;
  motivoFuerte: string | null;
  producto: string | null;
  mensajeSugerido: string | null;
  asesoraNombre: string | null;
  deNombre: string | null;
  topeEstado: string | null;
};

function hora(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", weekday: "short", hour: "numeric", minute: "2-digit" });
}

function enlaceAlChat(conversationId: string): string {
  return `/cliente/chats?chatKey=${encodeURIComponent(`agent:${conversationId}`)}&assigned=all`;
}

const PASOS = [
  { clave: "llamar", titulo: "Llamar", Icono: Phone },
  { clave: "audio", titulo: "Audio", Icono: Mic },
  { clave: "espera", titulo: "Espera 24 h", Icono: Timer },
] as const;

function Pasos({ fase }: { fase: string }) {
  const actual = fase === "llamar_2" || fase === "aprobacion" ? 3 : PASOS.findIndex((p) => p.clave === fase);
  return (
    <ol className="flex items-center gap-1 text-[11px]">
      {PASOS.map((paso, i) => {
        const hecho = i < actual;
        const ahora = i === actual;
        return (
          <li
            key={paso.clave}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${
              ahora ? "border-primary bg-primary/10 font-semibold text-primary" : hecho ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300" : "border-border text-muted-foreground"
            }`}
          >
            {hecho ? <Check className="h-3 w-3" /> : <paso.Icono className="h-3 w-3" />}
            {i + 1}. {paso.titulo}
          </li>
        );
      })}
    </ol>
  );
}

function Indicacion({ r }: { r: RecuperacionVista }) {
  if (r.fase === "llamar") return <>Último intento: llámalo ahora. Si no contesta, queda anotado solo; si llamas desde tu celular, regístralo.</>;
  if (r.fase === "audio") return <>No contestó{r.llamadaEn ? ` (${hora(r.llamadaEn)})` : ""}. Mándale por el chat un audio corto de 20–30 s con el guion.</>;
  if (r.fase === "llamar_2")
    return <>Intención fuerte: segunda llamada en otra franja. Si no contesta, mándale el mensaje con la cifra. El descarte lo aprueba la supervisora.</>;
  return null;
}

function TarjetaDeRecuperacion({ r, nombreAsesora, puedeMarcar, alRegistrar }: { r: RecuperacionVista; nombreAsesora: string; puedeMarcar: boolean; alRegistrar: (p: PresetContact) => void }) {
  const guion = (r.mensajeSugerido ?? "").replace("[tu nombre]", nombreAsesora);
  const tel = r.telefonoParaLlamar ? `tel:${r.telefonoParaLlamar.replace(/[^0-9+]/g, "")}` : null;
  return (
    <li className="space-y-2 rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span
              className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${r.prioridad === "A" ? "bg-red-500/15 text-red-700 dark:text-red-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}
            >
              {r.prioridad}
            </span>
            <span className="font-medium text-foreground">{r.nombre}</span>
            {r.telefonoFinal ? <span className="text-muted-foreground"> · •••• {r.telefonoFinal}</span> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {r.producto ?? "Producto sin definir"}
            {r.fuerte ? ` · intención fuerte${r.motivoFuerte ? ` (${r.motivoFuerte})` : ""}` : ""}
            {r.vence ? ` · desde ${hora(r.vence)}` : ""}
          </p>
        </div>
      </div>
      <Pasos fase={r.fase} />
      <p className="text-xs text-foreground/80">
        <Indicacion r={r} />
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {r.fase === "llamar" || r.fase === "llamar_2" ? (
          puedeMarcar ? (
            <BotonLlamar telefono={r.telefonoParaLlamar} nombre={r.nombre} channelId={r.channelId} />
          ) : tel ? (
            <a href={tel} aria-label="Llamar">
              <Button variant="outline" size="sm" className="h-8 gap-1 text-sky-600">
                <Phone className="h-4 w-4" /> Llamar
              </Button>
            </a>
          ) : null
        ) : null}
        {r.fase === "llamar" || r.fase === "llamar_2" ? (
          <Button variant="outline" size="sm" className="h-8" onClick={() => alRegistrar({ contactId: r.contactId, name: r.nombre, phoneNumber: r.telefonoParaLlamar ?? undefined })}>
            Registrar llamada
          </Button>
        ) : null}
        <Link href={enlaceAlChat(r.conversationId)} className="inline-flex h-8 items-center rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition hover:bg-muted">
          Abrir chat
        </Link>
      </div>
      {guion ? (
        <details className="text-xs" open={r.fase === "audio"}>
          <summary className="cursor-pointer font-medium text-primary">{r.fase === "llamar_2" ? "Mensaje con la cifra" : "Guion del audio (20–30 s)"}</summary>
          <p className="mt-1 whitespace-pre-wrap rounded bg-muted/50 px-2 py-1.5 text-foreground">{guion}</p>
        </details>
      ) : null}
    </li>
  );
}

export function RecuperacionDeMiDia({
  tareas,
  enEspera,
  nombreAsesora,
  puedeMarcar,
}: {
  tareas: RecuperacionVista[];
  enEspera: RecuperacionVista[];
  nombreAsesora: string;
  puedeMarcar: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [preset, setPreset] = useState<PresetContact | null>(null);
  if (!tareas.length && !enEspera.length) return null;
  return (
    <details open className="rounded-xl border border-border bg-card px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-foreground">
        🔁 Recuperación 72 h · último intento ({tareas.length}
        {enEspera.length ? ` · ${enEspera.length} en espera` : ""})
      </summary>
      <div className="space-y-3 pt-3">
        {tareas.length ? (
          <ul className="space-y-2">
            {tareas.map((r) => (
              <TarjetaDeRecuperacion
                key={r.conversationId}
                r={r}
                nombreAsesora={nombreAsesora}
                puedeMarcar={puedeMarcar}
                alRegistrar={(p) => {
                  setPreset(p);
                  setAbierto(true);
                }}
              />
            ))}
          </ul>
        ) : null}
        {enEspera.length ? (
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Esperando respuesta</p>
            <ul className="space-y-1">
              {enEspera.map((r) => (
                <li key={r.conversationId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-xs">
                  <span>
                    <span className="font-medium text-foreground">{r.nombre}</span>
                    {r.telefonoFinal ? <span className="text-muted-foreground"> · •••• {r.telefonoFinal}</span> : null}
                    <span className="text-muted-foreground">
                      {" "}
                      · hasta {hora(r.plazoEn)}
                      {r.fuerte ? " · luego segunda llamada" : " · si no responde: Descartado — Sin respuesta"}
                    </span>
                  </span>
                  <Link href={enlaceAlChat(r.conversationId)} className="font-medium text-primary hover:underline">
                    Abrir chat
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <RegisterCallDialog open={abierto} onOpenChange={setAbierto} preset={preset} />
    </details>
  );
}

/** Intención fuerte: la supervisora aprueba (o no) el descarte. */
export function AprobacionesDeRecuperacion({ pendientes }: { pendientes: RecuperacionVista[] }) {
  const [hechas, setHechas] = useState<string[]>([]);
  const [pendiente, startTransition] = useTransition();
  const visibles = pendientes.filter((r) => !hechas.includes(r.conversationId));
  if (!visibles.length) return <p className="text-xs text-muted-foreground">Nada para aprobar.</p>;
  const resolver = (r: RecuperacionVista, aprobar: boolean) =>
    startTransition(async () => {
      const respuesta = await resolverAprobacionDeRecuperacionAction(r.conversationId, aprobar);
      if (respuesta.ok) {
        setHechas((h) => [...h, r.conversationId]);
        toast.success(aprobar ? "Descartado — Sin respuesta" : "Queda abierto");
      } else toast.error(respuesta.error);
    });
  return (
    <ul className="space-y-2">
      {visibles.map((r) => (
        <li key={r.conversationId} className="space-y-1.5 rounded-md border border-border bg-background/60 px-3 py-2">
          <p className="text-sm">
            <span className="mr-2 rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-300">A</span>
            <span className="font-medium text-foreground">{r.nombre}</span>
            {r.telefonoFinal ? <span className="text-muted-foreground"> · •••• {r.telefonoFinal}</span> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {r.motivoFuerte ?? "intención fuerte"} · {r.asesoraNombre ?? "sin asesora"} · llamada {hora(r.llamadaEn) || "—"} · audio {hora(r.audioEn) || "—"}
            {r.fase === "llamar_2" ? " · falta la segunda llamada" : " · segunda llamada hecha"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="destructive" className="h-8" disabled={pendiente} onClick={() => resolver(r, true)}>
              Aprobar descarte
            </Button>
            <Button size="sm" variant="outline" className="h-8" disabled={pendiente} onClick={() => resolver(r, false)}>
              No descartar
            </Button>
            <Link href={enlaceAlChat(r.conversationId)} className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted">
              Abrir chat
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DeshacerDescarte({ conversationId }: { conversationId: string }) {
  const [hecho, setHecho] = useState(false);
  const [pendiente, startTransition] = useTransition();
  if (hecho) return <span className="text-xs text-emerald-700 dark:text-emerald-300">Deshecho</span>;
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-xs"
      disabled={pendiente}
      onClick={() =>
        startTransition(async () => {
          const r = await deshacerDescarteDeRecuperacionAction(conversationId);
          if (r.ok) setHecho(true);
          else toast.error(r.error);
        })
      }
    >
      Deshacer
    </Button>
  );
}
