"use client";

import * as React from "react";
import { Bookmark, Check, Loader2, UserRound, X } from "lucide-react";

import { pedirMiembros } from "@/components/chats/assign-chat-control";
import type { AssignableMember } from "@/app/actions/chats-actions";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CRM_STAGE_META, CRM_STAGE_ORDER } from "@/features/crm/domain/crm-config";
import {
  DIAS_DE_SIN_RESPONDER,
  type EtapaCrm,
  type FiltrosDeBandeja,
} from "@/features/chats/domain/filtros-de-bandeja";
import type { AssignedFilter, StatusFilter } from "./shared-inbox";

type FiltroGuardado = { id: string; nombre: string; query: string };

type Props = {
  abierto: boolean;
  alCerrar: () => void;
  isManager: boolean;
  assignedFilter: AssignedFilter;
  statusFilter: StatusFilter;
  filtros: FiltrosDeBandeja;
  assignedCounts: { mine: number; unassigned: number; all: number } | null;
  alAplicar: (asignacion: AssignedFilter, estado: StatusFilter, filtros: FiltrosDeBandeja) => void;
  /** Volver a una vista guardada: es la direccion entera, no campo por campo. */
  alAplicarGuardado: (query: string) => void;
};

const OPCIONES_DE_ASIGNACION: Array<{ value: AssignedFilter; label: string; soloJefe?: boolean }> = [
  { value: "mine", label: "Mías" },
  { value: "unassigned", label: "Sin asignar", soloJefe: true },
  { value: "all", label: "Todas", soloJefe: true },
];

const OPCIONES_DE_ESTADO: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "open", label: "Abiertas" },
  { value: "resolved", label: "Resueltas" },
];

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {titulo}
      </p>
      {children}
    </div>
  );
}

/**
 * Los filtros de la bandeja, en un modal de arriba.
 *
 * Antes era un menu colgado del "+": en un celular tapaba la lista, quedaba cortado contra el
 * borde y no habia lugar para agregarle nada. Va arriba y no centrado por la misma razon que el
 * buscador: al abrirse el teclado para nombrar un filtro guardado, un modal centrado queda con la
 * mitad de abajo tapada.
 */
export function FiltrosDeBandejaModal({
  abierto,
  alCerrar,
  isManager,
  assignedFilter,
  statusFilter,
  filtros,
  assignedCounts,
  alAplicar,
  alAplicarGuardado,
}: Props) {
  // Todo se elige primero y se aplica con el boton: cada cambio suelto seria un viaje al servidor
  // y una lista que se sacude debajo del modal mientras uno todavia esta decidiendo.
  const [asignacion, setAsignacion] = React.useState<AssignedFilter>(assignedFilter);
  const [estado, setEstado] = React.useState<StatusFilter>(statusFilter);
  const [etapas, setEtapas] = React.useState<EtapaCrm[]>(filtros.etapas);
  const [sinResponder, setSinResponder] = React.useState(filtros.sinResponder);

  /*
    El equipo, para que un jefe pueda mirar la bandeja de UNA asesora.

    Se pide al abrir el modal y solo si es jefe: una asesora no tiene por que descargarse la lista
    del equipo para filtrar sus propios chats. Reusa la misma lista cacheada del selector de
    asignacion, asi que abrir el filtro no cuesta una consulta nueva.
  */
  const [equipo, setEquipo] = React.useState<AssignableMember[]>([]);

  const [guardados, setGuardados] = React.useState<FiltroGuardado[]>([]);
  const [nombrando, setNombrando] = React.useState(false);
  const [nombre, setNombre] = React.useState("");
  const [guardando, setGuardando] = React.useState(false);
  const [errorAlGuardar, setErrorAlGuardar] = React.useState("");

  const etapasPuestas = filtros.etapas.join(",");

  // Al abrirlo se parte SIEMPRE de lo que hay puesto: si no, el modal mostraria la eleccion a
  // medias de la vez anterior y aplicaria algo que ya nadie queria.
  React.useEffect(() => {
    if (!abierto) {
      return;
    }
    setAsignacion(assignedFilter);
    setEstado(statusFilter);
    setEtapas(etapasPuestas ? (etapasPuestas.split(",") as EtapaCrm[]) : []);
    setSinResponder(filtros.sinResponder);
    setNombrando(false);
    setNombre("");
    setErrorAlGuardar("");

    let vigente = true;

    if (isManager) {
      void pedirMiembros().then((resultado) => {
        if (vigente && resultado.members) {
          setEquipo(resultado.members);
        }
      });
    }

    void fetch("/api/cliente/chats/filtros-guardados", { credentials: "same-origin" })
      .then((respuesta) => respuesta.json())
      .then((datos: { ok?: boolean; filtros?: FiltroGuardado[] }) => {
        if (vigente && datos.ok && Array.isArray(datos.filtros)) {
          setGuardados(datos.filtros);
        }
      })
      .catch(() => {
        // Sin los guardados el modal igual sirve: no se bloquea por esto.
      });
    return () => {
      vigente = false;
    };
  }, [abierto, assignedFilter, statusFilter, etapasPuestas, filtros.sinResponder, isManager]);

  /*
    Lo elegido, en una linea. Sin esto hay que recorrer el modal entero para saber que quedo
    puesto, que es justo lo que uno quiere ver de un vistazo al abrirlo.
  */
  const resumenDeLoElegido = React.useMemo(() => {
    const partes: string[] = [];
    if (asignacion === "mine") partes.push("Mías");
    else if (asignacion === "unassigned") partes.push("Sin asignar");
    else if (asignacion.startsWith("user:")) {
      const id = asignacion.slice("user:".length);
      const quien = equipo.find((miembro) => miembro.id === id);
      partes.push(quien ? (quien.name?.trim() || quien.email) : "Una asesora");
    } else partes.push("Todas");

    partes.push(estado === "open" ? "abiertas" : estado === "resolved" ? "resueltas" : "abiertas y resueltas");
    if (etapas.length > 0) {
      partes.push(etapas.length === 1 ? CRM_STAGE_META[etapas[0]].label : `${etapas.length} etapas`);
    }
    if (sinResponder) partes.push("sin responder");
    return partes.join(" · ");
  }, [asignacion, estado, etapas, sinResponder, equipo]);

  const alternarEtapa = (etapa: EtapaCrm) => {
    setEtapas((actuales) =>
      actuales.includes(etapa) ? actuales.filter((valor) => valor !== etapa) : [...actuales, etapa],
    );
  };

  /** La direccion que describe lo elegido ahora. Es lo que se guarda como filtro personalizado. */
  const queryDeLoElegido = () => {
    const params = new URLSearchParams();
    if (asignacion !== "mine") params.set("assigned", asignacion);
    if (estado !== "open") params.set("status", estado);
    if (etapas.length > 0) params.set("stage", etapas.join(","));
    if (sinResponder) params.set("pending", "1");
    return params.toString();
  };

  const guardarEsteFiltro = async () => {
    const limpio = nombre.trim();
    if (!limpio) {
      setErrorAlGuardar("Ponele un nombre");
      return;
    }
    setGuardando(true);
    setErrorAlGuardar("");
    try {
      const respuesta = await fetch("/api/cliente/chats/filtros-guardados", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: limpio, query: queryDeLoElegido() }),
      });
      const datos = (await respuesta.json()) as {
        ok?: boolean;
        error?: string;
        filtros?: FiltroGuardado[];
      };
      if (!datos.ok) {
        setErrorAlGuardar(datos.error || "No se pudo guardar");
        return;
      }
      setGuardados(datos.filtros ?? []);
      setNombrando(false);
      setNombre("");
    } catch {
      setErrorAlGuardar("No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  };

  const borrarGuardado = async (id: string) => {
    // Se saca de la vista al toque: esperar la respuesta para borrar una chapita se siente trabado.
    setGuardados((actuales) => actuales.filter((filtro) => filtro.id !== id));
    await fetch(`/api/cliente/chats/filtros-guardados?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    }).catch(() => null);
  };

  const opcionesDeAsignacion = OPCIONES_DE_ASIGNACION.filter(
    (opcion) => isManager || !opcion.soloJefe,
  );

  return (
    <Dialog
      open={abierto}
      onOpenChange={(valor) => {
        if (!valor) {
          alCerrar();
        }
      }}
    >
      <DialogContent
        showCloseButton
        className="max-h-[calc(var(--app-viewport-height,100dvh)-2rem)] overflow-y-auto p-0 max-sm:top-4 max-sm:translate-y-0 sm:max-w-md"
      >
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-[15px]">Filtrar conversaciones</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted-foreground">
            {resumenDeLoElegido}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-4 py-4">
          {guardados.length > 0 ? (
            <Seccion titulo="Mis filtros">
              <div className="flex flex-wrap gap-1.5">
                {guardados.map((filtro) => (
                  <span
                    key={filtro.id}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 py-1 pl-3 pr-1 text-[13px]"
                  >
                    <button
                      type="button"
                      onClick={() => alAplicarGuardado(filtro.query)}
                      className="font-medium text-foreground"
                    >
                      {filtro.nombre}
                    </button>
                    <button
                      type="button"
                      onClick={() => void borrarGuardado(filtro.id)}
                      aria-label={`Borrar el filtro ${filtro.nombre}`}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition hover:bg-background hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </Seccion>
          ) : null}

          {opcionesDeAsignacion.length > 1 ? (
            <Seccion titulo="Asignación">
              <div className="space-y-0.5">
                {opcionesDeAsignacion.map((opcion) => {
                  const elegida = asignacion === opcion.value;
                  const cuenta =
                    assignedCounts && opcion.value !== "all" && !opcion.value.startsWith("user:")
                      ? assignedCounts[opcion.value as "mine" | "unassigned"]
                      : assignedCounts && opcion.value === "all"
                        ? assignedCounts.all
                        : null;
                  return (
                    <button
                      key={opcion.value}
                      type="button"
                      onClick={() => setAsignacion(opcion.value)}
                      className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-[14px] transition ${
                        elegida
                          ? "bg-primary/10 font-medium text-foreground"
                          : "text-foreground hover:bg-muted"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {elegida ? (
                          <Check className="h-4 w-4 text-primary" />
                        ) : (
                          <span className="h-4 w-4" />
                        )}
                        {opcion.label}
                      </span>
                      {cuenta != null ? (
                        <span className="text-[12px] tabular-nums text-muted-foreground">
                          {cuenta}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </Seccion>
          ) : null}

          {/*
            La bandeja de UNA asesora. Solo para jefes: es como se revisa si alguien esta
            atendiendo bien, sin tener que abrir chat por chat (Alex, 25-09-2026).
          */}
          {isManager && equipo.length > 0 ? (
            <Seccion titulo="Por asesora">
              <div className="flex flex-wrap gap-1.5">
                {equipo.map((miembro) => {
                  const valor = `user:${miembro.id}` as AssignedFilter;
                  const elegida = asignacion === valor;
                  const nombreCorto = (miembro.name?.trim() || miembro.email).split(" ").slice(0, 2).join(" ");
                  return (
                    <button
                      key={miembro.id}
                      type="button"
                      onClick={() => setAsignacion(elegida ? "all" : valor)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium transition ${
                        elegida
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {elegida ? <Check className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}
                      {nombreCorto}
                    </button>
                  );
                })}
              </div>
            </Seccion>
          ) : null}

          <Seccion titulo="Estado">
            <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
              {OPCIONES_DE_ESTADO.map((opcion) => (
                <button
                  key={opcion.value}
                  type="button"
                  onClick={() => setEstado(opcion.value)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[13px] font-medium transition ${
                    estado === opcion.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opcion.label}
                </button>
              ))}
            </div>
          </Seccion>

          {/* Las mismas chapitas de color que se ven en la lista: se elige por color, sin leer. */}
          <Seccion titulo="Etapa del embudo">
            <div className="flex flex-wrap gap-1.5">
              {CRM_STAGE_ORDER.map((etapa) => {
                const meta = CRM_STAGE_META[etapa];
                const elegida = etapas.includes(etapa as EtapaCrm);
                return (
                  <button
                    key={etapa}
                    type="button"
                    onClick={() => alternarEtapa(etapa as EtapaCrm)}
                    className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[13px] font-medium transition ${
                      elegida
                        ? `${meta.borderClassName} ${meta.backgroundClassName} ${meta.accentClassName}`
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {elegida ? <Check className="h-3 w-3" /> : null}
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </Seccion>

          <Seccion titulo="Pendientes">
            <button
              type="button"
              onClick={() => setSinResponder((valor) => !valor)}
              className={`flex w-full items-start justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                sinResponder ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
              }`}
            >
              <span className="min-w-0">
                <span className="block text-[14px] font-medium text-foreground">Sin responder</span>
                <span className="block text-[12px] leading-4 text-muted-foreground">
                  El último que escribió fue el cliente. Últimos {DIAS_DE_SIN_RESPONDER} días.
                </span>
              </span>
              <span
                className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  sinResponder
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border"
                }`}
              >
                {sinResponder ? <Check className="h-3 w-3" /> : null}
              </span>
            </button>
          </Seccion>

          {/*
            Guardar la combinacion que quedo armada.

            Sin esto, la asesora que todos los dias mira lo mismo -por ejemplo los Calientes sin
            responder- tiene que rearmarlo de cero cada mañana.
          */}
          {nombrando ? (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <input
                autoFocus
                value={nombre}
                maxLength={40}
                onChange={(evento) => setNombre(evento.target.value)}
                onKeyDown={(evento) => {
                  if (evento.key === "Enter") {
                    evento.preventDefault();
                    void guardarEsteFiltro();
                  }
                }}
                placeholder="Nombre del filtro"
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[14px] outline-none focus:border-primary"
              />
              {errorAlGuardar ? <p className="text-[12px] text-red-600">{errorAlGuardar}</p> : null}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNombrando(false)}
                  className="rounded-md px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition hover:text-foreground"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={guardando}
                  onClick={() => void guardarEsteFiltro()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
                >
                  {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Guardar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setNombrando(true)}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary transition hover:opacity-80"
            >
              <Bookmark className="h-3.5 w-3.5" />
              Guardar este filtro
            </button>
          )}
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-border bg-background px-4 py-3">
          <button
            type="button"
            onClick={() => alAplicar(isManager ? "all" : "mine", "open", { etapas: [], sinResponder: false })}
            className="rounded-md px-2.5 py-2 text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
          >
            Limpiar
          </button>
          <button
            type="button"
            onClick={() => alAplicar(asignacion, estado, { etapas, sinResponder })}
            className="rounded-md bg-primary px-5 py-2 text-[13px] font-medium text-primary-foreground transition hover:opacity-90"
          >
            Aplicar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
