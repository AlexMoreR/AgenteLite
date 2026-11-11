"use client";

import { useEffect, useState, type ReactNode } from "react";

import { leerListaDelCelular } from "./guardado-local/lista-guardada";
import type { FilaGuardada } from "./guardado-local/reglas";

/*
  Las filas de la bandeja guardadas en el celular, mientras carga la pantalla de Chats (P5, T4).

  Se leen en un efecto (no en el render) para no chocar con lo que manda el servidor. Son de SOLO
  LECTURA: sin enlaces ni toques (aria-busy), con la misma forma que las siluetas. Sin lista guardada
  (otro dueño, apagado, mas de 24 h) se quedan las siluetas de siempre. Cuando llega la pantalla real,
  esta se va entera.
*/

function hora(iso: string | null) {
  if (!iso) return "";
  const fecha = new Date(iso);
  if (!Number.isFinite(fecha.getTime())) return "";
  const hoy = new Date();
  const mismoDia =
    fecha.getFullYear() === hoy.getFullYear() && fecha.getMonth() === hoy.getMonth() && fecha.getDate() === hoy.getDate();
  return mismoDia
    ? fecha.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : fecha.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

function inicial(fila: FilaGuardada) {
  const nombre = (fila.label || fila.secondaryLabel || "").trim();
  return nombre ? nombre.charAt(0).toUpperCase() : "·";
}

export function ListaDesdeGuardado({ fallback }: { fallback: ReactNode }) {
  const [filas, setFilas] = useState<FilaGuardada[] | null>(null);

  useEffect(() => {
    try {
      if (typeof performance !== "undefined") performance.mark("lista-guardada:leer");
      const lista = leerListaDelCelular();
      if (lista) {
        // A proposito en el efecto y no en el render: el servidor no tiene el guardado del celular.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFilas(lista.filas);
        if (typeof performance !== "undefined") performance.mark("lista-guardada:pintada");
      }
    } catch {
      // Quedan las siluetas.
    }
  }, []);

  if (!filas) {
    return <>{fallback}</>;
  }

  return (
    <div aria-busy="true" className="pointer-events-none select-none">
      {filas.map((fila) => (
        <div key={fila.id} className="grid grid-cols-[68px_minmax(0,1fr)] items-start gap-2 px-3 py-3">
          <div className="flex justify-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-base font-medium text-muted-foreground">
              {inicial(fila)}
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-1 pt-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">{fila.label || fila.secondaryLabel}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{hora(fila.lastMessageAt)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="truncate text-sm text-muted-foreground">{fila.lastMessage ?? ""}</span>
              {fila.incomingCount ? (
                <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
                  {fila.incomingCount}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
