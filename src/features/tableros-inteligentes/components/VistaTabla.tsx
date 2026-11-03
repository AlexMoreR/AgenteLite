"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Bookmark, Filter, Lock, Search, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { cambiarResponsableAction } from "@/app/actions/tableros-inteligentes-actions";
import { borrarVistaDeTablaAction, editarCeldaAction, guardarVistaDeTablaAction } from "@/app/actions/tablero-ia-vistas-actions";
import { NOMBRE_DEL_ESTADO, esEstado, type MiembroDelNegocio } from "../services/reglas";
import type { TarjetaVista, TipoVista } from "../services/tableros";
import {
  COLUMNAS,
  COLUMNAS_CON_OPCIONES,
  CONFIG_VACIA,
  NOMBRE_DE_LA_COLUMNA,
  VISTAS_DE_FABRICA,
  aplicarConfig,
  diaDeBogota,
  estadosPermitidos,
  filasDeTabla,
  motivoSinCambios,
  normalizar,
  opcionesDeColumna,
  type ClaveDeColumna,
  type ColumnaConOpciones,
  type ConfigDeTabla,
  type FilaDeTabla,
  type VistaDeTabla,
} from "../services/vistas-de-tabla";
import { COLOR_DEL_ESTADO } from "./colores";
import { IconoDeTipo } from "./IconoDeTipo";
import { accionSegura, useCambioDeEstado } from "./VistaKanban";

const DIA = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", year: "numeric" });

type Props = {
  tarjetas: TarjetaVista[];
  tipos: TipoVista[];
  miembros: MiembroDelNegocio[];
  /** Puede cambiar el responsable (quien edita el tablero), como en la ficha. */
  puedeAsignar: boolean;
  /** Las vistas que guardó la persona (en el servidor) y cómo avisar que cambiaron. */
  guardadas: VistaDeTabla[];
  alCambiarGuardadas: (guardadas: VistaDeTabla[]) => void;
  alAbrir: (tarjetaId: string) => void;
  alCambiar: () => void;
};

const CELDA_EDITABLE = "h-9 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-sm hover:border-border focus:border-border focus:bg-background";

/**
 * La vista Tabla (la principal, como una base de datos de Notion): una fila por tarjeta. Estado,
 * Responsable, Área y Fecha se cambian en la misma celda; el resto se ve. Se ordena tocando el título de
 * la columna, se filtra y se agrupa por cualquier columna, y el buscador mira el título, el detalle y el
 * código. Las vistas de fábrica ("Ideas", "Sistemas en curso") y las que guarda cada persona aplican
 * todo eso de un toque. Clic en una fila abre la tarjeta como página.
 */
export function VistaTabla({ tarjetas, tipos, miembros, puedeAsignar, guardadas, alCambiarGuardadas, alAbrir, alCambiar }: Props) {
  const [config, setConfig] = useState<ConfigDeTabla>(CONFIG_VACIA);
  const [activa, setActiva] = useState<string | null>(null);
  const [verFiltros, setVerFiltros] = useState(false);
  const [nombreNueva, setNombreNueva] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  // Sube cuando un cambio en una celda falla: las celdas vuelven a mostrar el valor guardado.
  const [revision, setRevision] = useState(0);
  const { pedir, cambiando, dialogo } = useCambioDeEstado(alCambiar);

  const filas = useMemo(() => filasDeTabla(tarjetas, tipos), [tarjetas, tipos]);
  const tipoPorId = useMemo(() => new Map(tipos.map((tipo) => [tipo.id, tipo])), [tipos]);
  const grupos = useMemo(() => aplicarConfig(filas, config), [filas, config]);
  const visibles = grupos.reduce((suma, grupo) => suma + grupo.filas.length, 0);
  // Las áreas que ya existen, para el menú de la celda (sin repetir por mayúsculas o tildes).
  const areas = useMemo(() => {
    const vistas = new Map<string, string>();
    for (const tarjeta of tarjetas) {
      const area = tarjeta.area?.trim();
      if (area && !vistas.has(normalizar(area))) vistas.set(normalizar(area), area);
    }
    return [...vistas.values()].sort((a, b) => a.localeCompare(b, "es"));
  }, [tarjetas]);
  const filtrosActivos = Object.values(config.filtros).reduce((suma, valores) => suma + (valores?.length ? 1 : 0), 0);
  const todas = [...VISTAS_DE_FABRICA, ...guardadas];
  const sinNada = activa === null && !config.busqueda && !filtrosActivos && !config.agrupar && !config.orden;

  const cambiarConfig = (cambio: Partial<ConfigDeTabla>) => {
    setConfig((actual) => ({ ...actual, ...cambio }));
    setActiva(null);
  };

  const elegirVista = (vista: VistaDeTabla | null) => {
    setConfig(vista ? vista.config : CONFIG_VACIA);
    setActiva(vista?.id ?? null);
  };

  const alternarFiltro = (columna: ColumnaConOpciones, clave: string) => {
    const actuales = config.filtros[columna] ?? [];
    const siguientes = actuales.includes(clave) ? actuales.filter((valor) => valor !== clave) : [...actuales, clave];
    cambiarConfig({ filtros: { ...config.filtros, [columna]: siguientes } });
  };

  const ordenarPor = (columna: ClaveDeColumna) => {
    const actual = config.orden?.columna === columna ? config.orden.direccion : null;
    // Un toque: de menor a mayor; otro: de mayor a menor; otro: como venían.
    cambiarConfig({ orden: actual === null ? { columna, direccion: "asc" } : actual === "asc" ? { columna, direccion: "desc" } : null });
  };

  const guardarVista = async () => {
    if (nombreNueva === null) return;
    setGuardando(true);
    const resultado = await accionSegura(guardarVistaDeTablaAction(nombreNueva, config));
    setGuardando(false);
    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }
    alCambiarGuardadas(resultado.guardadas);
    setActiva(resultado.guardadas.at(-1)?.id ?? null);
    setNombreNueva(null);
    toast.success("Vista guardada");
  };

  const borrarVista = async (vista: VistaDeTabla) => {
    const resultado = await accionSegura(borrarVistaDeTablaAction(vista.id));
    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }
    alCambiarGuardadas(resultado.guardadas);
    if (activa === vista.id) elegirVista(null);
  };

  const guardarCelda = async (tarjetaId: string, cambio: { area: string | null } | { fecha: string | null }) => {
    const resultado = await accionSegura(editarCeldaAction(tarjetaId, cambio));
    if (resultado.ok) toast.success("Guardado");
    else {
      toast.error(resultado.error);
      setRevision((n) => n + 1);
    }
    alCambiar();
  };

  const asignar = async (tarjetaId: string, responsableId: string | null) => {
    const resultado = await accionSegura(cambiarResponsableAction(tarjetaId, responsableId));
    if (resultado.ok) toast.success(responsableId ? "Tarjeta asignada" : "Sin responsable");
    else {
      toast.error(resultado.error);
      setRevision((n) => n + 1);
    }
    alCambiar();
  };

  const celdaDeEstado = (fila: FilaDeTabla<TarjetaVista>) => {
    const { tarjeta } = fila;
    if (!fila.usaEstados) return <span className="px-1.5 text-muted-foreground">—</span>;
    const opciones = estadosPermitidos(fila);
    const pastilla = cn("rounded-full border px-2 py-0.5 text-xs font-medium", COLOR_DEL_ESTADO[tarjeta.estado].pastilla);
    if (!opciones.length) {
      const motivo = motivoSinCambios(fila) ?? "";
      return (
        <button type="button" title={motivo} onClick={() => toast.info(motivo)} className="flex items-center gap-1 px-1.5">
          <span className={pastilla}>{NOMBRE_DEL_ESTADO[tarjeta.estado]}</span>
          <Lock className="size-3 text-muted-foreground" aria-label="No se cambia a mano" />
        </button>
      );
    }
    return (
      <select
        key={`${tarjeta.id}-${tarjeta.estado}-${revision}`}
        aria-label={`Estado de ${tarjeta.codigo || tarjeta.titulo}`}
        className={cn(CELDA_EDITABLE, "font-medium")}
        defaultValue={tarjeta.estado}
        disabled={cambiando === tarjeta.id}
        onChange={(evento) => {
          const estado = evento.target.value;
          if (esEstado(estado) && estado !== tarjeta.estado) pedir({ fila, estado, alFallar: () => setRevision((n) => n + 1) });
        }}
      >
        <option value={tarjeta.estado}>{NOMBRE_DEL_ESTADO[tarjeta.estado]}</option>
        {opciones.map((estado) => (
          <option key={estado} value={estado}>
            {NOMBRE_DEL_ESTADO[estado]}
          </option>
        ))}
      </select>
    );
  };

  const celda = (fila: FilaDeTabla<TarjetaVista>, columna: ClaveDeColumna) => {
    const { tarjeta } = fila;
    switch (columna) {
      case "codigo":
        return <span className="tabular-nums text-muted-foreground">{tarjeta.codigo || "—"}</span>;
      case "titulo":
        // Un botón de verdad: con teclado o lector de pantalla también se abre la tarjeta.
        return (
          <button
            type="button"
            onClick={() => alAbrir(tarjeta.id)}
            className="line-clamp-2 text-left font-medium hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {tarjeta.titulo}
          </button>
        );
      case "tipo": {
        const tipo = tipoPorId.get(tarjeta.tipoId);
        return (
          <span className="flex items-center gap-1.5">
            {tipo ? <IconoDeTipo icono={tipo.icono} color={tipo.color} className="size-3.5 shrink-0" /> : null}
            <span className="truncate">{fila.tipoNombre}</span>
          </span>
        );
      }
      case "area":
        return (
          <>
            <input
              key={`${tarjeta.id}-${tarjeta.area ?? ""}-${revision}`}
              aria-label={`Área de ${tarjeta.codigo || tarjeta.titulo}`}
              className={CELDA_EDITABLE}
              list="tablero-ia-areas"
              defaultValue={tarjeta.area ?? ""}
              // Sin área propia se ve, apagada, la de la carpeta de la que cuelga.
              placeholder={fila.areaHeredada && fila.area ? fila.area : "Sin área"}
              maxLength={60}
              onKeyDown={(evento) => {
                if (evento.key === "Enter") evento.currentTarget.blur();
                if (evento.key === "Escape") {
                  evento.currentTarget.value = tarjeta.area ?? "";
                  evento.currentTarget.blur();
                }
              }}
              onBlur={(evento) => {
                const nueva = evento.target.value.trim();
                if (nueva !== (tarjeta.area ?? "")) void guardarCelda(tarjeta.id, { area: nueva || null });
              }}
            />
          </>
        );
      case "estado":
        return celdaDeEstado(fila);
      case "prioridad":
        return tarjeta.urgente ? (
          <span className="rounded-full border border-rose-300 bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800 dark:border-rose-600 dark:bg-rose-900 dark:text-rose-100">
            Urgente
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Normal</span>
        );
      case "responsable":
        if (!puedeAsignar) return <span className="truncate">{tarjeta.responsableNombre ?? <span className="text-muted-foreground">Nadie</span>}</span>;
        return (
          <select
            key={`${tarjeta.id}-${tarjeta.responsableId ?? ""}-${revision}`}
            aria-label={`Responsable de ${tarjeta.codigo || tarjeta.titulo}`}
            className={CELDA_EDITABLE}
            defaultValue={tarjeta.responsableId ?? ""}
            onChange={(evento) => void asignar(tarjeta.id, evento.target.value || null)}
          >
            <option value="">Nadie</option>
            {tarjeta.responsableId && !miembros.some((miembro) => miembro.userId === tarjeta.responsableId) ? (
              <option value={tarjeta.responsableId}>{tarjeta.responsableNombre ?? "Otra persona"}</option>
            ) : null}
            {miembros.map((miembro) => (
              <option key={miembro.userId} value={miembro.userId}>
                {miembro.nombre}
              </option>
            ))}
          </select>
        );
      case "fecha": {
        const dia = diaDeBogota(tarjeta.fecha) ?? "";
        return (
          <input
            key={`${tarjeta.id}-${dia}-${revision}`}
            type="date"
            aria-label={`Fecha de ${tarjeta.codigo || tarjeta.titulo}`}
            title={tarjeta.fecha ? DIA.format(new Date(tarjeta.fecha)) : "Sin fecha"}
            className={CELDA_EDITABLE}
            defaultValue={dia}
            onBlur={(evento) => {
              const nueva = evento.target.value;
              if (nueva !== dia && (nueva === "" || /^\d{4}-\d{2}-\d{2}$/.test(nueva))) void guardarCelda(tarjeta.id, { fecha: nueva || null });
            }}
          />
        );
      }
    }
  };

  // Las celdas que se editan no abren la tarjeta al tocarlas.
  const editable = (columna: ClaveDeColumna) =>
    columna === "titulo" ||
    columna === "estado" ||
    columna === "area" ||
    columna === "fecha" ||
    (columna === "responsable" && puedeAsignar);

  return (
    <div className="flex h-full flex-col">
      {/* Las vistas: de fábrica, las de la persona y "Guardar vista". Se deslizan de lado en el celular. */}
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-card px-3 py-2 [scrollbar-width:none]">
        <button
          type="button"
          onClick={() => elegirVista(null)}
          aria-pressed={sinNada}
          className={cn(
            "min-h-10 shrink-0 rounded-full border px-3 text-xs font-medium md:min-h-8",
            sinNada ? "border-foreground bg-foreground text-background" : "border-border bg-background",
          )}
        >
          Todas
        </button>
        {todas.map((vista) => (
          <span
            key={vista.id}
            className={cn(
              "flex min-h-10 shrink-0 items-center rounded-full border text-xs font-medium md:min-h-8",
              activa === vista.id ? "border-foreground bg-foreground text-background" : "border-border bg-background",
            )}
          >
            <button type="button" className="flex items-center gap-1 px-3" onClick={() => elegirVista(vista)} aria-pressed={activa === vista.id}>
              <Bookmark className="size-3.5 shrink-0" aria-hidden />
              {vista.nombre}
            </button>
            {vista.deFabrica ? null : (
              <button
                type="button"
                className="-ml-1 flex size-8 items-center justify-center rounded-full opacity-70 hover:opacity-100"
                onClick={() => void borrarVista(vista)}
                aria-label={`Borrar la vista ${vista.nombre}`}
                title="Borrar esta vista"
              >
                <X className="size-3.5" />
              </button>
            )}
          </span>
        ))}
        {nombreNueva === null ? (
          <Button variant="ghost" size="sm" className="h-10 shrink-0 md:h-8" onClick={() => setNombreNueva("")}>
            + Guardar vista
          </Button>
        ) : (
          <form
            className="flex shrink-0 items-center gap-1"
            onSubmit={(evento) => {
              evento.preventDefault();
              void guardarVista();
            }}
          >
            <Input
              autoFocus
              value={nombreNueva}
              onChange={(evento) => setNombreNueva(evento.target.value)}
              onKeyDown={(evento) => (evento.key === "Escape" ? setNombreNueva(null) : undefined)}
              placeholder="Nombre de la vista"
              maxLength={40}
              className="h-10 w-44 md:h-8"
            />
            <Button type="submit" size="sm" className="h-10 md:h-8" disabled={guardando || !nombreNueva.trim()}>
              Guardar
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-10 md:h-8" onClick={() => setNombreNueva(null)}>
              Cancelar
            </Button>
          </form>
        )}
      </div>

      {/* Buscador, filtros y agrupar. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
        <label className="relative min-w-0 flex-1 basis-48">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={config.busqueda}
            onChange={(evento) => cambiarConfig({ busqueda: evento.target.value })}
            placeholder="Buscar por título, detalle o código (T-12)"
            aria-label="Buscar tarjetas"
            className="h-10 pl-8 md:h-8"
          />
        </label>
        <Button variant={verFiltros || filtrosActivos ? "secondary" : "outline"} size="sm" className="h-10 md:h-8" onClick={() => setVerFiltros((v) => !v)}>
          <Filter />
          Filtros{filtrosActivos ? ` (${filtrosActivos})` : ""}
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Agrupar
          <select
            className="h-10 rounded-md border bg-background px-2 text-sm text-foreground md:h-8"
            value={config.agrupar ?? ""}
            onChange={(evento) => cambiarConfig({ agrupar: (evento.target.value || null) as ColumnaConOpciones | null })}
          >
            <option value="">Sin agrupar</option>
            {COLUMNAS_CON_OPCIONES.map((columna) => (
              <option key={columna} value={columna}>
                {NOMBRE_DE_LA_COLUMNA[columna]}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {visibles} de {filas.length}
        </span>
      </div>

      {verFiltros ? (
        <div className="max-h-[40dvh] shrink-0 space-y-2 overflow-y-auto border-b border-border bg-card px-3 py-2">
          {COLUMNAS_CON_OPCIONES.map((columna) => {
            const opciones = opcionesDeColumna(filas, columna);
            const elegidas = config.filtros[columna] ?? [];
            return (
              <div key={columna} className="flex flex-wrap items-center gap-1.5">
                <span className="w-24 shrink-0 text-xs font-medium text-muted-foreground">{NOMBRE_DE_LA_COLUMNA[columna]}</span>
                {opciones.map((opcion) => {
                  const prendida = elegidas.includes(opcion.clave);
                  return (
                    <button
                      key={opcion.clave || "vacio"}
                      type="button"
                      aria-pressed={prendida}
                      onClick={() => alternarFiltro(columna, opcion.clave)}
                      className={cn(
                        "min-h-9 rounded-full border px-2.5 text-xs md:min-h-7",
                        prendida ? "border-foreground bg-foreground text-background" : "border-border bg-background",
                      )}
                    >
                      {opcion.texto} <span className="tabular-nums opacity-70">{opcion.cuantas}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
          {filtrosActivos ? (
            <Button variant="ghost" size="sm" onClick={() => cambiarConfig({ filtros: {} })}>
              Quitar filtros
            </Button>
          ) : null}
        </div>
      ) : null}

      <datalist id="tablero-ia-areas">
        {areas.map((area) => (
          <option key={area} value={area} />
        ))}
      </datalist>

      <div className="min-h-0 flex-1 overflow-auto bg-background">
        {filas.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-muted-foreground">
            El tablero está vacío. Las ideas que anote Claude aparecen acá en unos segundos.
          </p>
        ) : visibles === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-sm text-muted-foreground">
            No hay tarjetas con esta búsqueda o estos filtros.
            <Button variant="outline" size="sm" onClick={() => elegirVista(null)}>
              Ver todas
            </Button>
          </div>
        ) : (
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border">
                {COLUMNAS.map(({ clave, nombre }) => {
                  const orden = config.orden?.columna === clave ? config.orden.direccion : null;
                  const Icono = orden === "asc" ? ArrowUp : orden === "desc" ? ArrowDown : ArrowUpDown;
                  return (
                    <th
                      key={clave}
                      scope="col"
                      aria-sort={orden === "asc" ? "ascending" : orden === "desc" ? "descending" : "none"}
                      className={cn("px-2 py-1 text-left text-xs font-medium text-muted-foreground", clave === "titulo" && "w-[28%]")}
                    >
                      <button
                        type="button"
                        onClick={() => ordenarPor(clave)}
                        className="flex min-h-9 items-center gap-1 rounded px-1 hover:text-foreground"
                        title={`Ordenar por ${nombre}`}
                      >
                        {nombre}
                        <Icono className={cn("size-3.5", !orden && "opacity-40")} aria-hidden />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            {grupos.map((grupo) => (
              <tbody key={grupo.clave || "vacio"}>
                {config.agrupar ? (
                  <tr className="border-b border-border bg-muted/50">
                    <th colSpan={COLUMNAS.length} scope="colgroup" className="px-3 py-1.5 text-left text-xs font-semibold">
                      {grupo.texto} <span className="font-normal tabular-nums text-muted-foreground">{grupo.filas.length}</span>
                    </th>
                  </tr>
                ) : null}
                {grupo.filas.map((fila) => (
                  <tr
                    key={fila.tarjeta.id}
                    onClick={() => alAbrir(fila.tarjeta.id)}
                    className="cursor-pointer border-b border-border hover:bg-muted/40"
                  >
                    {COLUMNAS.map(({ clave }) => (
                      <td
                        key={clave}
                        className="px-2 py-1 align-middle"
                        onClick={editable(clave) ? (evento) => evento.stopPropagation() : undefined}
                      >
                        {celda(fila, clave)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        )}
      </div>
      {dialogo}
    </div>
  );
}
