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
  GripVertical,
  Hash,
  Info,
  List,
  Loader2,
  PanelRight,
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
  borrarFilasAction,
  cambiarTipoDeColumnaAction,
  duplicarColumnaAction,
  duplicarFilasAction,
  editarCeldaDeBaseAction,
  leerBaseDeDatosAction,
  moverFilaAction,
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

/** Colores de las opciones de Seleccionar (fondo y texto suaves, como en Notion), por su lugar en la lista. */
const COLORES_DE_OPCION = [
  "bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100",
  "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100",
  "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100",
  "bg-rose-100 text-rose-900 dark:bg-rose-900/50 dark:text-rose-100",
  "bg-violet-100 text-violet-900 dark:bg-violet-900/50 dark:text-violet-100",
  "bg-orange-100 text-orange-900 dark:bg-orange-900/50 dark:text-orange-100",
  "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100",
];

function colorDeOpcion(columna: ColumnaDeBase, opcion: string) {
  const lugar = (columna.opciones ?? []).indexOf(opcion);
  return COLORES_DE_OPCION[(lugar < 0 ? 0 : lugar) % COLORES_DE_OPCION.length];
}

function Etiqueta({ columna, opcion }: { columna: ColumnaDeBase; opcion: string }) {
  return (
    <span className={cn("inline-block max-w-full truncate rounded px-1.5 py-0.5 text-sm leading-5", colorDeOpcion(columna, opcion))}>
      {opcion}
    </span>
  );
}

/** El tipo Seleccionar: al tocar la celda, buscar una opción o crear una nueva (como en Notion). */
function SelectorDeOpcion({
  columna,
  valor,
  etiqueta,
  alGuardar,
}: {
  columna: ColumnaDeBase;
  valor: string;
  etiqueta: string;
  alGuardar: (texto: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const opciones = columna.opciones ?? [];
  const limpia = busqueda.trim();
  const visibles = opciones.filter((opcion) => opcion.toLowerCase().includes(limpia.toLowerCase()));
  const existe = opciones.some((opcion) => opcion.toLowerCase() === limpia.toLowerCase());
  const elegir = (texto: string) => {
    setAbierto(false);
    setBusqueda("");
    if (texto !== valor) alGuardar(texto);
  };

  return (
    <Popover.Root
      open={abierto}
      onOpenChange={(abrir) => {
        setAbierto(abrir);
        if (!abrir) setBusqueda("");
      }}
    >
      <Popover.Trigger
        className="flex h-10 w-full min-w-0 items-center px-2 text-left hover:bg-muted/60 data-[popup-open]:bg-sky-50 dark:data-[popup-open]:bg-sky-950/40"
        aria-label={etiqueta}
      >
        {valor ? <Etiqueta columna={columna} opcion={valor} /> : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="isolate z-[60] outline-none" side="bottom" align="start" sideOffset={0}>
          <Popover.Popup className="w-72 overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none">
            <div className="flex flex-wrap items-center gap-1 border-b bg-muted/50 px-2 py-1.5">
              {valor ? (
                <span className="flex items-center gap-1">
                  <Etiqueta columna={columna} opcion={valor} />
                  <button
                    type="button"
                    onClick={() => elegir("")}
                    className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                    aria-label="Quitar la opción"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ) : null}
              <input
                autoFocus
                value={busqueda}
                onChange={(evento) => setBusqueda(evento.target.value)}
                onKeyDown={(evento) => {
                  if (evento.key === "Enter" && limpia) {
                    evento.preventDefault();
                    elegir(visibles.find((opcion) => opcion.toLowerCase() === limpia.toLowerCase()) ?? visibles[0] ?? limpia);
                  }
                }}
                placeholder="Buscar una opción..."
                aria-label="Buscar una opción"
                className="h-8 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Selecciona o crea una opción</p>
              {visibles.map((opcion) => (
                <button
                  key={opcion}
                  type="button"
                  onClick={() => elegir(opcion)}
                  className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-muted"
                >
                  <Etiqueta columna={columna} opcion={opcion} />
                  {opcion === valor ? <Check className="ml-auto size-4 shrink-0" /> : null}
                </button>
              ))}
              {limpia && !existe ? (
                <button
                  type="button"
                  onClick={() => elegir(limpia)}
                  className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted"
                >
                  <span className="text-muted-foreground">Crear</span>
                  <span className={cn("rounded px-1.5 py-0.5", COLORES_DE_OPCION[opciones.length % COLORES_DE_OPCION.length])}>{limpia}</span>
                </button>
              ) : null}
            </div>
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
  /** Guarda y devuelve el texto como quedó, o null si falló. */
  alGuardar: (texto: string) => Promise<string | null>;
}) {
  if (columna.tipo === "lista") {
    return <SelectorDeOpcion columna={columna} valor={valor} etiqueta={etiqueta} alGuardar={(texto) => void alGuardar(texto)} />;
  }
  const calza = calzaConElTipo(columna, valor);
  const comun = {
    defaultValue: valor,
    "aria-label": etiqueta,
    title: calza ? undefined : `No es ${columna.tipo === "numero" ? "un número" : "una fecha"}: corrígelo`,
    onBlur: async (evento: React.FocusEvent<HTMLInputElement>) => {
      const campo = evento.target;
      if (campo.value === valor) return;
      const guardado = await alGuardar(campo.value);
      // Si falló vuelve lo de antes; un número o una fecha se ven como quedaron guardados ("2,5" → "2.5").
      campo.value = guardado ?? valor;
    },
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
  return <input {...comun} />;
}

/** «Abrir» una fila: sus campos uno debajo del otro, en un panel a la derecha (como una página de Notion). */
function PaginaDeFila({
  base,
  filaId,
  alCerrar,
  alGuardar,
  alBorrar,
}: {
  base: BaseDeDatosVista;
  filaId: string;
  alCerrar: () => void;
  alGuardar: (columnaId: string, texto: string) => Promise<string | null>;
  alBorrar: () => void;
}) {
  const fila = base.filas.find((candidata) => candidata.id === filaId);
  if (!fila) return null;
  const primera = base.columnas[0];
  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l bg-popover shadow-xl sm:w-[26rem]">
      <div className="flex shrink-0 items-center gap-1 px-3 py-2">
        <span className="text-xs tabular-nums text-muted-foreground">Fila {fila.numero}</span>
        <Button variant="ghost" size="sm" className="ml-auto h-9 text-destructive md:h-8" onClick={alBorrar}>
          <Trash2 />
          Borrar fila
        </Button>
        <Button variant="ghost" size="icon" className="size-10 md:size-8" onClick={alCerrar} aria-label="Cerrar la fila">
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <p className="mb-4 break-words text-2xl font-bold">
          {primera ? fila.valores[primera.id] || <span className="text-muted-foreground/50">Sin {primera.nombre.toLowerCase()}</span> : null}
        </p>
        <div className="grid gap-1">
          {base.columnas.map((columna) => {
            const Icono = ICONO_DEL_TIPO[columna.tipo];
            return (
              <div key={columna.id} className="grid grid-cols-[9rem_1fr] items-center gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                  <Icono className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{columna.nombre}</span>
                </span>
                <div className="min-w-0 rounded-md hover:bg-muted/50">
                  <Celda
                    key={`${columna.tipo}-${fila.valores[columna.id] ?? ""}`}
                    columna={columna}
                    valor={fila.valores[columna.id] ?? ""}
                    etiqueta={columna.nombre}
                    alGuardar={(texto) => alGuardar(columna.id, texto)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
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
  const [elegidas, setElegidas] = useState<Set<string>>(() => new Set());
  const [filaAbierta, setFilaAbierta] = useState<string | null>(null);
  const [arrastrada, setArrastrada] = useState<string | null>(null);
  const [sobre, setSobre] = useState<{ id: string; lado: "antes" | "despues" } | null>(null);

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

  // Las elegidas que siguen existiendo (una borrada desde otro lado deja de contar).
  const elegidasVivas = useMemo(
    () => (base ? base.filas.filter((fila) => elegidas.has(fila.id)).map((fila) => fila.id) : []),
    [base, elegidas],
  );

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

  /** Un cambio de orden (agregar, borrar, duplicar, mover) devuelve la tabla entera: los # se renumeran. */
  const cambioDeFilas = async (accion: () => Promise<{ ok: true; base: BaseDeDatosVista } | { ok: false; error: string }>) => {
    const resultado = await conCarga(() => accion().catch(() => SIN_CONEXION));
    if (!resultado) return false;
    if (!resultado.ok) {
      toast.error(resultado.error);
      return false;
    }
    setBase(() => resultado.base);
    return true;
  };

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

  const agregarFila = (despuesDe?: string) => {
    if (!base) return;
    void cambioDeFilas(() => agregarFilaAction(base.tarjetaId, despuesDe ?? null));
  };

  const borrarFilas = async (ids: string[]) => {
    if (!base || !ids.length) return;
    const texto = ids.length === 1 ? "¿Borrar esta fila?" : `¿Borrar ${ids.length} filas?`;
    if (!window.confirm(`${texto} No se puede deshacer.`)) return;
    if (await cambioDeFilas(() => borrarFilasAction(base.tarjetaId, ids))) {
      setElegidas(new Set());
      if (filaAbierta && ids.includes(filaAbierta)) setFilaAbierta(null);
    }
  };

  const duplicarFilas = async (ids: string[]) => {
    if (!base || !ids.length) return;
    if (await cambioDeFilas(() => duplicarFilasAction(base.tarjetaId, ids))) setElegidas(new Set());
  };

  const soltar = (destinoId: string, lado: "antes" | "despues") => {
    const filaId = arrastrada;
    setArrastrada(null);
    setSobre(null);
    if (!base || !filaId || filaId === destinoId) return;
    void cambioDeFilas(() => moverFilaAction(base.tarjetaId, filaId, destinoId, lado));
  };

  const guardarCelda = async (filaId: string, columnaId: string, texto: string): Promise<string | null> => {
    if (!base) return null;
    const resultado = await editarCeldaDeBaseAction(base.tarjetaId, filaId, columnaId, texto).catch(() => SIN_CONEXION);
    if (!resultado.ok) {
      toast.error(resultado.error);
      return null;
    }
    setBase((actual) => ({
      ...actual,
      ...(resultado.columnas ? { columnas: resultado.columnas } : {}),
      filas: actual.filas.map((fila) =>
        fila.id === filaId ? { ...fila, valores: { ...fila.valores, [columnaId]: resultado.texto } } : fila,
      ),
    }));
    return resultado.texto;
  };

  const alternar = (filaId: string) =>
    setElegidas((actual) => {
      const nuevo = new Set(actual);
      if (nuevo.has(filaId)) nuevo.delete(filaId);
      else nuevo.add(filaId);
      return nuevo;
    });

  return (
    <Dialog
      open={tarjetaId !== null}
      onOpenChange={(abrir) => {
        if (abrir) return;
        setElegidas(new Set());
        setFilaAbierta(null);
        alCerrar();
      }}
    >
      <DialogContent showCloseButton={false} className="flex h-[90dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
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
            <div className="shrink-0 px-4 md:px-6">
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
              {/* La barra de las elegidas (como en Notion): sale apenas hay una casilla marcada. */}
              <div className="flex h-11 items-center">
                {elegidasVivas.length ? (
                  <div className="flex items-center overflow-hidden rounded-lg border bg-popover text-sm shadow-sm">
                    <span className="px-3 py-1.5 font-medium text-sky-600 dark:text-sky-400">
                      {elegidasVivas.length} {elegidasVivas.length === 1 ? "seleccionada" : "seleccionadas"}
                    </span>
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={() => void duplicarFilas(elegidasVivas)}
                      className="flex h-9 items-center gap-1.5 border-l px-3 hover:bg-muted"
                      title="Duplicar"
                    >
                      <Copy className="size-4" />
                      <span className="hidden sm:inline">Duplicar</span>
                    </button>
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={() => void borrarFilas(elegidasVivas)}
                      className="flex h-9 items-center gap-1.5 border-l px-3 text-destructive hover:bg-muted"
                      title="Borrar"
                    >
                      <Trash2 className="size-4" />
                      <span className="hidden sm:inline">Borrar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setElegidas(new Set())}
                      className="flex h-9 items-center border-l px-2.5 text-muted-foreground hover:bg-muted"
                      aria-label="Quitar la selección"
                      title="Quitar la selección"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto pr-2 md:pr-4">
              <table className="w-max min-w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-popover">
                  <tr className="border-b border-border/70">
                    {/* Sin casilla de «todas» (Alex, 28-nov-2026): solo el espacio de +, ⠿ y la casilla de cada fila. */}
                    <th className="w-[4.75rem] p-0" />
                    <th className="w-7 border-r border-border/50 px-0.5 text-center text-xs font-normal text-muted-foreground">#</th>
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
                  {filasVisibles.map((fila) => {
                    const elegida = elegidas.has(fila.id);
                    const marca = sobre?.id === fila.id ? sobre.lado : null;
                    return (
                      <tr
                        key={fila.id}
                        className={cn(
                          "group border-b border-border/70",
                          elegida && "bg-sky-50 dark:bg-sky-950/30",
                          arrastrada === fila.id && "opacity-50",
                          marca === "antes" && "shadow-[inset_0_2px_0_0_var(--color-sky-500)]",
                          marca === "despues" && "shadow-[inset_0_-2px_0_0_var(--color-sky-500)]",
                        )}
                        onDragOver={(evento) => {
                          if (!arrastrada) return;
                          evento.preventDefault();
                          const caja = evento.currentTarget.getBoundingClientRect();
                          const lado = evento.clientY < caja.top + caja.height / 2 ? "antes" : "despues";
                          if (sobre?.id !== fila.id || sobre.lado !== lado) setSobre({ id: fila.id, lado });
                        }}
                        onDrop={(evento) => {
                          evento.preventDefault();
                          if (sobre) soltar(fila.id, sobre.lado);
                        }}
                      >
                        <td className="p-0">
                          <div className="flex h-10 items-center justify-end gap-0.5 pr-1">
                            <button
                              type="button"
                              disabled={ocupado}
                              onClick={() => agregarFila(fila.id)}
                              className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-muted focus:opacity-100 group-hover:opacity-100"
                              aria-label={`Agregar una fila debajo de la ${fila.numero}`}
                              title="Agregar una fila debajo"
                            >
                              <Plus className="size-4" />
                            </button>
                            <span
                              draggable={!orden && !ocupado}
                              onDragStart={(evento) => {
                                evento.dataTransfer.effectAllowed = "move";
                                evento.dataTransfer.setData("text/plain", fila.id);
                                setArrastrada(fila.id);
                              }}
                              onDragEnd={() => {
                                setArrastrada(null);
                                setSobre(null);
                              }}
                              className={cn(
                                "flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100",
                                orden ? "cursor-not-allowed" : "cursor-grab hover:bg-muted active:cursor-grabbing",
                              )}
                              title={orden ? "Quita el orden de la columna para arrastrar" : "Arrastrar para mover"}
                              aria-hidden
                            >
                              <GripVertical className="size-4" />
                            </span>
                            <input
                              type="checkbox"
                              checked={elegida}
                              onChange={() => alternar(fila.id)}
                              aria-label={`Seleccionar la fila ${fila.numero}`}
                              className={cn("size-4 accent-sky-600", !elegida && "opacity-0 focus:opacity-100 group-hover:opacity-100")}
                            />
                          </div>
                        </td>
                        <td className="w-7 border-r border-border/50 px-0.5 text-center text-xs tabular-nums text-muted-foreground">{fila.numero}</td>
                        {base.columnas.map((columna, indice) => (
                          <td key={columna.id} className={cn("border-r border-border/50 p-0", indice === 0 && "relative")}>
                            <Celda
                              key={`${columna.tipo}-${fila.valores[columna.id] ?? ""}`}
                              columna={columna}
                              valor={fila.valores[columna.id] ?? ""}
                              etiqueta={`${columna.nombre}, fila ${fila.numero}`}
                              alGuardar={(texto) => guardarCelda(fila.id, columna.id, texto)}
                            />
                            {indice === 0 ? (
                              <button
                                type="button"
                                onClick={() => setFilaAbierta(fila.id)}
                                className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1 rounded border bg-popover px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase opacity-0 shadow-sm hover:bg-muted focus:opacity-100 group-hover:opacity-100"
                              >
                                <PanelRight className="size-3.5" />
                                Abrir
                              </button>
                            ) : null}
                          </td>
                        ))}
                        <td />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => agregarFila()}
                className="ml-[4.75rem] flex h-10 w-[calc(100%-4.75rem)] items-center gap-2 px-2 text-sm text-muted-foreground hover:bg-muted"
              >
                <Plus className="size-4" />
                Nueva fila
              </button>
            </div>
            <div className="shrink-0 px-4 py-2 text-right text-xs tabular-nums text-muted-foreground md:px-6">
              {base.total} {base.total === 1 ? "fila" : "filas"}
            </div>
            {filaAbierta ? (
              <PaginaDeFila
                base={base}
                filaId={filaAbierta}
                alCerrar={() => setFilaAbierta(null)}
                alGuardar={(columnaId, texto) => guardarCelda(filaAbierta, columnaId, texto)}
                alBorrar={() => void borrarFilas([filaAbierta])}
              />
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
