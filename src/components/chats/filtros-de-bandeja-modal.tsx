"use client";

import * as React from "react";
import { Check, Loader2, Search } from "lucide-react";

import { pedirMiembros } from "@/components/chats/assign-chat-control";
import { etiquetasQueCoinciden, pedirEtiquetas } from "@/components/chats/chat-tags-control";
import { MultiSelect } from "@/components/ui/multi-select";
import type { AssignableMember, EtiquetaItem } from "@/app/actions/chats-actions";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CRM_STAGE_META, CRM_STAGE_ORDER } from "@/features/crm/domain/crm-config";
import {
  leerFiltrosDeBandeja,
  paramsDeFiltros,
  type EtapaCrm,
  type FiltrosDeBandeja,
} from "@/features/chats/domain/filtros-de-bandeja";
import { getTagBadgeColors } from "@/lib/tag-badge";
import type { AssignedFilter, StatusFilter } from "./shared-inbox";

export type ListaDeChats = { id: string; nombre: string; query: string };

/**
 * Para que se abre el modal.
 *  - filtrar: mirar algo una vez (y, si sirve, guardarlo como lista).
 *  - nueva: el "+" de la fila de listas.
 *  - editar: mantener presionada una lista -> Editar.
 */
export type ModoDelFiltro = { tipo: "filtrar" } | { tipo: "nueva" } | { tipo: "editar"; lista: ListaDeChats };

/*
  VARIAS asesoras en un solo filtro: `user:id1,id2`.

  Empezo siendo de a una (`user:<id>`) y Alex pidio poder mirar varias juntas (30-09-2026). Se
  mantiene el mismo prefijo para que los filtros guardados de a una sigan sirviendo tal cual.
*/
function asesorasDelFiltro(asignacion: AssignedFilter): string[] {
  return asignacion.startsWith("user:") ? asignacion.slice("user:".length).split(",").filter(Boolean) : [];
}

function filtroDeAsesoras(ids: string[]): AssignedFilter {
  return ids.length > 0 ? (`user:${ids.join(",")}` as AssignedFilter) : "all";
}

/** Lo que dice una lista guardada, campo por campo (es una direccion). */
function leerLista(query: string) {
  const params = new URLSearchParams(query);
  const asignacion = (params.get("assigned") || "all") as AssignedFilter;
  const estadoCrudo = params.get("status");
  const estado: StatusFilter = estadoCrudo === "resolved" || estadoCrudo === "all" ? estadoCrudo : "open";
  return { asignacion, estado, filtros: leerFiltrosDeBandeja((clave) => params.get(clave)) };
}

/** La direccion que describe lo elegido: es lo que se guarda como lista. */
export function queryDeFiltro(asignacion: AssignedFilter, estado: StatusFilter, filtros: FiltrosDeBandeja) {
  const params = new URLSearchParams();
  if (asignacion !== "all") params.set("assigned", asignacion);
  if (estado !== "open") params.set("status", estado);
  for (const [clave, valor] of paramsDeFiltros(filtros)) params.set(clave, valor);
  return params.toString();
}

type Props = {
  abierto: boolean;
  alCerrar: () => void;
  modo: ModoDelFiltro;
  isManager: boolean;
  assignedFilter: AssignedFilter;
  statusFilter: StatusFilter;
  filtros: FiltrosDeBandeja;
  assignedCounts: { mine: number; unassigned: number; all: number } | null;
  alAplicar: (asignacion: AssignedFilter, estado: StatusFilter, filtros: FiltrosDeBandeja) => void;
  /** Crear (sin id) o editar (con id) una lista. Devuelve el error, o null si salio bien. */
  alGuardarLista: (datos: { id?: string; nombre: string; query: string }) => Promise<string | null>;
};

const OPCIONES_DE_ASIGNACION: Array<{ value: "all" | "mine" | "unassigned"; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "mine", label: "Mías" },
  { value: "unassigned", label: "Sin asignar" },
];

const OPCIONES_DE_ESTADO: Array<{ value: StatusFilter; label: string }> = [
  { value: "open", label: "Abiertas" },
  { value: "resolved", label: "Resueltas" },
  { value: "all", label: "Todas" },
];

function Seccion({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</h3>
        {ayuda ? <span className="text-[11px] text-muted-foreground">{ayuda}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** Botones de una sola fila (Asignacion, Estado): se ve todo junto y se toca sin desplegar nada. */
function Segmentos<T extends string>({
  opciones,
  valor,
  alElegir,
}: {
  opciones: Array<{ value: T; label: string; cuenta?: number | null }>;
  valor: T | null;
  alElegir: (valor: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
      {opciones.map((opcion) => {
        const elegida = valor === opcion.value;
        return (
          <button
            key={opcion.value}
            type="button"
            onClick={() => alElegir(opcion.value)}
            aria-pressed={elegida}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition ${
              elegida ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opcion.label}
            {opcion.cuenta != null ? (
              <span className={`text-[11px] tabular-nums ${elegida ? "text-primary" : "text-muted-foreground"}`}>
                {opcion.cuenta}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Los filtros de la bandeja y las LISTAS (Alex, 04-10-2026: "como WhatsApp").
 *
 * Una lista es un filtro con nombre que queda como chapita arriba de los chats y se actualiza sola:
 * "Calientes con etiqueta COMBO" muestra siempre los que cumplen eso hoy, sin agregar a nadie a mano.
 *
 * Va arriba y no centrado: al abrirse el teclado para escribir el nombre, un modal centrado queda
 * con la mitad de abajo tapada.
 */
export function FiltrosDeBandejaModal({
  abierto,
  alCerrar,
  modo,
  isManager,
  assignedFilter,
  statusFilter,
  filtros,
  assignedCounts,
  alAplicar,
  alGuardarLista,
}: Props) {
  // Todo se elige primero y se aplica con el boton: cada cambio suelto seria un viaje al servidor
  // y una lista que se sacude debajo del modal mientras uno todavia esta decidiendo.
  const [tipo, setTipo] = React.useState<ModoDelFiltro["tipo"]>(modo.tipo);
  const [asignacion, setAsignacion] = React.useState<AssignedFilter>(assignedFilter);
  const [estado, setEstado] = React.useState<StatusFilter>(statusFilter);
  const [etapas, setEtapas] = React.useState<EtapaCrm[]>(filtros.etapas);
  const [etiquetasElegidas, setEtiquetasElegidas] = React.useState<string[]>(filtros.etiquetas);
  const [nombre, setNombre] = React.useState("");
  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState("");

  const [equipo, setEquipo] = React.useState<AssignableMember[]>([]);
  const [etiquetas, setEtiquetas] = React.useState<EtiquetaItem[] | null>(null);
  const [busquedaEtiqueta, setBusquedaEtiqueta] = React.useState("");

  const listaQueSeEdita = modo.tipo === "editar" ? modo.lista : null;
  const firmaDeLoPuesto = `${assignedFilter}|${statusFilter}|${paramsDeFiltros(filtros).join(";")}|${modo.tipo}|${listaQueSeEdita?.id ?? ""}`;

  // Al abrirlo se parte SIEMPRE de lo que hay puesto (o de la lista que se edita): si no, el modal
  // mostraria la eleccion a medias de la vez anterior.
  React.useEffect(() => {
    if (!abierto) {
      return;
    }
    setTipo(modo.tipo);
    if (listaQueSeEdita) {
      const lista = leerLista(listaQueSeEdita.query);
      setAsignacion(lista.asignacion);
      setEstado(lista.estado);
      setEtapas(lista.filtros.etapas);
      setEtiquetasElegidas(lista.filtros.etiquetas);
      setNombre(listaQueSeEdita.nombre);
    } else {
      setAsignacion(assignedFilter);
      setEstado(statusFilter);
      setEtapas(filtros.etapas);
      setEtiquetasElegidas(filtros.etiquetas);
      setNombre("");
    }
    setBusquedaEtiqueta("");
    setError("");

    let vigente = true;
    if (isManager) {
      void pedirMiembros().then((resultado) => {
        if (vigente && resultado.members) setEquipo(resultado.members);
      });
    }
    void pedirEtiquetas()
      .then((resultado) => {
        if (vigente) setEtiquetas(resultado.items ?? []);
      })
      .catch(() => {
        if (vigente) setEtiquetas([]);
      });
    return () => {
      vigente = false;
    };
    // firmaDeLoPuesto resume todo lo que importa de las props: abrir con otra lista reinicia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, firmaDeLoPuesto, isManager]);

  const filtrosElegidos: FiltrosDeBandeja = { etapas, sinResponder: false, etiquetas: etiquetasElegidas };

  /*
    Lo elegido, en una linea. Sin esto hay que recorrer el modal entero para saber que quedo
    puesto, que es justo lo que uno quiere ver de un vistazo al abrirlo.
  */
  const resumen = React.useMemo(() => {
    const partes: string[] = [];
    if (asignacion === "mine") partes.push("Mías");
    else if (asignacion === "unassigned") partes.push("Sin asignar");
    else if (asignacion.startsWith("user:")) {
      const ids = asesorasDelFiltro(asignacion);
      partes.push(
        ids.length > 2
          ? `${ids.length} asesoras`
          : ids
              .map((id) => {
                const quien = equipo.find((miembro) => miembro.id === id);
                return quien ? quien.name?.trim() || quien.email : "Una asesora";
              })
              .join(" y "),
      );
    } else partes.push("Todas");
    partes.push(estado === "open" ? "abiertas" : estado === "resolved" ? "resueltas" : "abiertas y resueltas");
    if (etapas.length > 0) partes.push(etapas.length === 1 ? CRM_STAGE_META[etapas[0]].label : `${etapas.length} etapas`);
    if (etiquetasElegidas.length > 0) {
      const primera = etiquetas?.find((etiqueta) => etiqueta.id === etiquetasElegidas[0]);
      partes.push(etiquetasElegidas.length === 1 && primera ? primera.name : `${etiquetasElegidas.length} etiquetas`);
    }
    return partes.join(" · ");
  }, [asignacion, estado, etapas, etiquetasElegidas, etiquetas, equipo]);

  const alternar = <T,>(lista: T[], valor: T) =>
    lista.includes(valor) ? lista.filter((otro) => otro !== valor) : [...lista, valor];

  const guardarLista = async () => {
    const limpio = nombre.trim();
    if (!limpio) {
      setError("Ponle un nombre a la lista");
      return;
    }
    setGuardando(true);
    setError("");
    const fallo = await alGuardarLista({
      id: listaQueSeEdita?.id,
      nombre: limpio,
      query: queryDeFiltro(asignacion, estado, filtrosElegidos),
    });
    setGuardando(false);
    if (fallo) setError(fallo);
  };

  const opcionesDeAsignacion = OPCIONES_DE_ASIGNACION.map((opcion) => ({
    ...opcion,
    cuenta: assignedCounts ? assignedCounts[opcion.value] : null,
  }));
  const asignacionSimple = (["all", "mine", "unassigned"] as const).find((valor) => valor === asignacion) ?? null;
  const etiquetasVisibles = etiquetas ? etiquetasQueCoinciden(etiquetas, busquedaEtiqueta) : [];
  const conNombre = tipo === "nueva" || tipo === "editar";
  const titulo = tipo === "nueva" ? "Nueva lista" : tipo === "editar" ? "Editar lista" : "Filtrar conversaciones";

  return (
    <Dialog open={abierto} onOpenChange={(valor) => !valor && alCerrar()}>
      <DialogContent
        showCloseButton
        className="max-h-[calc(var(--app-viewport-height,100dvh)-2rem)] gap-0 overflow-y-auto p-0 max-sm:top-4 max-sm:translate-y-0 sm:max-w-md"
      >
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-[16px] font-semibold">{titulo}</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted-foreground">{resumen}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-5 py-4">
          {conNombre ? (
            <Seccion titulo="Nombre de la lista">
              <input
                autoFocus={tipo === "nueva"}
                value={nombre}
                maxLength={40}
                onChange={(evento) => setNombre(evento.target.value)}
                onKeyDown={(evento) => {
                  if (evento.key === "Enter") {
                    evento.preventDefault();
                    void guardarLista();
                  }
                }}
                placeholder="Ejemplo: Calientes, Combo camillas"
                // 16px en el celular: por debajo de eso el iPhone hace zoom al tocar el campo.
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-[16px] font-medium text-foreground outline-none transition focus:border-primary md:text-[14px]"
              />
              <p className="text-[12px] text-muted-foreground">
                Queda como una pestaña arriba de los chats y se actualiza sola.
              </p>
            </Seccion>
          ) : null}

          {isManager ? (
            <Seccion titulo="Asignación">
              <Segmentos opciones={opcionesDeAsignacion} valor={asignacionSimple} alElegir={setAsignacion} />
              {/*
                La bandeja de UNA o varias asesoras. Solo para jefes: es como se revisa si alguien
                esta atendiendo bien, sin abrir chat por chat (Alex, 25-09-2026).
              */}
              {equipo.length > 0 ? (
                <MultiSelect
                  opciones={equipo.map((miembro) => ({ value: miembro.id, label: miembro.name?.trim() || miembro.email }))}
                  valor={asesorasDelFiltro(asignacion)}
                  // Marcar asesoras reemplaza a Todas/Mias/Sin asignar. Sin ninguna, vuelve a "Todas".
                  alCambiar={(ids) => setAsignacion(filtroDeAsesoras(ids))}
                  placeholder="Por asesora: todas"
                  plural="asesoras"
                />
              ) : null}
            </Seccion>
          ) : null}

          <Seccion titulo="Estado">
            <Segmentos opciones={OPCIONES_DE_ESTADO} valor={estado} alElegir={setEstado} />
          </Seccion>

          {/* Siempre con su color, como en la lista de chats: se elige por color, sin leer. */}
          <Seccion titulo="Etapa" ayuda={etapas.length > 0 ? `${etapas.length} elegida${etapas.length === 1 ? "" : "s"}` : undefined}>
            <div className="flex flex-wrap gap-1.5">
              {CRM_STAGE_ORDER.map((etapa) => {
                const meta = CRM_STAGE_META[etapa];
                const elegida = etapas.includes(etapa as EtapaCrm);
                return (
                  <button
                    key={etapa}
                    type="button"
                    onClick={() => setEtapas((actuales) => alternar(actuales, etapa as EtapaCrm))}
                    aria-pressed={elegida}
                    className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[13px] font-medium transition ${meta.borderClassName} ${meta.backgroundClassName} ${meta.accentClassName} ${
                      elegida ? "ring-2 ring-current ring-offset-1 ring-offset-background" : "opacity-70 hover:opacity-100"
                    }`}
                  >
                    {elegida ? <Check className="size-3.5" strokeWidth={3} /> : null}
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </Seccion>

          <Seccion
            titulo="Etiquetas"
            ayuda={etiquetasElegidas.length > 0 ? "Tiene alguna de las marcadas" : undefined}
          >
            {etiquetas === null ? (
              <p className="text-[12.5px] text-muted-foreground">Cargando…</p>
            ) : etiquetas.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">Todavía no hay etiquetas.</p>
            ) : (
              <>
                {etiquetas.length > 8 ? (
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={busquedaEtiqueta}
                      onChange={(evento) => setBusquedaEtiqueta(evento.target.value)}
                      placeholder="Buscar etiqueta"
                      aria-label="Buscar etiqueta"
                      className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-[16px] text-foreground outline-none transition focus:border-primary md:text-[13px]"
                    />
                  </div>
                ) : null}
                <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                  {etiquetasVisibles.length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground">Ninguna etiqueta con ese nombre.</p>
                  ) : (
                    etiquetasVisibles.map((etiqueta) => {
                      const elegida = etiquetasElegidas.includes(etiqueta.id);
                      const colores = getTagBadgeColors(etiqueta.color);
                      return (
                        <button
                          key={etiqueta.id}
                          type="button"
                          onClick={() => setEtiquetasElegidas((actuales) => alternar(actuales, etiqueta.id))}
                          aria-pressed={elegida}
                          style={colores}
                          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-semibold uppercase tracking-wide transition ${
                            elegida ? "ring-2 ring-current ring-offset-1 ring-offset-background" : "opacity-70 hover:opacity-100"
                          }`}
                        >
                          {elegida ? <Check className="size-3.5" strokeWidth={3} /> : null}
                          {etiqueta.name}
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </Seccion>

          {error ? <p className="text-[12.5px] font-medium text-red-600">{error}</p> : null}
        </div>

        <div className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-background px-5 py-3">
          {tipo === "filtrar" ? (
            <>
              <button
                type="button"
                onClick={() => alAplicar("all", "open", { etapas: [], sinResponder: false, etiquetas: [] })}
                className="rounded-lg px-2.5 py-2 text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
              >
                Limpiar
              </button>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTipo("nueva");
                    setError("");
                  }}
                  className="rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-foreground transition hover:bg-muted"
                >
                  Guardar como lista
                </button>
                <button
                  type="button"
                  // "Sin responder" se quito del modal (Alex, 30-09-2026): aplicar lo apaga, para que
                  // no quede puesto algo que ya no se ve ni se puede sacar.
                  onClick={() => alAplicar(asignacion, estado, filtrosElegidos)}
                  className="rounded-lg bg-primary px-5 py-2 text-[13px] font-semibold text-primary-foreground transition hover:opacity-90"
                >
                  Aplicar
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={alCerrar}
                className="rounded-lg px-2.5 py-2 text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={guardando}
                onClick={() => void guardarLista()}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-[13px] font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
              >
                {guardando ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {tipo === "editar" ? "Guardar cambios" : "Crear lista"}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
