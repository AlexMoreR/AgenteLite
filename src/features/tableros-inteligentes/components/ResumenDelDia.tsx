"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { CalendarCheck, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { resumenDeHoyAction, type ResumenDeHoyVista } from "@/app/actions/tableros-inteligentes-actions";

/*
  Caja "Resumen de hoy" de la página de inicio de Tablero IA (solo quien administra): lo que pasó hoy
  (services/resumen-diario.ts; ya no sale por WhatsApp), visto hasta ahora: lo que se aprobó solo y
  por qué, lo que subió a producción (con el link del commit) y lo que falló. Se lee al mostrarse, se
  refresca cada minuto y con el botón.
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

  useEffect(() => {
    let vigente = true;
    const leer = (avisar: boolean) =>
      void resumenDeHoyAction().then((respuesta) => {
        if (!vigente) return;
        if (respuesta.ok) setResumen(respuesta.resumen);
        else if (avisar) toast.error(respuesta.error);
      });
    leer(true);
    const reloj = setInterval(() => leer(false), REFRESCO_MS);
    return () => {
      vigente = false;
      clearInterval(reloj);
    };
  }, []);

  const datos = resumen?.resumen;
  const sinMovimiento = datos ? !datos.aprobadas.length && !datos.subidas.length && !datos.fallas.length : false;

  return (
    <section aria-labelledby="titulo-resumen-hoy" className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="titulo-resumen-hoy" className="flex items-center gap-2 text-base font-semibold">
            <CalendarCheck className="size-5 text-muted-foreground" aria-hidden />
            Resumen de hoy
          </h2>
          <p className="text-sm text-muted-foreground">Lo que hizo el Coordinador hoy: lo aprobado solo, lo subido y lo que falló.</p>
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

      {resumen && datos ? (
        <div className="space-y-3 rounded-xl border bg-card p-4 text-sm">
          {sinMovimiento ? <p className="text-muted-foreground">Hoy no hubo movimiento.</p> : null}

          {datos.aprobadas.length ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Aprobadas solas ({datos.aprobadas.length})</p>
              <ul className="space-y-1">
                {datos.aprobadas.map((item, indice) => (
                  <li key={`${item.tarjetaId}-${indice}`} className="rounded-lg border px-3 py-2">
                    <p className="font-medium">{item.titulo}</p>
                    {item.motivo ? <p className="text-xs text-muted-foreground">{item.motivo}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {datos.subidas.length ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Subidas a producción ({datos.subidas.length})</p>
              <ul className="space-y-1">
                {datos.subidas.map((item, indice) => (
                  <li key={`${item.tarjetaId}-${indice}`} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                    <span className="min-w-0 font-medium">{item.titulo}</span>
                    {item.linkCommit ? (
                      <a
                        href={item.linkCommit}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex shrink-0 items-center gap-1 text-xs underline"
                      >
                        <ExternalLink className="size-3.5" />
                        {item.commit ? `commit ${item.commit.slice(0, 10)}` : "ver commit"}
                      </a>
                    ) : item.commit ? (
                      <span className="shrink-0 text-xs text-muted-foreground">commit {item.commit.slice(0, 10)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {datos.fallas.length ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Fallas ({datos.fallas.length})</p>
              <ul className="space-y-1">
                {datos.fallas.map((item, indice) => (
                  <li
                    key={`${item.tarjetaId}-${indice}`}
                    className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100"
                  >
                    <p className="font-medium">{item.titulo}</p>
                    <p className="line-clamp-3 whitespace-pre-wrap text-xs">{item.motivo}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="border-t pt-2 text-xs text-muted-foreground">Ya no sale por WhatsApp: aquí lo ves cuando quieras. Solo te avisa por WhatsApp si Sistemas se detiene o te necesita.</p>
        </div>
      ) : null}
    </section>
  );
}
