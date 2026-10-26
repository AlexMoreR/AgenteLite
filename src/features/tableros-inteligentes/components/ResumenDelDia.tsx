"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { CalendarCheck, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { resumenDeHoyAction, type ResumenDeHoyVista } from "@/app/actions/tableros-inteligentes-actions";

/*
  Caja "Resumen de hoy" de la página de inicio de Tablero IA (solo quien administra): lo mismo que sale
  por WhatsApp a las 8:55 p. m. (services/resumen-diario.ts), visto hasta ahora: dos líneas con cuántas
  quedaron listas, cuántas con problema y cuántas esperan el sí del dueño, y el link a la vista "Hoy". Se lee
  al mostrarse, se refresca cada minuto y con el botón.
*/

const HORA = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit", hour12: true });
const REFRESCO_MS = 60_000;
const HORA_DEL_ENVIO = 20;
const MINUTO_DEL_ENVIO = 55;

/** Minutos desde la medianoche de Bogotá. */
const minutosDeBogota = (ahora: Date) => {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: "America/Bogota", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(ahora);
  const numero = (tipo: string) => Number(partes.find((parte) => parte.type === tipo)?.value ?? 0);
  return (numero("hour") % 24) * 60 + numero("minute");
};

function lineaDelWhatsApp(resumen: ResumenDeHoyVista): string {
  const envio = resumen.envioDeHoy;
  if (envio?.enviado) return `Enviado por WhatsApp a las ${HORA.format(new Date(envio.cuando))}`;
  if (envio?.motivo) return `No salió por WhatsApp: ${envio.motivo}`;
  if (minutosDeBogota(new Date()) < HORA_DEL_ENVIO * 60 + MINUTO_DEL_ENVIO) return "Sale hoy a las 8:55 p. m. por WhatsApp (si hay algo que contar)";
  return "Todavía no salió por WhatsApp.";
}

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

  return (
    <section aria-labelledby="titulo-resumen-hoy" className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="titulo-resumen-hoy" className="flex items-center gap-2 text-base font-semibold">
            <CalendarCheck className="size-5 text-muted-foreground" aria-hidden />
            Resumen de hoy
          </h2>
          <p className="text-sm text-muted-foreground">Lo mismo que te llega por WhatsApp, en dos líneas.</p>
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
        <div className="space-y-3 rounded-xl border bg-card p-4 text-sm">
          <div className="space-y-1">
            {resumen.texto.split("\n").map((linea) =>
              linea.startsWith("Ver: ") ? (
                <p key={linea}>
                  Ver:{" "}
                  <a href={linea.slice(5)} className="underline">
                    abrir el tablero de hoy
                  </a>
                </p>
              ) : (
                <p key={linea} className={linea.startsWith("Hoy no") ? "text-muted-foreground" : "font-medium"}>
                  {linea}
                </p>
              ),
            )}
          </div>
          <p className="border-t pt-2 text-xs text-muted-foreground">{lineaDelWhatsApp(resumen)}</p>
        </div>
      ) : null}
    </section>
  );
}
