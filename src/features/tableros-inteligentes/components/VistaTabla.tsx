"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Lock, Save, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { cambiarResponsableAction } from "@/app/actions/tableros-inteligentes-actions";
import {
  borrarVistaAction,
  cambiarEstadoDesdeVistaAction,
  editarCeldaAction,
  guardarVistaAction,
} from "@/app/actions/tablero-ia-vistas-actions";
import { NOMBRE_DEL_ESTADO, esEstado, type EstadoTarjetaTablero, type MiembroDelNegocio } from "../services/reglas";
import type { TipoVista } from "../services/tableros";
import {
  COLUMNAS,
  CONFIG_VACIA,
  NOMBRE_DE_LA_COLUMNA,
  VISTAS_DE_FABRICA,
  agruparFilas,
  esColumna,
  estadosPermitidos,
  motivoSinCambios,
  textoDeColumna,
  valoresDeColumna,
  type Columna,
  type ConfigDeTabla,
  type FilaDeTabla,
  type VistaGuardada,
} from "../services/vistas-de-tabla";
import { COLOR_DEL_ESTADO } from "./colores";
import { IconoDeTipo } from "./IconoDeTipo";

/*
  La vista TABLA del Tablero IA (estilo Notion, 2-nov-2026): una fila por tarjeta con Código, Título,
  Tipo, Área, Estado, Prioridad, Responsable, Fecha y De qué cuelga. Estado, Responsable, Área y Fecha se
  cambian en la misma celda (quien edita el tablero); tocar la fila abre la tarjeta como página ancha.
  Arriba, la barra de la vista: buscador, vistas guardadas (las de fábrica y las de cada persona),
  filtros y "Agrupar por" (la comparten Tabla, Tablero y Calendario). Ordenar: tocar el título de la
  columna (sube, baja, sin orden). Todo se filtra y ordena en el navegador con lo que ya llega cada 5 s.
*/

/* ── Cambiar el estado (lo usan la tabla y el kanban) ── */

/**
 * Cambia el estado con la regla del servidor. Antes de dejar una tarjeta "Por aprobar" pide confirmación
 * (puede hacer que el Coordinador arranque solo). Devuelve true si quedó cambiado.
 */
export function useCambioDeEstado(alCambiar: () => Promise<void> | void) {
  const [pendiente, setPendiente] = useState<{
    fila: FilaDeTabla;
    estado: EstadoTarjetaTablero;
    resolver: (ok: boolean) => void;
  } | null>(null);

  const guardar = async (fila: FilaDeTabla, estado: EstadoTarjetaTablero) => {
    const resultado = await cambiarEstadoDesdeVistaAction(fila.id, estado, fila.estado ?? "");
    if (!resultado.ok) {
      toast.error(resultado.error);
      await alCambiar();
      return false;
    }
    toast.success(
      resultado.aprobadaSola
        ? `Quedó en ${NOMBRE_DEL_ESTADO[estado]} y se aprobó sola por la regla del dueño`
        : `Quedó en ${NOMBRE_DEL_ESTADO[estado]}`,
    );
    await alCambiar();
    return true;
  };

  const cambiar = (fila: FilaDeTabla, estado: EstadoTarjetaTablero): Promise<boolean> => {
    if (estado !== "POR_APROBAR") return guardar(fila, estado);
    return new Promise((resolver) => setPendiente({ fila, estado, resolver }));
  };

  const cerrar = (confirmado: boolean) => {
    if (!pendiente) return;
    const { fila, estado, resolver } = pendiente;
    setPendiente(null);
    if (confirmado) void guardar(fila, estado).then(resolver);
    else resolver(false);
  };

  const dialogo = (
    <Dialog open={pendiente !== null} onOpenChange={(abrir) => (!abrir ? cerrar(false) : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Dejarla “Por aprobar”?</DialogTitle>
          <DialogDescription>
            {pendiente?.fila.conRepo
              ? `“${pendiente.fila.titulo}” tiene repo: al quedar Por aprobar, el Coordinador puede aprobarla y arrancar solo, según las reglas de hoy.`
              : `“${pendiente?.fila.titulo ?? ""}” queda esperando la aprobación.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" className="h-10 md:h-8" onClick={() => cerrar(false)}>
            Cancelar
          </Button>
          <Button className="h-10 md:h-8" onClick={() => cerrar(true)}>
            Sí, dejarla Por aprobar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { cambiar, dialogo };
}

/** El estado como pastilla de color (o "—" en una carpeta). */
export function PastillaDeEstado({ estado, className }: { estado: EstadoTarjetaTablero | null; className?: string }) {
  if (!estado) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium", COLOR_DEL_ESTADO[estado].pastilla, className)}>
      {NOMBRE_DEL_ESTADO[estado]}
    </span>
  );
}

/** Para que tocar un menú de la celda no abra la tarjeta. */
const sinAbrir = { onClick: (evento: { stopPropagation: () => void }) => evento.stopPropagation() };

/** El menú de Estado: solo los cambios que la regla deja. Sin ninguno, el candado con el motivo. */
export function CeldaEstado({
  fila,
  editable,
  cambiar,
}: {
  fila: FilaDeTabla;
  editable: boolean;
  cambiar: (fila: FilaDeTabla, estado: EstadoTarjetaTablero) => Promise<boolean>;
}) {
  const [guardando, setGuardando] = useState<EstadoTarjetaTablero | null>(null);
  if (!fila.estado) return <PastillaDeEstado estado={null} />;
  const opciones = editable ? estadosPermitidos(fila) : [];
  if (!opciones.length) {
    const motivo = editable ? motivoSinCambios(fila) : null;
    return motivo ? (
      <button
        type="button"
        title={motivo}
        aria-label={`${NOMBRE_DEL_ESTADO[fila.estado]}: no se puede cambiar. ${motivo}`}
        onClick={(evento) => {
          evento.stopPropagation();
          toast.info(motivo);
        }}
        className="inline-flex min-h-10 items-center gap-1 md:min-h-0"
      >
        <PastillaDeEstado estado={fila.estado} />
        <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    ) : (
      <PastillaDeEstado estado={fila.estado} />
    );
  }
  return (
    <NativeSelect
      size="sm"
      aria-label={`Estado de ${fila.titulo}`}
      className="w-36"
      value={guardando ?? fila.estado}
      disabled={guardando !== null}
      {...sinAbrir}
      onChange={async (evento) => {
        const valor = evento.target.value;
        if (!esEstado(valor) || valor === fila.estado) return;
        setGuardando(valor);
        await cambiar(fila, valor);
        setGuardando(null);
      }}
    >
      <NativeSelectOption value={fila.estado}>{NOMBRE_DEL_ESTADO[fila.estado]}</NativeSelectOption>
      {opciones.map((estado) => (
        <NativeSelectOption key={estado} value={estado}>
          {NOMBRE_DEL_ESTADO[estado]}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** El menú de Responsable (cambiarResponsableAction, la misma acción de la ficha). */
function CeldaResponsable({
  fila,
  editable,
  miembros,
  alCambiar,
}: {
  fila: FilaDeTabla;
  editable: boolean;
  miembros: MiembroDelNegocio[];
  alCambiar: () => Promise<void> | void;
}) {
  const [guardando, setGuardando] = useState<string | null>(null);
  if (!editable) return <span className={cn(!fila.responsable && "text-muted-foreground")}>{fila.responsable ?? "—"}</span>;
  const real = fila.responsableId ?? "";
  return (
    <NativeSelect
      size="sm"
      aria-label={`Responsable de ${fila.titulo}`}
      className="w-40"
      value={guardando ?? real}
      disabled={guardando !== null}
      {...sinAbrir}
      onChange={async (evento) => {
        const valor = evento.target.value;
        if (valor === real) return;
        setGuardando(valor);
        const resultado = await cambiarResponsableAction(fila.id, valor || null);
        if (resultado.ok) toast.success(valor ? "Tarjeta asignada" : "Sin responsable");
        else toast.error(resultado.error);
        await alCambiar();
        setGuardando(null);
      }}
    >
      <NativeSelectOption value="">Nadie</NativeSelectOption>
      {fila.responsableId && !miembros.some((miembro) => miembro.userId === fila.responsableId) ? (
        <NativeSelectOption value={fila.responsableId}>{fila.responsable ?? "Otra persona"}</NativeSelectOption>
      ) : null}
      {miembros.map((miembro) => (
        <NativeSelectOption key={miembro.userId} value={miembro.userId}>
          {miembro.nombre}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

const NUEVA_AREA = "__nueva__";

/** El menú de Área: las áreas que ya hay en el tablero, "Sin área" o una nueva (se escribe ahí mismo). */
function CeldaArea({
  fila,
  editable,
  areas,
  alCambiar,
}: {
  fila: FilaDeTabla;
  editable: boolean;
  areas: string[];
  alCambiar: () => Promise<void> | void;
}) {
  const [guardando, setGuardando] = useState<string | null>(null);
  const [escribiendo, setEscribiendo] = useState(false);
  const [texto, setTexto] = useState("");
  if (!editable) return <span className={cn(!fila.area && "text-muted-foreground")}>{fila.area ?? "—"}</span>;
  const real = fila.area ?? "";

  const guardar = async (valor: string) => {
    setEscribiendo(false);
    if (valor.trim() === real) return;
    setGuardando(valor.trim());
    const resultado = await editarCeldaAction(fila.id, { area: valor.trim() });
    if (resultado.ok) toast.success(valor.trim() ? `Área: ${valor.trim()}` : "Sin área");
    else toast.error(resultado.error);
    await alCambiar();
    setGuardando(null);
  };

  if (escribiendo) {
    return (
      <form
        className="flex w-40 items-center gap-1"
        {...sinAbrir}
        onSubmit={(evento) => {
          evento.preventDefault();
          void guardar(texto);
        }}
      >
        <Input
          autoFocus
          value={texto}
          maxLength={60}
          placeholder="Nueva área"
          aria-label={`Nueva área de ${fila.titulo}`}
          className="h-7"
          onChange={(evento) => setTexto(evento.target.value)}
          onKeyDown={(evento) => {
            if (evento.key === "Escape") setEscribiendo(false);
          }}
        />
        <Button type="submit" size="icon-sm" variant="ghost" aria-label="Guardar área">
          <Save />
        </Button>
      </form>
    );
  }
  const opciones = real && !areas.includes(real) ? [real, ...areas] : areas;
  return (
    <NativeSelect
      size="sm"
      aria-label={`Área de ${fila.titulo}`}
      className="w-36"
      value={guardando ?? real}
      disabled={guardando !== null}
      {...sinAbrir}
      onChange={(evento) => {
        const valor = evento.target.value;
        if (valor === NUEVA_AREA) {
          setTexto("");
          setEscribiendo(true);
          return;
        }
        void guardar(valor);
      }}
    >
      <NativeSelectOption value="">Sin área</NativeSelectOption>
      {opciones.map((area) => (
        <NativeSelectOption key={area} value={area}>
          {area}
        </NativeSelectOption>
      ))}
      <NativeSelectOption value={NUEVA_AREA}>Otra área…</NativeSelectOption>
    </NativeSelect>
  );
}

const DIA_CORTO = new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
/** "2026-11-02" -> "2 nov 2026" (el día ya viene en hora de Colombia: se muestra tal cual). */
export const textoDelDia = (dia: string) => DIA_CORTO.format(new Date(`${dia}T00:00:00Z`));

/** La fecha con el selector de día del navegador (vacío = sin fecha). */
function CeldaFecha({ fila, editable, alCambiar }: { fila: FilaDeTabla; editable: boolean; alCambiar: () => Promise<void> | void }) {
  const [guardando, setGuardando] = useState<string | null>(null);
  if (!editable) return <span className={cn(!fila.fecha && "text-muted-foreground")}>{fila.fecha ? textoDelDia(fila.fecha) : "—"}</span>;
  const real = fila.fecha ?? "";
  return (
    <Input
      type="date"
      aria-label={`Fecha de ${fila.titulo}`}
      className="h-7 w-36"
      value={guardando ?? real}
      disabled={guardando !== null}
      {...sinAbrir}
      onChange={async (evento) => {
        const valor = evento.target.value;
        if (valor === real) return;
        setGuardando(valor);
        const resultado = await editarCeldaAction(fila.id, { fecha: valor });
        if (resultado.ok) toast.success(valor ? `Fecha: ${textoDelDia(valor)}` : "Sin fecha");
        else toast.error(resultado.error);
        await alCambiar();
        setGuardando(null);
      }}
    />
  );
}

/* ── La barra de la vista: buscador, vistas guardadas, filtros y agrupar ── */

type PropsBarra = {
  filas: FilaDeTabla[];
  config: ConfigDeTabla;
  setConfig: (config: ConfigDeTabla) => void;
  vistaActiva: string | null;
  setVistaActiva: (id: string | null) => void;
  guardadas: VistaGuardada[];
  setGuardadas: (guardadas: VistaGuardada[]) => void;
  /** Agrupar solo existe en la tabla. */
  conAgrupar: boolean;
  /** Cuántas quedan con lo elegido. */
  cuantas: number;
};

export function BarraDeLaVista({
  filas,
  config,
  setConfig,
  vistaActiva,
  setVistaActiva,
  guardadas,
  setGuardadas,
  conAgrupar,
  cuantas,
}: PropsBarra) {
  const [columnaDelFiltro, setColumnaDelFiltro] = useState<Columna | "">("");
  const [guardarAbierto, setGuardarAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);

  const todas = [...VISTAS_DE_FABRICA, ...guardadas];
  const activa = todas.find((vista) => vista.id === vistaActiva) ?? null;
  const esPropia = activa !== null && !activa.id.startsWith("fabrica:");
  const opcionesDelFiltro = useMemo(
    () => (columnaDelFiltro ? valoresDeColumna(filas, columnaDelFiltro) : []),
    [columnaDelFiltro, filas],
  );

  /** Un cambio a mano deja de ser la vista elegida (se puede guardar como otra). */
  const cambiar = (nueva: ConfigDeTabla) => {
    setConfig(nueva);
    setVistaActiva(null);
  };

  const agregarFiltro = (columna: Columna, valor: string) => {
    const existente = config.filtros.find((filtro) => filtro.columna === columna);
    const filtros = existente
      ? config.filtros.map((filtro) =>
          filtro.columna === columna && !filtro.valores.includes(valor) ? { ...filtro, valores: [...filtro.valores, valor] } : filtro,
        )
      : [...config.filtros, { columna, valores: [valor] }];
    cambiar({ ...config, filtros });
    setColumnaDelFiltro("");
  };

  const quitarValor = (columna: Columna, valor: string) =>
    cambiar({
      ...config,
      filtros: config.filtros
        .map((filtro) => (filtro.columna === columna ? { ...filtro, valores: filtro.valores.filter((v) => v !== valor) } : filtro))
        .filter((filtro) => filtro.valores.length > 0),
    });

  const textoDelValor = (columna: Columna, valor: string) =>
    columna === "estado" && esEstado(valor) ? NOMBRE_DEL_ESTADO[valor] : valor || "Vacío";

  const guardarVista = async () => {
    setGuardando(true);
    const resultado = await guardarVistaAction(nombre, config);
    setGuardando(false);
    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }
    setGuardadas(resultado.guardadas);
    const nueva = resultado.guardadas.find((vista) => vista.nombre.toLowerCase() === nombre.trim().toLowerCase());
    setVistaActiva(nueva?.id ?? null);
    setGuardarAbierto(false);
    toast.success(`Vista “${nombre.trim()}” guardada`);
  };

  const borrarVista = async () => {
    if (!activa || !esPropia) return;
    const resultado = await borrarVistaAction(activa.id);
    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }
    setGuardadas(resultado.guardadas);
    setVistaActiva(null);
    toast.success(`Vista “${activa.nombre}” borrada`);
  };

  const hayAlgo = config.busqueda !== "" || config.filtros.length > 0 || config.orden !== null || config.agrupar !== null;

  return (
    <div className="shrink-0 space-y-2 border-b border-border bg-card px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-48">
          <span className="sr-only">Buscar tarjetas</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={config.busqueda}
            placeholder="Buscar por título, detalle o código (T-12)"
            className="h-10 pl-8 md:h-8"
            onChange={(evento) => cambiar({ ...config, busqueda: evento.target.value })}
          />
        </label>
        <NativeSelect
          aria-label="Vista guardada"
          className="w-44 [&_select]:h-10 md:[&_select]:h-8"
          value={vistaActiva ?? ""}
          onChange={(evento) => {
            const elegida = todas.find((vista) => vista.id === evento.target.value);
            setConfig(elegida ? elegida.config : CONFIG_VACIA);
            setVistaActiva(elegida?.id ?? null);
          }}
        >
          <NativeSelectOption value="">Todas las tarjetas</NativeSelectOption>
          {todas.map((vista) => (
            <NativeSelectOption key={vista.id} value={vista.id}>
              {vista.nombre}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {esPropia ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-10 text-muted-foreground md:size-8"
            onClick={() => void borrarVista()}
            aria-label={`Borrar la vista ${activa?.nombre ?? ""}`}
            title="Borrar esta vista"
          >
            <Trash2 />
          </Button>
        ) : null}
        <Button
          variant="outline"
          className="h-10 md:h-8"
          disabled={!hayAlgo}
          title={hayAlgo ? "Guardar la búsqueda, los filtros, el orden y los grupos con un nombre" : "Elige un filtro, un orden o un grupo para guardarlo"}
          onClick={() => {
            setNombre(activa && esPropia ? activa.nombre : "");
            setGuardarAbierto(true);
          }}
        >
          <Save />
          Guardar vista
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <NativeSelect
          size="sm"
          aria-label="Filtrar por columna"
          className="[&_select]:h-10 md:[&_select]:h-7"
          value={columnaDelFiltro}
          onChange={(evento) => setColumnaDelFiltro(esColumna(evento.target.value) ? evento.target.value : "")}
        >
          <NativeSelectOption value="">+ Filtro</NativeSelectOption>
          {COLUMNAS.filter((columna) => columna !== "titulo" && columna !== "codigo").map((columna) => (
            <NativeSelectOption key={columna} value={columna}>
              {NOMBRE_DE_LA_COLUMNA[columna]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {columnaDelFiltro ? (
          <NativeSelect
            size="sm"
            aria-label={`Valor de ${NOMBRE_DE_LA_COLUMNA[columnaDelFiltro]}`}
            className="[&_select]:h-10 md:[&_select]:h-7"
            value=""
            onChange={(evento) => {
              const elegido = opcionesDelFiltro.find((opcion) => `v:${opcion.valor}` === evento.target.value);
              if (elegido) agregarFiltro(columnaDelFiltro, elegido.valor);
            }}
          >
            <NativeSelectOption value="">{NOMBRE_DE_LA_COLUMNA[columnaDelFiltro]}: elige…</NativeSelectOption>
            {opcionesDelFiltro.map((opcion) => (
              <NativeSelectOption key={opcion.valor || "vacio"} value={`v:${opcion.valor}`}>
                {opcion.valor ? opcion.texto : "Vacío"}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : null}
        {config.filtros.flatMap((filtro) =>
          filtro.valores.map((valor) => (
            <span
              key={`${filtro.columna}:${valor}`}
              className="flex min-h-10 items-center gap-1 rounded-full border border-border bg-background py-0.5 pr-1 pl-2.5 font-medium md:min-h-7"
            >
              <span className="text-muted-foreground">{NOMBRE_DE_LA_COLUMNA[filtro.columna]}:</span>
              {textoDelValor(filtro.columna, valor)}
              <button
                type="button"
                onClick={() => quitarValor(filtro.columna, valor)}
                className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground md:size-5"
                aria-label={`Quitar el filtro ${NOMBRE_DE_LA_COLUMNA[filtro.columna]}: ${textoDelValor(filtro.columna, valor)}`}
              >
                <X className="size-3.5" />
              </button>
            </span>
          )),
        )}
        {conAgrupar ? (
          <NativeSelect
            size="sm"
            aria-label="Agrupar por"
            className="[&_select]:h-10 md:[&_select]:h-7"
            value={config.agrupar ?? ""}
            onChange={(evento) => cambiar({ ...config, agrupar: esColumna(evento.target.value) ? evento.target.value : null })}
          >
            <NativeSelectOption value="">Sin agrupar</NativeSelectOption>
            {COLUMNAS.filter((columna) => columna !== "titulo" && columna !== "codigo").map((columna) => (
              <NativeSelectOption key={columna} value={columna}>
                Agrupar por {NOMBRE_DE_LA_COLUMNA[columna]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : null}
        {hayAlgo ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-10 text-muted-foreground md:h-7"
            onClick={() => {
              setConfig(CONFIG_VACIA);
              setVistaActiva(null);
            }}
          >
            Limpiar
          </Button>
        ) : null}
        <span className="ml-auto text-muted-foreground tabular-nums">
          {cuantas === 1 ? "1 tarjeta" : `${cuantas} tarjetas`}
        </span>
      </div>

      <Dialog open={guardarAbierto} onOpenChange={setGuardarAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Guardar vista</DialogTitle>
            <DialogDescription>
              Guarda la búsqueda, los filtros, el orden y los grupos de ahora. Solo la ves tú, en cualquier navegador.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(evento) => {
              evento.preventDefault();
              void guardarVista();
            }}
          >
            <Input
              autoFocus
              value={nombre}
              maxLength={40}
              placeholder="Por ejemplo: Ideas de ventas"
              aria-label="Nombre de la vista"
              className="h-10"
              onChange={(evento) => setNombre(evento.target.value)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" className="h-10 md:h-8" onClick={() => setGuardarAbierto(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="h-10 md:h-8" disabled={guardando || !nombre.trim()}>
                {guardando ? "Guardando…" : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── La tabla ── */

type PropsTabla = {
  /** Las filas ya buscadas, filtradas y ordenadas. */
  filas: FilaDeTabla[];
  /** Todas las filas del tablero (para las áreas que ya existen). */
  todas: FilaDeTabla[];
  tipos: ReadonlyMap<string, TipoVista>;
  config: ConfigDeTabla;
  setConfig: (config: ConfigDeTabla) => void;
  setVistaActiva: (id: string | null) => void;
  miembros: MiembroDelNegocio[];
  /** Quien edita el tablero: cambia estado, responsable, área y fecha en la celda. */
  editable: boolean;
  /** Tocar una fila (o "De qué cuelga") abre la tarjeta como página. */
  alAbrir: (id: string) => void;
  alCambiar: () => Promise<void> | void;
  hayTarjetas: boolean;
};

export function VistaTabla({
  filas,
  todas,
  tipos,
  config,
  setConfig,
  setVistaActiva,
  miembros,
  editable,
  alAbrir,
  alCambiar,
  hayTarjetas,
}: PropsTabla) {
  const { cambiar, dialogo } = useCambioDeEstado(alCambiar);
  const areas = useMemo(
    () => [...new Set(todas.map((fila) => fila.area).filter((area): area is string => Boolean(area)))].sort((a, b) => a.localeCompare(b, "es")),
    [todas],
  );
  const grupos = useMemo(
    () => (config.agrupar ? agruparFilas(filas, config.agrupar) : [{ clave: "todas", nombre: "", filas }]),
    [config.agrupar, filas],
  );

  /** Tocar el título de una columna: sube, baja y vuelve a sin orden. */
  const ordenarPor = (columna: Columna) => {
    const actual = config.orden?.columna === columna ? config.orden.direccion : null;
    const orden = actual === null ? { columna, direccion: "asc" as const } : actual === "asc" ? { columna, direccion: "desc" as const } : null;
    setConfig({ ...config, orden });
    setVistaActiva(null);
  };

  if (!hayTarjetas) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        El tablero está vacío. Las ideas que anote Claude aparecen acá en unos segundos.
      </div>
    );
  }

  const celda = (fila: FilaDeTabla, columna: Columna): ReactNode => {
    switch (columna) {
      case "codigo":
        return <span className="text-xs tabular-nums text-muted-foreground">{fila.codigo || "—"}</span>;
      case "titulo":
        return <span className="line-clamp-2 min-w-48 font-medium">{fila.titulo}</span>;
      case "tipo": {
        const tipo = tipos.get(fila.tipoId);
        return tipo ? (
          <span className="flex items-center gap-1 whitespace-nowrap">
            <IconoDeTipo icono={tipo.icono} color={tipo.color} className="size-3.5" />
            {tipo.nombre}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      }
      case "area":
        return <CeldaArea fila={fila} editable={editable} areas={areas} alCambiar={alCambiar} />;
      case "estado":
        return <CeldaEstado fila={fila} editable={editable} cambiar={cambiar} />;
      case "prioridad":
        return fila.prioridad === "Urgente" ? (
          <span className="inline-flex rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:border-red-600 dark:bg-red-900 dark:text-red-100">
            Urgente
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Normal</span>
        );
      case "responsable":
        return <CeldaResponsable fila={fila} editable={editable} miembros={miembros} alCambiar={alCambiar} />;
      case "fecha":
        return <CeldaFecha fila={fila} editable={editable} alCambiar={alCambiar} />;
      case "madre":
        return fila.madreId ? (
          <button
            type="button"
            onClick={(evento) => {
              evento.stopPropagation();
              alAbrir(fila.madreId!);
            }}
            className="line-clamp-2 max-w-48 text-left text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {fila.madre}
          </button>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {filas.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-muted-foreground">
          Ninguna tarjeta coincide con la búsqueda o los filtros. Toca “Limpiar” para verlas todas.
        </div>
      ) : (
        <table className="w-full min-w-[64rem] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border">
              {COLUMNAS.map((columna) => {
                const direccion = config.orden?.columna === columna ? config.orden.direccion : null;
                const Flecha = direccion === "asc" ? ArrowUp : direccion === "desc" ? ArrowDown : ChevronsUpDown;
                return (
                  <th
                    key={columna}
                    scope="col"
                    aria-sort={direccion === "asc" ? "ascending" : direccion === "desc" ? "descending" : "none"}
                    className="px-2 py-1 text-left text-xs font-medium whitespace-nowrap text-muted-foreground"
                  >
                    <button
                      type="button"
                      onClick={() => ordenarPor(columna)}
                      className="flex min-h-9 items-center gap-1 rounded-md px-1 hover:bg-muted hover:text-foreground"
                      title={`Ordenar por ${NOMBRE_DE_LA_COLUMNA[columna]}`}
                    >
                      {NOMBRE_DE_LA_COLUMNA[columna]}
                      <Flecha className={cn("size-3.5", !direccion && "opacity-40")} aria-hidden />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {grupos.map((grupo) => (
              <GrupoDeTabla key={grupo.clave || "vacio"} grupo={grupo} agrupado={config.agrupar !== null} columnaDelGrupo={config.agrupar}>
                {grupo.filas.map((fila) => (
                  <tr
                    key={fila.id}
                    onClick={() => alAbrir(fila.id)}
                    className="cursor-pointer border-b border-border hover:bg-muted/50"
                  >
                    {COLUMNAS.map((columna) => (
                      <td key={columna} className="px-3 py-1.5 align-middle">
                        {celda(fila, columna)}
                      </td>
                    ))}
                  </tr>
                ))}
              </GrupoDeTabla>
            ))}
          </tbody>
        </table>
      )}
      {editable ? null : (
        <p className="px-3 py-2 text-xs text-muted-foreground">Solo quien edita este tablero cambia las celdas.</p>
      )}
      {dialogo}
    </div>
  );
}

function GrupoDeTabla({
  grupo,
  agrupado,
  columnaDelGrupo,
  children,
}: {
  grupo: { clave: string; nombre: string; filas: FilaDeTabla[] };
  agrupado: boolean;
  columnaDelGrupo: Columna | null;
  children: ReactNode;
}) {
  if (!agrupado) return <>{children}</>;
  const primera = grupo.filas[0];
  return (
    <>
      <tr className="border-b border-border bg-muted/40">
        <th colSpan={COLUMNAS.length} scope="colgroup" className="px-3 py-1.5 text-left text-xs font-semibold">
          {columnaDelGrupo === "estado" && primera?.estado ? (
            <PastillaDeEstado estado={primera.estado} />
          ) : (
            <span>{columnaDelGrupo && primera ? textoDeColumna(primera, columnaDelGrupo) : grupo.nombre}</span>
          )}
          <span className="ml-2 font-normal text-muted-foreground tabular-nums">{grupo.filas.length}</span>
        </th>
      </tr>
      {children}
    </>
  );
}
