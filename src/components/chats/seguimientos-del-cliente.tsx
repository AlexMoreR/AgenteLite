"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { FileText, Film, Loader2, Mic, Workflow } from "lucide-react";
import { toast } from "sonner";
import { cancelarSeguimientoDelChatAction } from "@/app/actions/follow-actions";
import { rutaParaMostrar } from "@/components/chats/biblioteca-guardada";
import { formatoBogota } from "@/features/seguimientos/dominio/fecha-exacta";
import type { PiezaDelSeguimiento, SeguimientoDelCliente } from "@/features/seguimientos/dominio/seguimientos-del-cliente";

/*
  "VER SEGUIMIENTOS" de la ventana de Agendar (Alex, 11-nov-2026: "ver los seguimientos de ese
  cliente"). Los de este cliente: los pendientes arriba (el más próximo primero), con lo que lleva
  cada uno y un botón para cancelar los pendientes. Los automáticos también se ven, para que la
  asesora sepa qué le va a llegar al cliente aunque no lo haya agendado ella.
*/

const ESTILO_DEL_ESTADO: Record<SeguimientoDelCliente["estado"], { texto: string; clase: string }> = {
  PENDIENTE: { texto: "Pendiente", clase: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  ENVIADO: { texto: "Enviado", clase: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
  CANCELADO: { texto: "Cancelado", clase: "bg-muted text-muted-foreground" },
};

function Pieza({ pieza }: { pieza: PiezaDelSeguimiento }) {
  const url = rutaParaMostrar(pieza.url);
  if (pieza.tipo === "IMAGE" && url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" loading="lazy" className="size-14 shrink-0 rounded-lg bg-muted object-cover" />
    );
  }
  const Icono = pieza.tipo === "AUDIO" ? Mic : pieza.tipo === "VIDEO" ? Film : pieza.tipo === "FLUJO" ? Workflow : FileText;
  const nombre = pieza.tipo === "AUDIO" ? "Audio" : pieza.tipo === "VIDEO" ? "Video" : pieza.tipo === "FLUJO" ? "Flujo" : "PDF";
  return (
    <span className="inline-flex h-14 shrink-0 items-center gap-1.5 rounded-lg bg-muted px-2.5 text-[12px] text-muted-foreground">
      <Icono className="size-4" />
      {nombre}
    </span>
  );
}

function Tarjeta({ seguimiento, alCancelar }: { seguimiento: SeguimientoDelCliente; alCancelar: (id: string) => void }) {
  const [confirmando, setConfirmando] = useState(false);
  const [cancelando, startTransition] = useTransition();
  const estilo = ESTILO_DEL_ESTADO[seguimiento.estado];
  const texto = seguimiento.piezas.map((pieza) => pieza.texto).find(Boolean) ?? null;
  const adjuntos = seguimiento.piezas.filter((pieza) => pieza.tipo !== "TEXT");

  const cancelar = () =>
    startTransition(async () => {
      const resultado = await cancelarSeguimientoDelChatAction(seguimiento.id);
      if ("error" in resultado) {
        toast.error(resultado.error);
        setConfirmando(false);
        return;
      }
      toast.success("Seguimiento cancelado");
      alCancelar(seguimiento.id);
    });

  return (
    <li className="min-w-0 space-y-1.5 rounded-xl border border-border bg-card p-2.5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[13px] font-medium text-foreground">{formatoBogota(new Date(seguimiento.cuando))}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${estilo.clase}`}>{estilo.texto}</span>
      </div>
      <p className="truncate text-[12px] text-muted-foreground">{seguimiento.origen}</p>
      {texto ? <p className="line-clamp-3 whitespace-pre-wrap break-words text-[13px] text-foreground">{texto}</p> : null}
      {adjuntos.length ? (
        <div className="flex min-w-0 gap-1.5 overflow-x-auto">
          {adjuntos.map((pieza, indice) => (
            <Pieza key={`${pieza.tipo}-${indice}`} pieza={pieza} />
          ))}
        </div>
      ) : null}
      {seguimiento.motivo ? <p className="truncate text-[12px] text-muted-foreground">{seguimiento.motivo}</p> : null}
      {seguimiento.estado === "PENDIENTE" ? (
        <div className="flex justify-end gap-1.5 pt-0.5">
          {confirmando ? (
            <>
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                disabled={cancelando}
                className="rounded-full px-3 py-1 text-[12px] text-muted-foreground hover:bg-muted"
              >
                No
              </button>
              <button
                type="button"
                onClick={cancelar}
                disabled={cancelando}
                className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-3 py-1 text-[12px] font-medium text-destructive"
              >
                {cancelando ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Sí, cancelarlo
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              className="rounded-full border border-border px-3 py-1 text-[12px] text-foreground hover:bg-muted"
            >
              Cancelar
            </button>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function SeguimientosDelCliente({ contactId }: { contactId: string | null }) {
  const [lista, setLista] = useState<SeguimientoDelCliente[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!contactId) return;
    try {
      const respuesta = await fetch(`/api/cliente/chats/seguimientos?contactId=${encodeURIComponent(contactId)}`, { cache: "no-store" });
      const datos = (await respuesta.json().catch(() => null)) as { ok?: boolean; seguimientos?: SeguimientoDelCliente[]; error?: string } | null;
      if (!respuesta.ok || !datos?.ok || !Array.isArray(datos.seguimientos)) {
        setError(datos?.error || "No se pudieron cargar los seguimientos.");
        return;
      }
      setError(null);
      setLista(datos.seguimientos);
    } catch {
      setError("No se pudieron cargar los seguimientos. Revisa la conexión.");
    }
  }, [contactId]);

  useEffect(() => {
    // La carga escribe el estado recién cuando responde el servidor (nunca de inmediato).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  if (!contactId) {
    return <p className="rounded-xl bg-muted p-3 text-[13px] text-muted-foreground">No se pudo identificar el contacto.</p>;
  }
  if (error) {
    return (
      <div className="space-y-2 rounded-xl bg-muted p-3 text-[13px] text-muted-foreground">
        <p>{error}</p>
        <button type="button" onClick={() => void cargar()} className="font-medium text-primary">
          Reintentar
        </button>
      </div>
    );
  }
  if (!lista) {
    return (
      <p className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Cargando…
      </p>
    );
  }
  if (!lista.length) {
    return <p className="rounded-xl bg-muted p-3 text-[13px] text-muted-foreground">Este cliente no tiene seguimientos.</p>;
  }
  const pendientes = lista.filter((seguimiento) => seguimiento.estado === "PENDIENTE").length;
  return (
    <div className="min-w-0 space-y-2">
      <p className="text-[12px] text-muted-foreground">
        {pendientes === 1 ? "1 pendiente" : `${pendientes} pendientes`} · {lista.length} en total
      </p>
      <ul className="min-w-0 space-y-2">
        {lista.map((seguimiento) => (
          <Tarjeta
            key={seguimiento.id}
            seguimiento={seguimiento}
            alCancelar={(id) =>
              setLista((actual) =>
                (actual ?? []).map((item) => (item.id === id ? { ...item, estado: "CANCELADO", motivo: "Cancelado desde el chat" } : item)),
              )
            }
          />
        ))}
      </ul>
    </div>
  );
}
