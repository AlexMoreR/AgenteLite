"use client";

import { useEffect, useMemo, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import {
  AlignLeft,
  ArrowDownAZ,
  ArrowUpAZ,
  ArrowLeftToLine,
  ArrowRightToLine,
  Calendar,
  Check,
  ChevronRight,
  Copy,
  Hash,
  Info,
  List,
  Loader2,
  Plus,
  Repeat,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  agregarColumnaAction,
  agregarFilaAction,
  borrarFilaAction,
  cambiarTipoDeColumnaAction,
  duplicarColumnaAction,
  editarCeldaDeBaseAction,
  leerBaseDeDatosAction,
  quitarColumnaAction,
  renombrarBaseDeDatosAction,
  renombrarColumnaAction,
} from "@/app/actions/bases-de-datos-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { BaseDeDatosVista } from "../services/bases-de-datos";
import {
  NOMBRE_DEL_TIPO_DE_COLUMNA,
  TIPOS_DE_COLUMNA,
  calzaConElTipo,
  compararCeldas,
  type ColumnaDeBase,
  type TipoDeColumna,
} from "../services/reglas-base-de-datos";

/*
  La tabla de una base de datos del Espacio (28-nov-2026), al estilo de Notion: se abre al tocar su
  tarjeta. # es el índice (se pone solo). Tocar el encabezado de una columna abre su menú: el nombre,
  Cambiar tipo (texto, número, fecha, lista), Ordenar, Insertar a la izquierda o a la derecha, Duplicar y
  Eliminar. Cada celda se guarda al salir de ella. «Detalles» abre la ficha (mover, responsable, eliminar).
*/

const ICONO_DEL_TIPO: Record<TipoDeColumna, LucideIcon> = {
  texto: AlignLeft,
  numero: Hash,
  fecha: Calendar,
  lista: List,
};

type Orden = { columnaId: string; direccion: 1 | -1 } | null;
type Estado = { id: string; base: BaseDeDatosVista | null; error: string | null };
const SIN_CONEXION = { ok: false as const, error: "No se pudo guardar: revisa la conexión." };

function ItemDeMenu({
  icono: Icono,
  children,
  onClick,
  peligro,
  activo,
  derecha,
}: {
  icono: LucideIcon;
  children: React.ReactNode;
  onClick: () => void;
  peligro?: boolean;
  activo?: boolean;
  derecha?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm hover:bg-muted",
        peligro && "text-destructive",
        activo && "bg-muted",
      )}
    >
      <Icono className="size-4 shrink-0 opacity-70" aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
      {derecha}
    </button>
  );
}

/** El menú de una columna, como el de Notion. */
function MenuDeColumna({
  columna,
  orden,
  alRenombrar,
  alCambiarTipo,
  alOrdenar,
  alInsertar,
  alDuplicar,
  alEliminar,
}: {
  columna: ColumnaDeBase;
  orden: Orden;
  alRenombrar: (nombre: string) => Promise<boolean>;
  alCambiarTipo: (tipo: TipoDeColumna) => void;
  alOrdenar: (direccion: 1 | -1 | null) => void;
  alInsertar: (lado: "izquierda" | "derecha") => void;
  alDuplicar: () => void;
  alEliminar: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [verTipos, setVerTipos] = useState(false);
  const [nombre, setNombre] = useState(columna.nombre);
  const Icono = ICONO_DEL_TIPO[columna.tipo];
  const ordenada = orden?.columnaId === columna.id ? orden.direccion : null;
  const esNumero = columna.tipo === "numero" || columna.tipo === "fecha";

  const cerrar = () => {
    setAbierto(false);
    setVerTipos(false);
  };
  const guardarNombre = async () => {
    if (nombre.trim() && nombre.trim() !== columna.nombre && !(await alRenombrar(nombre))) setNombre(columna.nombre);
  };
  const hacer = (accion: () => void) => () => {
    void guardarNombre();
    cerrar();
    accion();
  };

  return (
    <Popover.Root
      open={abierto}
      onOpenChange={(abrir) => {
        if (abrir) {
          setNombre(columna.nombre);
          setAbierto(true);
        } else {
          void guardarNombre();
          cerrar();
        }
      }}
    >
      <Popover.Trigger
        className="flex h-10 w-full min-w-0 items-center gap-1.5 px-2 text-left text-sm font-normal text-muted-foreground hover:bg-muted data-[popup-open]:bg-muted"
        aria-label={`Columna ${columna.nombre}: abrir su menú`}
      >
        <Icono className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{columna.nombre}</span>
        {ordenada ? (ordenada === 1 ? <ArrowDownAZ className="size-3.5 shrink-0" /> : <ArrowUpAZ className="size-3.5 shrink-0" />) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="isolate z-[60] outline-none" side="bottom" align="start" sideOffset={4}>
          <Popover.Popup className="w-64 rounded-lg bg-popover p-1.5 text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none">
            <div className="flex items-center gap-2 p-1">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border">
                <Icono className="size-4 opacity-70" aria-hidden />
              </span>
              <input
                autoFocus
                value={nombre}
                onChange={(evento) => setNombre(evento.target.value)}
                onKeyDown={(evento) => {
                  if (evento.key === "Enter") {
                    void guardarNombre();
                    cerrar();
                  }
                }}
                aria-label="Nombre de la columna"
                className="h-8 min-w-0 flex-1 rounded-md bg-muted px-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
            {verTipos ? (
              <div className="mt-1 border-t pt-1">
                <ItemDeMenu icono={ChevronRight} onClick={() => setVerTipos(false)}>
                  <span className="text-muted-foreground">Volver</span>
                </ItemDeMenu>
                {TIPOS_DE_COLUMNA.map((tipo) => (
                  <ItemDeMenu
                    key={tipo}
                    icono={ICONO_DEL_TIPO[tipo]}
                    onClick={hacer(() => {
                      if (tipo !== columna.tipo) alCambiarTipo(tipo);
                    })}
                    derecha={tipo === columna.tipo ? <Check className="size-4" /> : null}
                  >
                    {NOMBRE_DEL_TIPO_DE_COLUMNA[tipo]}
                  </ItemDeMenu>
                ))}
              </div>
            ) : (
              <div className="mt-1 border-t pt-1">
                <ItemDeMenu
                  icono={Repeat}
                  onClick={() => setVerTipos(true)}
                  derecha={
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      {NOMBRE_DEL_TIPO_DE_COLUMNA[columna.tipo]}
                      <ChevronRight className="size-3.5" />
                    </span>
                  }
                >
                  Cambiar tipo
                </ItemDeMenu>
                <ItemDeMenu icono={ArrowDownAZ} activo={ordenada === 1} onClick={hacer(() => alOrdenar(ordenada === 1 ? null : 1))}>
                  {esNumero ? "Ordenar de menor a mayor" : "Ordenar de la A a la Z"}
                </ItemDeMenu>
                <ItemDeMenu icono={ArrowUpAZ} activo={ordenada === -1} onClick={hacer(() => alOrdenar(ordenada === -1 ? null : -1))}>
                  {esNumero ? "Ordenar de mayor a menor" : "Ordenar de la Z a la A"}
                </ItemDeMenu>
                <div className="my-1 border-t" />
                <ItemDeMenu icono={ArrowLeftToLine} onClick={hacer(() => alInsertar("izquierda"))}>
                  Insertar a la izquierda
                </ItemDeMenu>
                <ItemDeMenu icono={ArrowRightToLine} onClick={hacer(() => alInsertar("derecha"))}>
                  Insertar a la derecha
                </ItemDeMenu>
                <ItemDeMenu icono={Copy} onClick={hacer(alDuplicar)}>
                  Duplicar columna
                </ItemDeMenu>
                <ItemDeMenu icono={Trash2} peligro onClick={hacer(alEliminar)}>
                  Eliminar columna
                </ItemDeMenu>
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Una celda: el campo cambia con el tipo de la columna. Lo que no calza con el tipo se ve en rojo. */
function Celda({
  columna,
  valor,
  etiqueta,
  alGuardar,
}: {
  columna: ColumnaDeBase;
  valor: string;
  etiqueta: string;
  alGuardar: (texto: string, campo: HTMLInputElement) => void;
}) {
  const calza = calzaConElTipo(columna, valor);
  const comun = {
    defaultValue: valor,
    "aria-label": etiqueta,
    title: calza ? undefined : `No es ${columna.tipo === "numero" ? "un número" : "una fecha"}: corrígelo`,
    onBlur: (evento: React.FocusEvent<HTMLInputElement>) => alGuardar(evento.target.value, evento.target),
    onKeyDown: (evento: React.KeyboardEvent<HTMLInputElement>) => {
      if (evento.key === "Enter") evento.currentTarget.blur();
    },
    className: cn(
      "h-10 w-full bg-transparent px-2 text-sm outline-none focus:bg-sky-50 dark:focus:bg-sky-950/40",
      columna.tipo === "numero" && "text-right tabular-nums",
      !calza && "text-destructive",
    ),
  };
  if (columna.tipo === "fecha" && calza) return <input type="date" {...comun} />;
  if (columna.tipo === "numero") return <input inputMode="decimal" {...comun} />;
  if (columna.tipo === "lista") {
    const lista = `opciones-${columna.id}`;
    return (
      <>
        <input list={lista} {...comun} />
        <datalist id={lista}>
          {(columna.opciones ?? []).map((opcion) => (
            <option key={opcion} value={opcion} />
          ))}
        </datalist>
      </>
    );
  }
  return <input {...comun} />;
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
  const [estado, setEstado] = useState<Estado | null>(null);
  const base = estado && estado.id === tarjetaId ? estado.base : null;
  const error = estado && estado.id === tarjetaId ? estado.error : null;
  const setBase = (cambio: (actual: BaseDeDatosVista) => BaseDeDatosVista) =>
    setEstado((actual) => (actual?.base ? { ...actual, base: cambio(actual.base) } : actual));
  const [ocupado, setOcupado] = useState(false);
  const [orden, setOrden] = useState<Orden>(null);

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

  // El orden solo cambia cómo se ve: los # no cambian. Lo vacío va siempre al final.
  const filasVisibles = useMemo(() => {
    if (!base) return [];
    const columna = orden ? base.columnas.find((candidata) => candidata.id === orden.columnaId) : null;
    if (!orden || !columna) return base.filas;
    return [...base.filas].sort((a, b) => {
      const [x, y] = [a.valores[columna.id] ?? "", b.valores[columna.id] ?? ""];
      if (!x || !y) return compararCeldas(columna, x, y);
      return orden.direccion * compararCeldas(columna, x, y);
    });
  }, [base, orden]);

  const conCarga = async <T,>(accion: () => Promise<T>) => {
    if (ocupado) return null;
    setOcupado(true);
    try {
      return await accion();
    } finally {
      setOcupado(false);
    }
  };

  const ponerColumnas = (columnas: ColumnaDeBase[]) => setBase((actual) => ({ ...actual, columnas }));

  const renombrarBase = async (titulo: string) => {
    if (!base || !titulo.trim() || titulo.trim() === base.titulo) return;
    const resultado = await renombrarBaseDeDatosAction(base.tarjetaId, titulo.trim()).catch(() => SIN_CONEXION);
    if (!resultado.ok) return void toast.error(resultado.error);
    setBase((actual) => ({ ...actual, titulo: titulo.trim() }));
    alCambiar();
  };

  const renombrarColumna = async (columnaId: string, nombre: string): Promise<boolean> => {
    if (!base) return false;
    const resultado = await renombrarColumnaAction(base.tarjetaId, columnaId, nombre).catch(() => SIN_CONEXION);
    if (!resultado.ok) {
      toast.error(resultado.error);
      return false;
    }
    setBase((actual) => ({
      ...actual,
      columnas: actual.columnas.map((columna) => (columna.id === columnaId ? { ...columna, nombre: nombre.trim() } : columna)),
    }));
    return true;
  };

  const agregarColumna = async (posicion?: number) => {
    if (!base) return;
    const resultado = await conCarga(() => agregarColumnaAction(base.tarjetaId, posicion).catch(() => SIN_CONEXION));
    if (!resultado) return;
    if (!resultado.ok) return void toast.error(resultado.error);
    ponerColumnas(resultado.columnas);
  };

  const duplicarColumna = async (columnaId: string) => {
    if (!base) return;
    const resultado = await conCarga(() => duplicarColumnaAction(base.tarjetaId, columnaId).catch(() => SIN_CONEXION));
    if (!resultado) return;
    if (!resultado.ok) return void toast.error(resultado.error);
    // Los datos copiados están en el servidor: se vuelve a leer la base.
    const leida = await leerBaseDeDatosAction(base.tarjetaId).catch(() => null);
    if (leida?.ok) setBase(() => leida.base);
    else ponerColumnas(resultado.columnas);
  };

  const cambiarTipo = async (columnaId: string, tipo: TipoDeColumna) => {
    if (!base) return;
    const resultado = await conCarga(() => cambiarTipoDeColumnaAction(base.tarjetaId, columnaId, tipo).catch(() => SIN_CONEXION));
    if (!resultado) return;
    if (!resultado.ok) return void toast.error(resultado.error);
    ponerColumnas(resultado.columnas);
    toast.success(`Ahora es ${NOMBRE_DEL_TIPO_DE_COLUMNA[tipo].toLowerCase()}. Lo que no calce queda en rojo.`);
  };

  const quitarColumna = async (columnaId: string, nombre: string) => {
    if (!base) return;
    if (!window.confirm(`¿Eliminar la columna «${nombre}»? Se borra lo que tenga en todas las filas.`)) return;
    const resultado = await conCarga(() => quitarColumnaAction(base.tarjetaId, columnaId).catch(() => SIN_CONEXION));
    if (!resultado) return;
    if (!resultado.ok) return void toast.error(resultado.error);
    if (orden?.columnaId === columnaId) setOrden(null);
    setBase((actual) => ({
      ...actual,
      columnas: actual.columnas.filter((columna) => columna.id !== columnaId),
      filas: actual.filas.map((fila) => {
        const valores = { ...fila.valores };
        delete valores[columnaId];
        return { ...fila, valores };
      }),
    }));
  };

  const agregarFila = async () => {
    if (!base) return;
    const resultado = await conCarga(() => agregarFilaAction(base.tarjetaId).catch(() => SIN_CONEXION));
    if (!resultado) return;
    if (!resultado.ok) return void toast.error(resultado.error);
    setBase((actual) => ({ ...actual, filas: [...actual.filas, resultado.fila], total: actual.total + 1 }));
  };

  const guardarCelda = async (filaId: string, columnaId: string, texto: string, campo: HTMLInputElement) => {
    if (!base) return;
    const antes = base.filas.find((fila) => fila.id === filaId)?.valores[columnaId] ?? "";
    if (texto === antes) return;
    const resultado = await editarCeldaDeBaseAction(base.tarjetaId, filaId, columnaId, texto).catch(() => SIN_CONEXION);
    if (!resultado.ok) {
      campo.value = antes;
      return void toast.error(resultado.error);
    }
    // Un número o una fecha se guardan normalizados ("2,5" → "2.5"): el campo muestra lo guardado.
    if (campo.value !== resultado.texto) campo.value = resultado.texto;
    setBase((actual) => ({
      ...actual,
      ...(resultado.columnas ? { columnas: resultado.columnas } : {}),
      filas: actual.filas.map((fila) =>
        fila.id === filaId ? { ...fila, valores: { ...fila.valores, [columnaId]: resultado.texto } } : fila,
      ),
    }));
  };

  const borrarFila = async (filaId: string, numero: number) => {
    if (!base) return;
    if (!window.confirm(`¿Borrar la fila ${numero}? No se puede deshacer.`)) return;
    const resultado = await conCarga(() => borrarFilaAction(base.tarjetaId, filaId).catch(() => SIN_CONEXION));
    if (!resultado) return;
    if (!resultado.ok) return void toast.error(resultado.error);
    setBase((actual) => ({ ...actual, filas: actual.filas.filter((fila) => fila.id !== filaId), total: actual.total - 1 }));
  };

  return (
    <Dialog open={tarjetaId !== null} onOpenChange={(abrir) => (abrir ? undefined : alCerrar())}>
      <DialogContent showCloseButton={false} className="flex h-[90dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 p-0 sm:max-w-5xl">
        <DialogTitle className="sr-only">{base?.titulo ?? "Base de datos"}</DialogTitle>
        <DialogDescription className="sr-only">Tabla de la base de datos</DialogDescription>
        <div className="flex shrink-0 items-center justify-end gap-1 px-3 pt-2">
          {ocupado ? <Loader2 className="mr-1 size-4 animate-spin text-muted-foreground" /> : null}
          {base ? (
            <Button variant="ghost" size="sm" className="h-10 text-muted-foreground md:h-8" onClick={() => alVerDetalles(base.tarjetaId)}>
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
            <div className="shrink-0 px-4 pb-3 md:px-6">
              <input
                key={base.titulo}
                defaultValue={base.titulo}
                placeholder="Nueva base de datos"
                aria-label="Nombre de la base de datos"
                onBlur={(evento) => void renombrarBase(evento.target.value)}
                onKeyDown={(evento) => {
                  if (evento.key === "Enter") evento.currentTarget.blur();
                }}
                className="w-full bg-transparent text-2xl font-bold tracking-tight outline-none placeholder:text-muted-foreground/40 md:text-3xl"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-2 md:px-4">
              <table className="w-max min-w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-popover">
                  <tr className="border-y border-border/70">
                    <th className="w-12 border-r border-border/50 px-2 text-center text-xs font-normal text-muted-foreground">#</th>
                    {base.columnas.map((columna, indice) => (
                      <th key={columna.id} className="min-w-48 border-r border-border/50 p-0">
                        <MenuDeColumna
                          columna={columna}
                          orden={orden}
                          alRenombrar={(nombre) => renombrarColumna(columna.id, nombre)}
                          alCambiarTipo={(tipo) => void cambiarTipo(columna.id, tipo)}
                          alOrdenar={(direccion) => setOrden(direccion ? { columnaId: columna.id, direccion } : null)}
                          alInsertar={(lado) => void agregarColumna(lado === "izquierda" ? indice : indice + 1)}
                          alDuplicar={() => void duplicarColumna(columna.id)}
                          alEliminar={() => void quitarColumna(columna.id, columna.nombre)}
                        />
                      </th>
                    ))}
                    <th className="w-10 p-0">
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => void agregarColumna()}
                        className="flex size-10 items-center justify-center text-muted-foreground hover:bg-muted"
                        aria-label="Agregar columna"
                        title="Agregar columna"
                      >
                        <Plus className="size-4" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filasVisibles.map((fila) => (
                    <tr key={fila.id} className="group border-b border-border/70">
                      <td className="border-r border-border/50 px-2 text-center text-xs tabular-nums text-muted-foreground">{fila.numero}</td>
                      {base.columnas.map((columna) => (
                        <td key={columna.id} className="border-r border-border/50 p-0">
                          <Celda
                            key={`${columna.tipo}-${fila.valores[columna.id] ?? ""}`}
                            columna={columna}
                            valor={fila.valores[columna.id] ?? ""}
                            etiqueta={`${columna.nombre}, fila ${fila.numero}`}
                            alGuardar={(texto, campo) => void guardarCelda(fila.id, columna.id, texto, campo)}
                          />
                        </td>
                      ))}
                      <td className="p-0">
                        <button
                          type="button"
                          disabled={ocupado}
                          onClick={() => void borrarFila(fila.id, fila.numero)}
                          className="flex size-10 items-center justify-center text-muted-foreground opacity-40 hover:text-destructive group-hover:opacity-100"
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
              <button
                type="button"
                disabled={ocupado}
                onClick={() => void agregarFila()}
                className="flex h-10 w-full items-center gap-2 px-2 text-sm text-muted-foreground hover:bg-muted"
              >
                <Plus className="size-4" />
                Nueva fila
              </button>
            </div>
            <div className="shrink-0 px-4 py-2 text-right text-xs tabular-nums text-muted-foreground md:px-6">
              {base.total} {base.total === 1 ? "fila" : "filas"}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
