"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";

import { detalleDeLlamadaAction, type DetalleDeLlamada } from "@/app/actions/call-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RegisterCallDialog } from "@/features/llamadas/components/RegisterCallDialog";

const FECHA_Y_HORA = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
});
const FECHA = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long" });

type Estado = { messageId: string; detalle: DetalleDeLlamada | null; error: string | null };

/**
 * Lo que paso en una llamada, abierto desde su burbuja en el chat (Alex, 15-sep-2026).
 *
 * Orden pedido: como quedo con su fecha y el proximo contacto si lo hubo; abajo la grabacion y el
 * texto de la llamada. Si nadie la clasifico, se puede hacer desde aca.
 */
export function DetalleDeLlamadaDialog({
  messageId,
  alCerrar,
}: {
  messageId: string | null;
  alCerrar: () => void;
}) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [clasificando, setClasificando] = useState(false);
  const [version, setVersion] = useState(0);
  const cargando = Boolean(messageId) && estado?.messageId !== `${messageId}#${version}`;

  useEffect(() => {
    if (!messageId) {
      return;
    }
    let vigente = true;
    const clave = `${messageId}#${version}`;
    detalleDeLlamadaAction(messageId)
      .then((respuesta) => {
        if (!vigente) return;
        setEstado(
          "error" in respuesta
            ? { messageId: clave, detalle: null, error: respuesta.error }
            : { messageId: clave, detalle: respuesta.detalle, error: null },
        );
      })
      .catch(() => {
        if (vigente) setEstado({ messageId: clave, detalle: null, error: "No se pudo cargar la llamada" });
      });
    return () => {
      vigente = false;
    };
  }, [messageId, version]);

  const detalle = !cargando ? estado?.detalle ?? null : null;

  return (
    <>
      <Dialog open={Boolean(messageId) && !clasificando} onOpenChange={(abierto) => (abierto ? null : alCerrar())}>
        <DialogContent className="flex max-h-[88vh] flex-col gap-3 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{detalle ? `Llamada con ${detalle.cliente}` : "Llamada"}</DialogTitle>
            <DialogDescription>
              {detalle
                ? `${FECHA_Y_HORA.format(new Date(detalle.calledAt))} · intento ${detalle.intento}${detalle.asesora ? ` · ${detalle.asesora}` : ""}`
                : " "}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-24 flex-1 space-y-3 overflow-y-auto">
            {cargando ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Cargando…
              </div>
            ) : !detalle ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{estado?.error ?? "No se encontró la llamada"}</p>
            ) : (
              <>
                <div className="space-y-1.5 rounded-lg border border-border px-3 py-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Cómo quedó</p>
                  {detalle.pendiente ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-amber-600">Todavía nadie dijo cómo quedó</p>
                      <Button type="button" size="sm" onClick={() => setClasificando(true)}>
                        ¿Cómo quedó?
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm font-medium text-foreground">{detalle.resultado}</p>
                  )}
                  {detalle.como ? <p className="text-xs text-muted-foreground">{detalle.como}</p> : null}
                  {detalle.motivoPerdida ? (
                    <p className="text-xs text-muted-foreground">Motivo: {detalle.motivoPerdida}</p>
                  ) : null}
                  {detalle.resumen ? <p className="whitespace-pre-wrap text-sm text-foreground/90">{detalle.resumen}</p> : null}
                  {detalle.proximoContacto ? (
                    <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--primary)]">
                      <CalendarClock className="size-3.5" />
                      Próximo contacto: {FECHA.format(new Date(detalle.proximoContacto))}
                    </p>
                  ) : null}
                </div>

                {detalle.grabacion ? (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Grabación</p>
                    <audio controls preload="none" src={detalle.grabacion} className="h-9 w-full" />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Esta llamada no tiene grabación.</p>
                )}

                {detalle.resumenIa || detalle.transcripcion ? (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Texto de la llamada</p>
                    {detalle.resumenIa ? (
                      <p className="text-sm text-foreground/90">
                        <span className="font-medium">Resumen IA:</span> {detalle.resumenIa}
                      </p>
                    ) : null}
                    {detalle.transcripcion ? (
                      <p className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 px-3 py-2 text-[13px] leading-5 text-muted-foreground">
                        {detalle.transcripcion}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {detalle ? (
        <RegisterCallDialog
          open={clasificando}
          onOpenChange={setClasificando}
          preset={{ contactId: detalle.contactId, name: detalle.cliente, pendingAttemptId: detalle.id }}
          alGuardar={() => setVersion((valor) => valor + 1)}
        />
      ) : null}
    </>
  );
}
