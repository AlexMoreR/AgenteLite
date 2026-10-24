"use client";

import { useEffect, useState } from "react";

import { intentosDeTarjetaAction } from "@/app/actions/tableros-inteligentes-actions";
import type { IntentoVista } from "../services/tableros";

const CUANDO = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

/** Lo que hizo el Coordinador después de la falla, en palabras sencillas. */
const QUE_HIZO: Record<string, string> = {
  reparar: "Reparar lo que falló",
  partir: "Partir la tarea en partes",
  esperar: "Esperar",
  escalar: "Pedir ayuda al dueño",
};

const ETAPA: Record<string, string> = {
  planear: "Planear",
  construir: "Construir",
  subir: "Subir",
};

/**
 * El historial de intentos de una tarjeta: número, hora, etapa, causa y qué hizo el Coordinador. Las esperas
 * por el límite de uso de Claude salen marcadas "no cuenta". Cada intento deja abrir el error exacto.
 * Se vuelve a leer cuando la tarjeta cambia (`version` es su `actualizadoEn`).
 */
export function IntentosDeLaTarjeta({ tarjetaId, version }: { tarjetaId: string; version: string }) {
  const [lectura, setLectura] = useState<{ clave: string; intentos: IntentoVista[] | null } | null>(null);
  const clave = `${tarjetaId}|${version}`;

  useEffect(() => {
    let vigente = true;
    void intentosDeTarjetaAction(tarjetaId).then((respuesta) => {
      if (vigente) setLectura({ clave, intentos: respuesta.ok ? respuesta.intentos : null });
    });
    return () => {
      vigente = false;
    };
  }, [tarjetaId, clave]);

  const intentos = lectura?.clave === clave ? lectura.intentos : null;
  if (!intentos || intentos.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">Intentos</p>
      <ol className="space-y-1.5">
        {intentos.map((intento) => (
          <li key={`${intento.numero}-${intento.cuando}`} className="rounded-lg border px-3 py-2 text-xs">
            <div className="flex flex-wrap justify-between gap-x-2">
              <span className="font-medium">
                Intento {intento.numero} · {ETAPA[intento.etapa] ?? intento.etapa}
                {intento.cuentaComoIntento ? "" : " · no cuenta"}
              </span>
              <span className="text-muted-foreground">{CUANDO.format(new Date(intento.cuando))}</span>
            </div>
            <p className="mt-0.5">{intento.causa}</p>
            <p className="text-muted-foreground">Qué hizo el Coordinador: {QUE_HIZO[intento.accion] ?? intento.accion}</p>
            {intento.error ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-muted-foreground">Ver el error exacto</summary>
                <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded border bg-muted/40 px-2 py-1 font-mono">
                  {intento.error}
                </p>
              </details>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
