"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CalendarCheck, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useCadaTantoVisible } from "@/hooks/use-cada-tanto-visible";
import { resumenDeHoyAction, type ResumenDeHoyVista } from "@/app/actions/tableros-inteligentes-actions";

/*
  Caja "Resumen de hoy" de la página de inicio de Tablero IA (solo quien administra): el mismo texto corto
  del día (services/resumen-diario.ts), visto hasta ahora. Ya no se manda por WhatsApp (26-oct-2026): el dueño
  solo recibe avisos cuando Sistemas se detiene o lo necesita. El detalle de cada tarjeta está en la pestaña
  "Hoy". Se lee al mostrarse, se refresca cada minuto (solo con la pestaña a la vista) y con el botón.
*/

const REFRESCO_MS = 60_000;

export function ResumenDelDia() {
  const [resumen, setResumen] = useState<ResumenDeHoyVista | null>(null);
  const [ocupado, empezar] = useTransition();

  const cargar = useCallback(async (avisar: boolean) => {
    const respuesta = await resumenDeHoyAction();
    if (respuesta.ok) setResumen(respuesta.resumen);
    else if (avisar) toast.error(respuesta.error);
  }, []);

  // Evita escribir el estado si la respuesta llega cuando la caja ya no está en pantalla.
  const vigente = useRef(true);
  const leer = useCallback(
    (avisar: boolean) =>
      void resumenDeHoyAction().then((respuesta) => {
        if (!vigente.current) return;
        if (respuesta.ok) setResumen(respuesta.resumen);
        else if (avisar) toast.error(respuesta.error);
      }),
    [],
  );

  useEffect(() => {
    vigente.current = true;
    leer(true);
    return () => {
      vigente.current = false;
    };
  }, [leer]);

  // Con la pestaña oculta no se pide nada; al volver, una lectura si ya tocaba.
  useCadaTantoVisible(() => leer(false), REFRESCO_MS);

  const lineas = resumen?.texto ? resumen.texto.split("\n") : [];

  return (
    <section aria-labelledby="titulo-resumen-hoy" className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="titulo-resumen-hoy" className="flex items-center gap-2 text-base font-semibold">
            <CalendarCheck className="size-5 text-muted-foreground" aria-hidden />
            Resumen de hoy
          </h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={ocupado}
          onClick={() => empezar(async () => void (await cargar(true)))}
          aria-label="Actualizar el resumen de hoy"
        >
          {ocupado ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Actualizar
        </Button>
      </div>

      {!resumen ? <Loader2 className="mx-auto animate-spin text-muted-foreground" aria-label="Cargando" /> : null}

      {resumen ? (
        <div className="space-y-2 rounded-xl border bg-card p-4 text-sm">
          {lineas.length ? (
            lineas.map((linea, indice) => <p key={indice}>{linea}</p>)
          ) : (
            <p className="text-muted-foreground">Hoy no hubo movimiento.</p>
          )}
          <p className="border-t pt-2 text-xs text-muted-foreground">Este resumen ya no llega por WhatsApp: se ve aquí.</p>
        </div>
      ) : null}
    </section>
  );
}
