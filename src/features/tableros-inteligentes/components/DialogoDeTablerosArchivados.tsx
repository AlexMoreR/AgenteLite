"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { recuperarTableroAction, tablerosArchivadosAction } from "@/app/actions/tableros-inteligentes-actions";
import type { TableroArchivadoVista } from "../services/tableros-archivados";

/*
  "Tableros archivados" (10-nov-2026): los tableros que el dueño eliminó (quedaron archivados, sin borrar nada), con
  "Recuperar" para devolverlos a la pantalla tal como estaban. Se abre desde el selector de tableros y solo lo ve el
  dueño del negocio; el servidor lo vuelve a revisar.
*/

type Props = {
  abierto: boolean;
  alCerrar: () => void;
  /** Un tablero volvió: la lista de tableros se pregunta de nuevo. */
  alRecuperar: (id: string) => void;
};

const fecha = (iso: string) => {
  const cuando = new Date(iso);
  return Number.isNaN(cuando.getTime())
    ? ""
    : cuando.toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Bogota" });
};

const tarjetasEnTexto = (cuantas: number) => (cuantas === 1 ? "1 tarjeta" : `${cuantas} tarjetas`);

export function DialogoDeTablerosArchivados({ abierto, alCerrar, alRecuperar }: Props) {
  return (
    <Dialog
      open={abierto}
      onOpenChange={(abrir) => {
        if (!abrir) alCerrar();
      }}
    >
      {/* Montado solo abierto: cada vez que se abre pregunta la lista de nuevo. */}
      {abierto ? <Lista alRecuperar={alRecuperar} /> : null}
    </Dialog>
  );
}

function Lista({ alRecuperar }: Pick<Props, "alRecuperar">) {
  const [tableros, setTableros] = useState<TableroArchivadoVista[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recuperando, setRecuperando] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    tablerosArchivadosAction()
      .then((respuesta) => {
        if (!vigente) return;
        if (respuesta.ok) setTableros(respuesta.tableros);
        else setError(respuesta.error);
      })
      .catch(() => {
        if (vigente) setError("No se pudo leer la lista. Revisa la conexión e intenta de nuevo.");
      });
    return () => {
      vigente = false;
    };
  }, []);

  const recuperar = async (tablero: TableroArchivadoVista) => {
    if (recuperando) return;
    setRecuperando(tablero.id);
    try {
      const respuesta = await recuperarTableroAction(tablero.id);
      if (!respuesta.ok) {
        toast.error(respuesta.error);
        return;
      }
      toast.success(`Recuperaste "${tablero.nombre}"`);
      setTableros((lista) => (lista ?? []).filter((otro) => otro.id !== tablero.id));
      alRecuperar(tablero.id);
    } catch {
      toast.error("No se pudo recuperar. Revisa la conexión e intenta de nuevo.");
    } finally {
      setRecuperando(null);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Tableros archivados</DialogTitle>
        <DialogDescription>Los tableros que eliminaste. Al recuperarlo vuelve con todas sus tarjetas, tal como estaba.</DialogDescription>
      </DialogHeader>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : tableros === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Cargando…
        </p>
      ) : tableros.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay tableros archivados.</p>
      ) : (
        <ul className="grid gap-1">
          {tableros.map((tablero) => (
            <li key={tablero.id} className="flex items-center gap-2 rounded-md px-1 py-1.5">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium" title={tablero.nombre}>
                  {tablero.nombre}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {tarjetasEnTexto(tablero.tarjetas)}
                  {tablero.archivadoEn ? ` · archivado el ${fecha(tablero.archivadoEn)}` : ""}
                  {tablero.archivadoPor ? ` por ${tablero.archivadoPor}` : ""}
                </span>
              </span>
              <Button
                type="button"
                variant="outline"
                className="h-11 shrink-0 md:h-9"
                onClick={() => void recuperar(tablero)}
                disabled={recuperando !== null}
              >
                {recuperando === tablero.id ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <RotateCcw className="size-4" aria-hidden />
                )}
                Recuperar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </DialogContent>
  );
}
