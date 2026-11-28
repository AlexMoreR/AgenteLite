"use client";

import { useEffect, useState } from "react";
import { Database, Info, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import {
  agregarColumnaAction,
  agregarFilaAction,
  borrarFilaAction,
  editarCeldaDeBaseAction,
  leerBaseDeDatosAction,
  quitarColumnaAction,
  renombrarBaseDeDatosAction,
  renombrarColumnaAction,
} from "@/app/actions/bases-de-datos-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { BaseDeDatosVista } from "../services/bases-de-datos";

/*
  La tabla de una base de datos del Espacio (28-nov-2026): se abre al tocar su tarjeta en el mapa.
  # es el índice (se pone solo). Las demás columnas son de texto: el nombre se cambia escribiendo en el
  encabezado, «+ Columna» agrega una y la X de cada encabezado la quita (con sus datos). Cada celda se
  guarda al salir de ella. «Detalles» abre la ficha de la tarjeta (mover, responsable, eliminar).
*/

function nombreLibre(base: BaseDeDatosVista) {
  const usados = new Set(base.columnas.map((columna) => columna.nombre.toLowerCase()));
  let numero = base.columnas.length + 1;
  while (usados.has(`columna ${numero}`)) numero += 1;
  return `Columna ${numero}`;
}

export function TablaBaseDeDatos({
  tarjetaId,
  alCerrar,
  alCambiar,
  alVerDetalles,
}: {
  tarjetaId: string | null;
  alCerrar: () => void;
  /** Algo de la tarjeta cambió (el nombre): refrescar el mapa. */
  alCambiar: () => void;
  alVerDetalles: (tarjetaId: string) => void;
}) {
  // Lo cargado es de UNA tarjeta: si se abre otra, no se muestra lo de la anterior mientras carga.
  const [estado, setEstado] = useState<{ id: string; base: BaseDeDatosVista | null; error: string | null } | null>(null);
  const base = estado && estado.id === tarjetaId ? estado.base : null;
  const error = estado && estado.id === tarjetaId ? estado.error : null;
  const setBase = (cambio: (actual: BaseDeDatosVista | null) => BaseDeDatosVista | null) =>
    setEstado((actual) => (actual ? { ...actual, base: cambio(actual.base) } : actual));
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!tarjetaId) return;
    let cancelado = false;
    void leerBaseDeDatosAction(tarjetaId)
      .catch(() => ({ ok: false as const, error: "No se pudo abrir: revisa la conexión." }))
      .then((resultado) => {
        if (cancelado) return;
        setEstado(
          resultado.ok
            ? { id: tarjetaId, base: resultado.base, error: null }
            : { id: tarjetaId, base: null, error: resultado.error },
        );
      });
    return () => {
      cancelado = true;
    };
  }, [tarjetaId]);

  const fallo = (texto: string) => toast.error(texto);
  const sinConexion = { ok: false as const, error: "No se pudo guardar: revisa la conexión." };

  const renombrarBase = async (titulo: string) => {
    if (!base || !titulo.trim() || titulo.trim() === base.titulo) return;
    const resultado = await renombrarBaseDeDatosAction(base.tarjetaId, titulo.trim()).catch(() => sinConexion);
    if (!resultado.ok) return fallo(resultado.error);
    setBase((actual) => (actual ? { ...actual, titulo: titulo.trim() } : actual));
    alCambiar();
  };

  const renombrarColumna = async (columnaId: string, nombre: string, campo: HTMLInputElement) => {
    if (!base) return;
    const antes = base.columnas.find((columna) => columna.id === columnaId)?.nombre ?? "";
    if (nombre.trim() === antes) return;
    const resultado = await renombrarColumnaAction(base.tarjetaId, columnaId, nombre).catch(() => sinConexion);
    if (!resultado.ok) {
      campo.value = antes;
      return fallo(resultado.error);
    }
    setBase((actual) =>
      actual
        ? { ...actual, columnas: actual.columnas.map((columna) => (columna.id === columnaId ? { ...columna, nombre: nombre.trim() } : columna)) }
        : actual,
    );
  };

  const agregarColumna = async () => {
    if (!base || ocupado) return;
    setOcupado(true);
    const resultado = await agregarColumnaAction(base.tarjetaId, nombreLibre(base)).catch(() => sinConexion);
    setOcupado(false);
    if (!resultado.ok) return fallo(resultado.error);
    setBase((actual) => (actual ? { ...actual, columnas: [...actual.columnas, resultado.columna] } : actual));
  };

  const quitarColumna = async (columnaId: string, nombre: string) => {
    if (!base || ocupado) return;
    if (!window.confirm(`¿Quitar la columna «${nombre}»? Se borra lo que tenga en todas las filas.`)) return;
    setOcupado(true);
    const resultado = await quitarColumnaAction(base.tarjetaId, columnaId).catch(() => sinConexion);
    setOcupado(false);
    if (!resultado.ok) return fallo(resultado.error);
    setBase((actual) =>
      actual
        ? {
            ...actual,
            columnas: actual.columnas.filter((columna) => columna.id !== columnaId),
            filas: actual.filas.map((fila) => {
              const valores = { ...fila.valores };
              delete valores[columnaId];
              return { ...fila, valores };
            }),
          }
        : actual,
    );
  };

  const agregarFila = async () => {
    if (!base || ocupado) return;
    setOcupado(true);
    const resultado = await agregarFilaAction(base.tarjetaId).catch(() => sinConexion);
    setOcupado(false);
    if (!resultado.ok) return fallo(resultado.error);
    setBase((actual) => (actual ? { ...actual, filas: [...actual.filas, resultado.fila], total: actual.total + 1 } : actual));
  };

  const guardarCelda = async (filaId: string, columnaId: string, texto: string, campo: HTMLInputElement) => {
    if (!base) return;
    const antes = base.filas.find((fila) => fila.id === filaId)?.valores[columnaId] ?? "";
    if (texto === antes) return;
    const resultado = await editarCeldaDeBaseAction(base.tarjetaId, filaId, columnaId, texto).catch(() => sinConexion);
    if (!resultado.ok) {
      campo.value = antes;
      return fallo(resultado.error);
    }
    setBase((actual) =>
      actual
        ? {
            ...actual,
            filas: actual.filas.map((fila) => (fila.id === filaId ? { ...fila, valores: { ...fila.valores, [columnaId]: texto } } : fila)),
          }
        : actual,
    );
  };

  const borrarFila = async (filaId: string, numero: number) => {
    if (!base || ocupado) return;
    if (!window.confirm(`¿Borrar la fila ${numero}? No se puede deshacer.`)) return;
    setOcupado(true);
    const resultado = await borrarFilaAction(base.tarjetaId, filaId).catch(() => sinConexion);
    setOcupado(false);
    if (!resultado.ok) return fallo(resultado.error);
    setBase((actual) => (actual ? { ...actual, filas: actual.filas.filter((fila) => fila.id !== filaId), total: actual.total - 1 } : actual));
  };

  return (
    <Dialog open={tarjetaId !== null} onOpenChange={(abrir) => (abrir ? undefined : alCerrar())}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[90dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 p-0 sm:max-w-5xl"
      >
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <Database className="size-5 shrink-0 text-sky-500" aria-hidden />
          <DialogTitle className="sr-only">{base?.titulo ?? "Base de datos"}</DialogTitle>
          <DialogDescription className="sr-only">Tabla de la base de datos</DialogDescription>
          {base ? (
            <input
              key={base.titulo}
              defaultValue={base.titulo}
              aria-label="Nombre de la base de datos"
              onBlur={(evento) => void renombrarBase(evento.target.value)}
              onKeyDown={(evento) => {
                if (evento.key === "Enter") evento.currentTarget.blur();
              }}
              className="h-10 min-w-0 flex-1 rounded-md bg-transparent px-2 text-base font-semibold outline-none hover:bg-muted focus:bg-muted"
            />
          ) : (
            <span className="flex-1 text-base font-semibold">Base de datos</span>
          )}
          {base ? (
            <Button variant="ghost" size="sm" className="h-10 md:h-8" onClick={() => alVerDetalles(base.tarjetaId)}>
              <Info />
              Detalles
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" className="size-10 md:size-8" onClick={alCerrar} aria-label="Cerrar">
            <X />
          </Button>
        </div>

        {error ? (
          <p className="m-auto px-6 text-center text-sm text-muted-foreground">{error}</p>
        ) : !base ? (
          <div className="m-auto text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-max min-w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                  <tr>
                    <th className="w-12 border-b border-r px-2 py-2 text-center text-xs font-semibold text-muted-foreground">#</th>
                    {base.columnas.map((columna) => (
                      <th key={columna.id} className="min-w-44 border-b border-r p-0 text-left font-semibold">
                        <div className="flex items-center">
                          <input
                            defaultValue={columna.nombre}
                            aria-label={`Nombre de la columna ${columna.nombre}`}
                            onBlur={(evento) => void renombrarColumna(columna.id, evento.target.value, evento.target)}
                            onKeyDown={(evento) => {
                              if (evento.key === "Enter") evento.currentTarget.blur();
                            }}
                            className="h-10 min-w-0 flex-1 bg-transparent px-2 outline-none focus:bg-background"
                          />
                          <button
                            type="button"
                            disabled={ocupado}
                            onClick={() => void quitarColumna(columna.id, columna.nombre)}
                            className="mr-1 flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-destructive"
                            aria-label={`Quitar la columna ${columna.nombre}`}
                            title="Quitar columna"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      </th>
                    ))}
                    <th className="border-b px-1 py-1 text-left">
                      <Button variant="ghost" size="sm" className="h-9" disabled={ocupado} onClick={() => void agregarColumna()}>
                        <Plus />
                        Columna
                      </Button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {base.filas.map((fila) => (
                    <tr key={fila.id} className="group">
                      <td className="border-b border-r px-2 text-center text-xs tabular-nums text-muted-foreground">{fila.numero}</td>
                      {base.columnas.map((columna) => (
                        <td key={columna.id} className="border-b border-r p-0">
                          <input
                            defaultValue={fila.valores[columna.id] ?? ""}
                            aria-label={`${columna.nombre}, fila ${fila.numero}`}
                            onBlur={(evento) => void guardarCelda(fila.id, columna.id, evento.target.value, evento.target)}
                            onKeyDown={(evento) => {
                              if (evento.key === "Enter") evento.currentTarget.blur();
                            }}
                            className="h-10 w-full bg-transparent px-2 outline-none focus:bg-sky-50 dark:focus:bg-sky-950/40"
                          />
                        </td>
                      ))}
                      <td className="border-b px-1">
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => void borrarFila(fila.id, fila.numero)}
                          className="flex size-8 items-center justify-center rounded text-muted-foreground opacity-60 hover:bg-muted hover:text-destructive group-hover:opacity-100"
                          aria-label={`Borrar la fila ${fila.numero}`}
                          title="Borrar fila"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {base.filas.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">Todavía no hay filas.</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2">
              <Button variant="outline" size="sm" className="h-10 md:h-8" disabled={ocupado} onClick={() => void agregarFila()}>
                {ocupado ? <Loader2 className="animate-spin" /> : <Plus />}
                Fila
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {base.total} {base.total === 1 ? "fila" : "filas"}
              </span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
