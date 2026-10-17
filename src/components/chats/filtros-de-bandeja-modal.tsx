"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { nombresDeLosCatalogos, useCatalogosDeFiltro } from "@/components/chats/catalogos-de-filtro";
import { EditorDeCondicionesDeBandeja } from "@/components/chats/condiciones-de-bandeja";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SIN_FILTROS,
  esListaSinFiltro,
  filasDelModal,
  leerFiltrosDeBandeja,
  paramsDeFiltros,
  separarFilasDelModal,
  textoDeCondicion,
  textoDelEstado,
  type AsignacionSimple,
  type CondicionDelFiltro,
  type FiltrosDeBandeja,
} from "@/features/chats/domain/filtros-de-bandeja";
import type { AssignedFilter, StatusFilter } from "./shared-inbox";

export type ListaDeChats = { id: string; nombre: string; query: string };

/**
 * Para que se abre el modal.
 *  - filtrar: mirar algo una vez (y, si sirve, guardarlo como lista).
 *  - nueva: el "+" de la fila de listas.
 *  - editar: mantener presionada una lista -> Editar.
 */
export type ModoDelFiltro = { tipo: "filtrar" } | { tipo: "nueva" } | { tipo: "editar"; lista: ListaDeChats };

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

/** Botones de una sola fila (Asignacion): se ve todo junto y se toca sin desplegar nada. */
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
            className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-[13px] font-medium transition ${
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
  /*
    Arriba solo Todas / Mias / Sin asignar. El Estado y "Por asesora" son filas de Condiciones
    desde el 17-10-2026 (ver filasDelModal): una lista vieja con `assigned=user:…` o `status=…`
    se abre con esas filas y, al aplicarla, da lo mismo que antes.
  */
  const inicial = filasDelModal(assignedFilter, statusFilter, filtros);
  const [asignacion, setAsignacion] = React.useState<AsignacionSimple>(inicial.asignacion);
  // Las condiciones (campo · operador · valor), como en Automatizaciones. Ver condiciones-de-bandeja.
  const [condiciones, setCondiciones] = React.useState<CondicionDelFiltro[]>(inicial.filas);
  const [nombre, setNombre] = React.useState("");
  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState("");

  const catalogos = useCatalogosDeFiltro(abierto, isManager);

  const listaQueSeEdita = modo.tipo === "editar" ? modo.lista : null;
  const firmaDeLoPuesto = `${assignedFilter}|${statusFilter}|${paramsDeFiltros(filtros).join(";")}|${modo.tipo}|${listaQueSeEdita?.id ?? ""}`;

  // Al abrirlo se parte SIEMPRE de lo que hay puesto (o de la lista que se edita): si no, el modal
  // mostraria la eleccion a medias de la vez anterior.
  React.useEffect(() => {
    if (!abierto) {
      return;
    }
    setTipo(modo.tipo);
    const lista = listaQueSeEdita ? leerLista(listaQueSeEdita.query) : null;
    // "Por asesora" es solo de jefes (a una asesora el servidor le impone "Mias"): solo a ellos
    // les pasa a la condicion Asesora.
    const soloDeJefes = (valor: AssignedFilter) => (!isManager && valor.startsWith("user:") ? "all" : valor);
    const puesto = lista
      ? filasDelModal(soloDeJefes(lista.asignacion), lista.estado, lista.filtros)
      : filasDelModal(soloDeJefes(assignedFilter), statusFilter, filtros);
    setAsignacion(puesto.asignacion);
    setCondiciones(puesto.filas);
    setNombre(listaQueSeEdita?.nombre ?? "");
    setError("");
    // firmaDeLoPuesto resume todo lo que importa de las props: abrir con otra lista reinicia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, firmaDeLoPuesto, isManager]);

  // Lo que viaja: asignacion, estado (`status=`) y las condiciones completas (una fila a medio
  // llenar no filtra ni se guarda).
  const elegido = separarFilasDelModal(asignacion, condiciones);

  /*
    Lo elegido, en una linea. Sin esto hay que recorrer el modal entero para saber que quedo
    puesto, que es justo lo que uno quiere ver de un vistazo al abrirlo.
  */
  const resumen = React.useMemo(() => {
    const { estado, filtros: elegidos } = separarFilasDelModal(asignacion, condiciones);
    const partes: string[] = [asignacion === "mine" ? "Mías" : asignacion === "unassigned" ? "Sin asignar" : "Todas"];
    partes.push(textoDelEstado(estado));
    // Cada condición en corto: "sin PROVEEDOR", "1–15 oct", "Propuesta"…
    const nombres = nombresDeLosCatalogos(catalogos);
    const ahora = new Date();
    for (const condicion of elegidos.condiciones) partes.push(textoDeCondicion(condicion, nombres, ahora));
    return partes.join(" · ");
  }, [asignacion, condiciones, catalogos]);

  const guardarLista = async () => {
    const limpio = nombre.trim();
    if (!limpio) {
      setError("Ponle un nombre a la lista");
      return;
    }
    const query = queryDeFiltro(elegido.asignacion, elegido.estado, elegido.filtros);
    // Sin nada marcado la lista seria "Todas" con otro nombre (paso con "Maria", 13-10-2026).
    if (esListaSinFiltro(query)) {
      setError("Pon al menos una condición o elige Mías / Sin asignar: así la lista sería igual a Todas");
      return;
    }
    setGuardando(true);
    setError("");
    const fallo = await alGuardarLista({
      id: listaQueSeEdita?.id,
      nombre: limpio,
      query,
    });
    setGuardando(false);
    if (fallo) setError(fallo);
  };

  const opcionesDeAsignacion = OPCIONES_DE_ASIGNACION.map((opcion) => ({
    ...opcion,
    cuenta: assignedCounts ? assignedCounts[opcion.value] : null,
  }));
  const conNombre = tipo === "nueva" || tipo === "editar";
  const titulo = tipo === "nueva" ? "Nueva lista" : tipo === "editar" ? "Editar lista" : "Filtrar conversaciones";

  return (
    <Dialog open={abierto} onOpenChange={(valor) => !valor && alCerrar()}>
      <DialogContent
        showCloseButton
        className="inset-0 top-0 left-0 flex h-dvh max-h-dvh w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] ring-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[85vh] sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:ring-1"
      >
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-[16px] font-semibold">{titulo}</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted-foreground">{resumen}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {conNombre ? (
            <Seccion titulo="Nombre de la lista">
              {/*
                Sin autocompletar: sin esto Android abria sobre el teclado la barra de contraseñas,
                tarjetas y direcciones (Alex, 04-10-2026). Y sin abrir el teclado solo al entrar.
              */}
              <input
                name="nombre-de-la-lista"
                autoComplete="off"
                autoCorrect="off"
                data-form-type="other"
                data-lpignore="true"
                enterKeyHint="done"
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
            </Seccion>
          ) : null}

          {isManager ? (
            <Seccion titulo="Asignación">
              <Segmentos opciones={opcionesDeAsignacion} valor={asignacion} alElegir={setAsignacion} />
            </Seccion>
          ) : null}

          <EditorDeCondicionesDeBandeja
            condiciones={condiciones}
            catalogos={catalogos}
            conEquipo={isManager}
            onCambio={setCondiciones}
          />

          {error ? <p className="text-[12.5px] font-medium text-red-600">{error}</p> : null}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border bg-background px-5 py-3">
          {tipo === "filtrar" ? (
            <>
              <button
                type="button"
                onClick={() => alAplicar("all", "open", SIN_FILTROS)}
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
                  onClick={() => alAplicar(elegido.asignacion, elegido.estado, elegido.filtros)}
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
