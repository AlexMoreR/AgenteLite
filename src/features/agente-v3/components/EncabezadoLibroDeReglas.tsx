"use client";

import { CircleHelp } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Encabezado del Libro de reglas: el título y, al lado, un (?) con la explicación.
 *
 * La explicación vivía como párrafo fijo debajo del título; Alex pidió despejar la vista
 * (11-oct-2026) y dejarla a un toque. El popover de Radix cierra al tocar fuera o con Esc,
 * así que sirve igual en el celular.
 */

const CUANDO = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

const AYUDA = [
  "Es lo que el agente hace con cada mensaje, escrito como reglas. Acá solo se mira.",
  "Las reglas van en orden de prioridad: la de más arriba manda primero.",
  "Los cambios se hacen hablando con Claude.",
  "Antes de dejarlos, se pueden probar en el simulador.",
  "Atiende a todos los clientes de las líneas donde está prendido.",
];

export function EncabezadoLibroDeReglas({ version, actualizadoEl }: { version: number; actualizadoEl: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-0.5">
        <h1 className="text-lg font-semibold text-foreground">Agente V3 · Libro de reglas</h1>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="¿Qué es el Libro de reglas?"
              className="-my-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:text-foreground"
            >
              <CircleHelp className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            collisionPadding={16}
            className="w-[min(20rem,calc(100vw-2rem))] border-border bg-popover text-popover-foreground"
          >
            <p className="text-sm font-semibold text-foreground">¿Qué es el Libro de reglas?</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px] leading-5 text-muted-foreground">
              {AYUDA.map((linea) => (
                <li key={linea}>{linea}</li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      </div>
      <p className="text-[12px] text-muted-foreground">
        Versión {version} · {actualizadoEl.startsWith("1970") ? "sin cambios todavía" : `última edición ${CUANDO.format(new Date(actualizadoEl))}`}
      </p>
    </div>
  );
}
