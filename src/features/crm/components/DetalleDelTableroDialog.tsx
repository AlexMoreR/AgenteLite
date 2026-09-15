"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";

import { detalleDelTableroAction } from "@/app/actions/tablero-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getCrmStageLabel } from "../domain/crm-config";
import type { FilaDeDetalle, TipoDeDetalle } from "../services/getDetalleDelTablero";

const CUANDO = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

type Estado = { clave: string; filas: FilaDeDetalle[]; hayMas: boolean; pagina: number; error: string | null };

/**
 * La lista de contactos detras de una cifra del tablero (pedido de Alex, 15-sep-2026).
 *
 * Cada fila lleva al chat: el tablero sirve para ver QUIENES son, y lo siguiente que uno quiere es
 * abrir esa conversacion.
 */
export function DetalleDelTableroDialog({
  abierto,
  alCerrar,
  titulo,
  tipo,
  userId,
  desde,
  hasta,
}: {
  abierto: boolean;
  alCerrar: () => void;
  titulo: string;
  tipo: TipoDeDetalle | null;
  userId: string;
  desde: string;
  hasta: string;
}) {
  const clave = tipo ? `${tipo}|${userId}|${desde}|${hasta}` : "";
  const [estado, setEstado] = useState<Estado | null>(null);
  const [cargandoMas, setCargandoMas] = useState(false);
  // Mientras la lista guardada no sea de lo que se abrio, se esta cargando.
  const cargando = abierto && Boolean(tipo) && estado?.clave !== clave;

  useEffect(() => {
    if (!abierto || !tipo) {
      return;
    }
    let vigente = true;
    detalleDelTableroAction({ userId, tipo, desde, hasta, pagina: 0 })
      .then((respuesta) => {
        if (!vigente) return;
        setEstado(
          "error" in respuesta
            ? { clave, filas: [], hayMas: false, pagina: 0, error: respuesta.error ?? "No se pudo cargar" }
            : { clave, filas: respuesta.filas, hayMas: respuesta.hayMas, pagina: 0, error: null },
        );
      })
      .catch(() => {
        if (vigente) setEstado({ clave, filas: [], hayMas: false, pagina: 0, error: "No se pudo cargar la lista" });
      });
    return () => {
      vigente = false;
    };
  }, [abierto, tipo, userId, desde, hasta, clave]);

  const cargarMas = async () => {
    if (!estado || !tipo || cargandoMas) return;
    setCargandoMas(true);
    try {
      const siguiente = estado.pagina + 1;
      const respuesta = await detalleDelTableroAction({ userId, tipo, desde, hasta, pagina: siguiente });
      if (!("error" in respuesta)) {
        setEstado({ ...estado, filas: [...estado.filas, ...respuesta.filas], hayMas: respuesta.hayMas, pagina: siguiente });
      }
    } finally {
      setCargandoMas(false);
    }
  };

  const filas = estado?.clave === clave ? estado.filas : [];

  return (
    <Dialog open={abierto} onOpenChange={(siguiente) => (siguiente ? null : alCerrar())}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            {desde === hasta ? desde : `${desde} a ${hasta}`}
            {filas.length > 0 ? ` · ${filas.length}${estado?.hayMas ? "+" : ""}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-2 min-h-24 flex-1 overflow-y-auto px-2">
          {cargando ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Cargando…
            </div>
          ) : estado?.error ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{estado.error}</p>
          ) : filas.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No hay contactos en esta lista.</p>
          ) : (
            <ul className="divide-y divide-border">
              {filas.map((fila, indice) => {
                const contenido = (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{fila.nombre}</p>
                      <p className="truncate text-[12px] text-muted-foreground">
                        {getCrmStageLabel(fila.etapa)}
                        {fila.cuando ? ` · ${CUANDO.format(new Date(fila.cuando))}` : ""}
                        {fila.nota ? ` · ${fila.nota}` : ""}
                      </p>
                    </div>
                    {fila.conversationId ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : null}
                  </>
                );
                return (
                  <li key={`${fila.conversationId ?? fila.telefono}-${indice}`}>
                    {fila.conversationId ? (
                      <Link
                        href={`/cliente/chats?chatKey=${encodeURIComponent(`agent:${fila.conversationId}`)}`}
                        className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-muted"
                      >
                        {contenido}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-3 px-2 py-2.5">{contenido}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {estado?.hayMas && !cargando ? (
          <Button type="button" variant="outline" onClick={() => void cargarMas()} disabled={cargandoMas}>
            {cargandoMas ? <Loader2 className="size-4 animate-spin" /> : null}
            Ver más
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
