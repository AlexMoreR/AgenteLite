"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  CornerLeftUp,
  EllipsisVertical,
  ExternalLink,
  History,
  Layers,
  Loader2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  cambiarPrioridadAction,
  cambiarResponsableAction,
  deshacerBorradoDeTarjetaAction,
  eliminarTarjetaAction,
  marcarUrgenteAction,
  historialDeTarjetaAction,
  marcarDependenciaAction,
  type CambioDeTarjetaVista,
} from "@/app/actions/tableros-inteligentes-actions";
import { NOMBRE_DEL_ESTADO, esEstado, textoDelLink, type MiembroDelNegocio } from "../services/reglas";
import { NOMBRE_DE_PRIORIDAD, PRIORIDADES, esPrioridad } from "../services/reglas-trabajador";
import type { ConexionVista, TarjetaVista, TipoVista } from "../services/tableros";
import { COLOR_DE_PRIORIDAD, COLOR_DEL_ESTADO } from "./colores";
import { IconoDeTipo } from "./IconoDeTipo";
import { PasarAlCerebro } from "./PasarAlCerebro";
import { sePuedePasarAlCerebro } from "@/features/cerebro/services/reglas";
import { IntentosDeLaTarjeta } from "./IntentosDeLaTarjeta";
import { DetallesTecnicos, TrabajoDeLaTarjeta } from "./TrabajoDeLaTarjeta";

const CUANDO = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
const DIA = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "long", year: "numeric" });

const ACCION: Record<string, string> = {
  crear: "La creó",
  editar: "La editó",
  estado: "Cambió el estado",
  conectar: "Agregó una flecha",
  aprobar: "La aprobó",
  borrar: "La borró",
  deshacer: "Deshizo un cambio",
  cerebro: "La pasó al cerebro",
};

const DESDE: Record<string, string> = { MCP: "Claude", PANTALLA: "pantalla", TRABAJADOR: "Coordinador" };

const MOMENTO: Record<string, string> = { tarea: "la tarea", plan: "el plan", subir: "subir a producción" };

const CAMPO: Record<string, string> = {
  titulo: "título",
  detalle: "detalle",
  area: "área",
  orden: "orden",
  fecha: "fecha",
  tipoId: "tipo",
  padreId: "tarjeta madre",
  link: "link",
  linkTexto: "texto del link",
  repo: "repo",
  zonaProtegida: "zona protegida",
  riesgo: "riesgo",
  riesgoMotivo: "motivo del riesgo",
  riesgoPor: "quién puso el riesgo",
  responsableId: "responsable",
  urgente: "urgente",
  prioridad: "prioridad",
};

function resumenDelCambio(cambio: CambioDeTarjetaVista, nombreDelTipo: ReadonlyMap<string, string>): string | null {
  const despues = (cambio.despues ?? {}) as Record<string, unknown>;
  const antes = (cambio.antes ?? {}) as Record<string, unknown>;
  if (cambio.accion === "estado" || cambio.accion === "aprobar") {
    const de = esEstado(antes.estado) ? NOMBRE_DEL_ESTADO[antes.estado] : "?";
    const a = esEstado(despues.estado) ? NOMBRE_DEL_ESTADO[despues.estado] : "?";
    // Una aprobación de la fase 2 dice qué se aprobó y por dónde; un error del Coordinador, su motivo.
    const como = typeof despues.como === "string" ? ` · ${despues.como}` : "";
    const momento = typeof despues.momento === "string" ? ` (${MOMENTO[despues.momento] ?? despues.momento})` : "";
    const motivo = typeof despues.motivo === "string" ? ` · ${despues.motivo}` : "";
    const sola =
      cambio.accion === "aprobar" && despues.automatica === true
        ? despues.regla === "dueno-24-oct"
          ? " · Aprobada sola por la regla del dueño"
          : " · Aprobada sola por la regla de bajo riesgo"
        : "";
    // Un HECHO a mano deja la nota de qué se hizo y, si lo hay, el commit.
    const nota = cambio.accion === "estado" && typeof despues.nota === "string" ? ` · Nota: ${despues.nota}` : "";
    const commit = cambio.accion === "estado" && typeof despues.commit === "string" ? ` · Commit: ${despues.commit}` : "";
    return `${de} → ${a}${momento}${como}${sola}${motivo}${nota}${commit}`;
  }
  if (cambio.accion === "crear") {
    return typeof despues.responsableNombre === "string" ? `Asignada a ${despues.responsableNombre}` : null;
  }
  if (cambio.accion === "editar") {
    // El nombre del responsable viaja aparte (responsableNombre): no es un campo que se "cambió".
    // `movimiento` (10-nov-2026) no es un campo: marca que solo la movieron y conservó su estado y su plan.
    const campos = Object.keys(despues).filter(
      (campo) => campo !== "estado" && campo !== "responsableNombre" && campo !== "responsableId" && campo !== "movimiento",
    );
    const asignacion =
      "responsableId" in despues
        ? typeof despues.responsableNombre === "string"
          ? `Asignó a ${despues.responsableNombre}`
          : typeof antes.responsableNombre === "string"
            ? `Quitó a ${antes.responsableNombre}`
            : "Quitó al responsable"
        : null;
    const tipo =
      typeof antes.tipoId === "string" && typeof despues.tipoId === "string"
        ? ` (${nombreDelTipo.get(antes.tipoId) ?? "?"} → ${nombreDelTipo.get(despues.tipoId) ?? "?"})`
        : "";
    const estado = esEstado(despues.estado) ? ` y quedó ${NOMBRE_DEL_ESTADO[despues.estado]}` : "";
    const cambios = campos.length ? `Cambió ${campos.map((campo) => CAMPO[campo] ?? campo).join(", ")}${tipo}${estado}` : null;
    const movida = despues.movimiento === true ? "Solo la movió: conserva su estado y su plan" : null;
    return [asignacion, cambios, movida].filter(Boolean).join(" · ") || null;
  }
  if (cambio.accion === "cerebro") {
    return typeof despues.documento === "string" ? `Conclusión guardada en el cerebro: ${despues.documento}` : null;
  }
  if (cambio.accion === "borrar") {
    const flechas = Array.isArray(antes.conexiones) ? antes.conexiones.length : 0;
    return flechas ? `Con ${flechas} flecha(s)` : null;
  }
  return null;
}

type Props = {
  tarjeta: TarjetaVista | null;
  tarjetas: TarjetaVista[];
  tipos: ReadonlyMap<string, TipoVista>;
  hijas: number;
  entrantes: string[];
  salientes: string[];
  /** Las flechas que llegan a esta tarjeta (para marcar "esto depende de aquella"). */
  flechasEntrantes: ConexionVista[];
  abierta: boolean;
  lado: "bottom" | "right";
  /** "pagina": la tarjeta abierta desde la Tabla, el Tablero o el Calendario, como página ancha (en el celular, toda la pantalla). */
  modo?: "panel" | "pagina";
  puedeAprobar: boolean;
  /** Dueño del negocio: el sí final (subir a producción) y quitar zonas protegidas. */
  esDueno: boolean;
  puedeSubir?: boolean;
  /** Ve "Marcar hecho a mano": el dueño o Emanuel (Sistemas). */
  puedeMarcarHechoAMano?: boolean;
  /** Dueño o ADMIN de la plataforma: "Cerrar como fallida" (el servidor vuelve a revisarlo). */
  puedeCerrarComoFallida?: boolean;
  /** Puede usar el cerebro (el dueño o quien él autorizó): muestra "Pasar al cerebro" en tarjetas hechas o de decisión. */
  puedeCerebro?: boolean;
  /** Las personas activas del negocio (para el selector de responsable). */
  miembros: MiembroDelNegocio[];
  /** Puede cambiar el responsable (quien edita el tablero). Quien solo es responsable la ve, no la asigna. */
  puedeAsignar: boolean;
  /** Dueño del negocio o ADMIN: «Eliminar tarjeta» en los tres puntos (el servidor lo vuelve a revisar). */
  puedeEliminar?: boolean;
  alCerrar: () => void;
  alElegir: (tarjetaId: string) => void;
  alEntrar: (tarjetaId: string) => void;
  alAprobar: () => void;
};

/**
 * La ficha de una tarjeta: tipo, link, el resumen corto y el botón que toca (repo, zona protegida,
 * Aprobar tarea / Aprobar plan / Sí, subir / Reintentar), de quién cuelga, sus flechas y, en el acordeón
 * cerrado "Ver detalles", lo técnico (detalle, plan, resultado, pruebas, rama, commit) y el historial.
 */
export function FichaTarjeta({
  tarjeta,
  tarjetas,
  tipos,
  hijas,
  entrantes,
  salientes,
  flechasEntrantes,
  abierta,
  lado,
  modo = "panel",
  puedeAprobar,
  esDueno,
  puedeSubir,
  puedeMarcarHechoAMano,
  puedeCerrarComoFallida = false,
  puedeCerebro = false,
  miembros,
  puedeAsignar,
  puedeEliminar = false,
  alCerrar,
  alElegir,
  alEntrar,
  alAprobar,
}: Props) {
  const [historial, setHistorial] = useState<{ tarjetaId: string; cambios: CambioDeTarjetaVista[] } | null>(null);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [asignando, setAsignando] = useState(false);
  const [marcandoUrgente, setMarcandoUrgente] = useState(false);
  const [cambiandoPrioridad, setCambiandoPrioridad] = useState(false);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const [eliminando, setEliminando] = useState(false);

  const titulo = new Map(tarjetas.map((otra) => [otra.id, otra.titulo]));
  const nombreDelTipo = new Map([...tipos.values()].map((tipo) => [tipo.id, tipo.nombre]));
  const historialDeEsta = tarjeta && historial?.tarjetaId === tarjeta.id ? historial.cambios : null;
  const tipo = tarjeta ? tipos.get(tarjeta.tipoId) : undefined;
  const usaEstados = tipo?.usaEstados ?? true;
  const pideAprobacion = (tipo?.requiereAprobacion ?? true) && usaEstados;
  const madre = tarjeta?.padreId && titulo.has(tarjeta.padreId) ? tarjeta.padreId : null;

  const verHistorial = async () => {
    if (!tarjeta) return;
    const id = tarjeta.id;
    setCargandoHistorial(true);
    const resultado = await historialDeTarjetaAction(id);
    setCargandoHistorial(false);
    if (resultado.ok) {
      setHistorial({ tarjetaId: id, cambios: resultado.cambios });
    } else {
      toast.error(resultado.error);
    }
  };

  const alternarDependencia = async (flecha: ConexionVista) => {
    const resultado = await marcarDependenciaAction(flecha.id, !flecha.esDependencia);
    if (resultado.ok) toast.success(flecha.esDependencia ? "Ya no depende de aquella" : "Ahora espera a que aquella esté hecha");
    else toast.error(resultado.error);
    alAprobar();
  };

  const asignar = async (responsableId: string | null) => {
    if (!tarjeta) return;
    setAsignando(true);
    const resultado = await cambiarResponsableAction(tarjeta.id, responsableId);
    setAsignando(false);
    if (resultado.ok) {
      toast.success(responsableId ? "Tarjeta asignada" : "Sin responsable");
      setHistorial(null);
    } else {
      toast.error(resultado.error);
    }
    alAprobar();
  };

  const cambiarPrioridad = async (prioridad: string) => {
    if (!tarjeta || !esPrioridad(prioridad) || prioridad === tarjeta.prioridad) return;
    setCambiandoPrioridad(true);
    const resultado = await cambiarPrioridadAction(tarjeta.id, prioridad).catch(() => ({
      ok: false as const,
      error: "No se pudo guardar: revisa la conexión e inténtalo de nuevo.",
    }));
    setCambiandoPrioridad(false);
    if (resultado.ok) {
      if (resultado.aviso) toast.info(resultado.aviso);
      else toast.success(`Prioridad: ${NOMBRE_DE_PRIORIDAD[prioridad]}`);
      setHistorial(null);
    } else {
      toast.error(resultado.error);
    }
    alAprobar();
  };

  /*
    «Eliminar tarjeta» (22-nov-2026): borrado suave, se guarda en el historial. El aviso trae «Deshacer»,
    que la devuelve con sus flechas.
  */
  const eliminar = async () => {
    if (!tarjeta) return;
    const { id, titulo: tituloDeLaTarjeta } = tarjeta;
    setEliminando(true);
    const resultado = await eliminarTarjetaAction(id).catch(() => ({
      ok: false as const,
      error: "No se pudo eliminar: revisa la conexión e inténtalo de nuevo.",
    }));
    setEliminando(false);
    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }
    setConfirmarBorrado(false);
    alCerrar();
    alAprobar();
    toast.success(`Tarjeta eliminada: ${tituloDeLaTarjeta}`, {
      duration: 10_000,
      action: {
        label: "Deshacer",
        onClick: () => {
          void deshacerBorradoDeTarjetaAction(resultado.cambioId)
            .catch(() => ({ ok: false as const, error: "No se pudo deshacer: revisa la conexión." }))
            .then((deshecho) => {
              if (deshecho.ok) toast.success("Tarjeta recuperada");
              else toast.error(deshecho.error);
              alAprobar();
            });
        },
      },
    });
  };

  const marcarUrgente = async () => {
    if (!tarjeta) return;
    setMarcandoUrgente(true);
    const resultado = await marcarUrgenteAction(tarjeta.id);
    setMarcandoUrgente(false);
    if (resultado.ok) {
      toast.success(resultado.yaEstaba ? "Ya estaba marcada como urgente" : "Marcada como urgente: el responsable recibe su aviso");
      setHistorial(null);
    } else {
      toast.error(resultado.error);
    }
    alAprobar();
  };

  const color = tarjeta ? COLOR_DEL_ESTADO[tarjeta.estado] : null;

  return (
    <Sheet open={abierta} onOpenChange={(abrir) => (!abrir ? alCerrar() : undefined)}>
      <SheetContent
        side={modo === "pagina" ? "right" : lado}
        className={cn(
          "gap-0 overflow-y-auto",
          modo === "pagina"
            ? "w-full data-[side=right]:w-full sm:max-w-3xl data-[side=right]:sm:max-w-3xl"
            : lado === "bottom"
              ? "max-h-[85dvh] rounded-t-2xl"
              : "w-full sm:max-w-md",
        )}
      >
        {tarjeta && color ? (
          <>
            <SheetHeader className="pb-2">
              <div className="flex flex-wrap items-center gap-1.5 pr-8">
                {tipo ? (
                  <span className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium">
                    <IconoDeTipo icono={tipo.icono} color={tipo.color} className="size-3.5" />
                    {tipo.nombre}
                  </span>
                ) : null}
                {/* El estado no se repite cuando se llama igual que el tipo (una Idea en estado Idea decía "Idea" dos veces). */}
                {usaEstados && NOMBRE_DEL_ESTADO[tarjeta.estado].toLowerCase() !== tipo?.nombre.trim().toLowerCase() ? (
                  <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", color.pastilla)}>
                    {NOMBRE_DEL_ESTADO[tarjeta.estado]}
                  </span>
                ) : null}
                {tarjeta.area ? (
                  <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{tarjeta.area}</span>
                ) : null}
                {tarjeta.fecha ? (
                  <span className="text-xs text-muted-foreground">Para el {DIA.format(new Date(tarjeta.fecha))}</span>
                ) : null}
              </div>
              <SheetTitle className="text-lg leading-snug">
                {tarjeta.codigo ? (
                  <span className="mr-2 align-middle text-xs font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
                    {tarjeta.codigo}
                  </span>
                ) : null}
                {tarjeta.titulo}
              </SheetTitle>
              <SheetDescription className="sr-only">Detalle de la tarjeta</SheetDescription>
            </SheetHeader>

            <div className="space-y-4 px-4 pb-6">
              {/* Las tarjetas con aprobación muestran arriba el resumen corto (TrabajoDeLaTarjeta) y su detalle
                  completo va en "Ver detalles"; las demás (áreas, ideas) muestran el detalle tal cual. */}
              {/* (22-nov-2026, pedido de Alex) Arriba solo el título: el detalle va cerrado y se abre al tocarlo,
                  igual que el "Ver detalles" de las tarjetas con aprobación. */}
              {pideAprobacion ? null : tarjeta.detalle?.trim() ? (
                <details className="group rounded-lg border">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
                    Ver detalle
                  </summary>
                  <p className="whitespace-pre-wrap border-t px-3 py-3 text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">
                    {tarjeta.detalle}
                  </p>
                </details>
              ) : null}

              {tarjeta.link ? (
                <Button
                  variant="outline"
                  className="h-10 w-full justify-start"
                  render={<a href={tarjeta.link} target="_blank" rel="noopener noreferrer" />}
                >
                  <ExternalLink />
                  <span className="truncate">{textoDelLink(tarjeta.link, tarjeta.linkTexto)}</span>
                </Button>
              ) : null}

              {/* La prioridad (21-nov-2026): el Coordinador toma primero Urgente, después Alta, Media y Baja. */}
              {usaEstados ? (
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Prioridad</span>
                  <select
                    className={cn("h-10 w-full rounded-lg border px-3 text-sm font-medium md:h-9", COLOR_DE_PRIORIDAD[tarjeta.prioridad])}
                    value={tarjeta.prioridad}
                    disabled={cambiandoPrioridad}
                    onChange={(evento) => void cambiarPrioridad(evento.target.value)}
                  >
                    {PRIORIDADES.map((prioridad) => (
                      <option key={prioridad} value={prioridad}>
                        {NOMBRE_DE_PRIORIDAD[prioridad]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {/* (22-nov-2026, pedido de Alex) A la derecha del Responsable, los tres puntos: «Marcar urgente»
                  (antes un botón grande debajo) y «Eliminar tarjeta» (dueño o ADMIN). */}
              {puedeAsignar || tarjeta.responsableNombre || puedeEliminar ? (
                <div className="space-y-1">
                  {puedeAsignar ? (
                    <label htmlFor={`responsable-${tarjeta.id}`} className="block text-xs font-medium text-muted-foreground">
                      Responsable
                    </label>
                  ) : null}
                  <div className="flex items-center gap-2">
                    {puedeAsignar ? (
                      <select
                        id={`responsable-${tarjeta.id}`}
                        className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm md:h-9"
                        value={tarjeta.responsableId ?? ""}
                        disabled={asignando}
                        onChange={(evento) => void asignar(evento.target.value || null)}
                      >
                        <option value="">Nadie</option>
                        {/* Alguien que ya no está entre las personas activas igual se muestra mientras sea el responsable. */}
                        {tarjeta.responsableId && !miembros.some((miembro) => miembro.userId === tarjeta.responsableId) ? (
                          <option value={tarjeta.responsableId}>{tarjeta.responsableNombre ?? "Otra persona"}</option>
                        ) : null}
                        {miembros.map((miembro) => (
                          <option key={miembro.userId} value={miembro.userId}>
                            {miembro.nombre}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="min-w-0 flex-1 text-sm">
                        {tarjeta.responsableNombre ? (
                          <>
                            <span className="text-xs font-medium text-muted-foreground">Responsable: </span>
                            {tarjeta.responsableNombre}
                          </>
                        ) : null}
                      </p>
                    )}
                    {(puedeAsignar && tarjeta.responsableId) || puedeEliminar ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="outline"
                              size="icon"
                              className="size-10 shrink-0 md:size-9"
                              aria-label="Más opciones de la tarjeta"
                              title="Más opciones"
                            />
                          }
                        >
                          {marcandoUrgente || eliminando ? <Loader2 className="animate-spin" /> : <EllipsisVertical />}
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-44">
                          {puedeAsignar && tarjeta.responsableId ? (
                            <DropdownMenuItem disabled={marcandoUrgente} onClick={() => void marcarUrgente()}>
                              <AlertTriangle />
                              Marcar urgente
                            </DropdownMenuItem>
                          ) : null}
                          {puedeEliminar ? (
                            <DropdownMenuItem variant="destructive" disabled={eliminando} onClick={() => setConfirmarBorrado(true)}>
                              <Trash2 />
                              Eliminar tarjeta
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <Dialog open={confirmarBorrado} onOpenChange={(abrir) => (!eliminando ? setConfirmarBorrado(abrir) : undefined)}>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>¿Eliminar esta tarjeta?</DialogTitle>
                    <DialogDescription>
                      «{tarjeta.titulo}» sale del tablero con sus flechas. Sus tarjetas hijas quedan sueltas. Al eliminarla
                      sale un aviso con «Deshacer» para recuperarla.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" disabled={eliminando} onClick={() => setConfirmarBorrado(false)}>
                      Cancelar
                    </Button>
                    <Button variant="destructive" disabled={eliminando} onClick={() => void eliminar()}>
                      {eliminando ? <Loader2 className="animate-spin" /> : <Trash2 />}
                      Eliminar tarjeta
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <TrabajoDeLaTarjeta
                tarjeta={tarjeta}
                pideAprobacion={pideAprobacion}
                puedeAprobar={puedeAprobar}
                esDueno={esDueno}
                puedeSubir={puedeSubir}
                puedeMarcarHechoAMano={puedeMarcarHechoAMano}
                puedeCerrarComoFallida={puedeCerrarComoFallida}
                alCambiar={() => {
                  setHistorial(null);
                  alAprobar();
                }}
              />

              {puedeCerebro && sePuedePasarAlCerebro(tarjeta, tipo?.nombre) ? <PasarAlCerebro tarjetaId={tarjeta.id} /> : null}

              {pideAprobacion ? <IntentosDeLaTarjeta tarjetaId={tarjeta.id} version={tarjeta.actualizadoEn} /> : null}

              {madre || hijas > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {madre ? (
                    <Button variant="outline" onClick={() => alElegir(madre)} className="h-10 max-w-full">
                      <CornerLeftUp />
                      <span className="truncate">Cuelga de {titulo.get(madre)}</span>
                    </Button>
                  ) : null}
                  {hijas > 0 ? (
                    <Button variant="outline" onClick={() => alEntrar(tarjeta.id)} className="h-10">
                      <Layers />
                      Ver sus {hijas === 1 ? "1 tarjeta" : `${hijas} tarjetas`}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {salientes.length || entrantes.length ? (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Conectada con</p>
                  {salientes.map((id) => (
                    <button
                      key={`s-${id}`}
                      type="button"
                      onClick={() => alElegir(id)}
                      className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                      <span className="line-clamp-2">{titulo.get(id) ?? "Tarjeta"}</span>
                    </button>
                  ))}
                  {entrantes.map((id) => {
                    const flecha = flechasEntrantes.find((f) => f.origenId === id);
                    return (
                      <div key={`e-${id}`} className="space-y-1">
                        <button
                          type="button"
                          onClick={() => alElegir(id)}
                          className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted"
                        >
                          <ArrowDownLeft className="size-4 shrink-0 text-muted-foreground" />
                          <span className="line-clamp-2">{titulo.get(id) ?? "Tarjeta"}</span>
                        </button>
                        {flecha && (puedeAprobar || flecha.esDependencia) ? (
                          <Button
                            variant={flecha.esDependencia ? "secondary" : "ghost"}
                            size="sm"
                            className="w-full"
                            disabled={!puedeAprobar}
                            onClick={() => void alternarDependencia(flecha)}
                          >
                            {flecha.esDependencia ? "Depende de aquella: espera a que esté hecha (quitar)" : "Esto depende de aquella"}
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <DetallesTecnicos tarjeta={tarjeta} pideAprobacion={pideAprobacion}>
              <div className="space-y-2">
                {historialDeEsta ? (
                  <>
                    <p className="text-xs font-medium text-muted-foreground">Historial</p>
                    <ol className="space-y-1.5">
                      {historialDeEsta.map((cambio) => {
                        const resumen = resumenDelCambio(cambio, nombreDelTipo);
                        return (
                          <li
                            key={cambio.id}
                            className={cn("rounded-lg border px-3 py-2 text-xs", cambio.deshecho && "opacity-50 line-through")}
                          >
                            <div className="flex flex-wrap justify-between gap-x-2">
                              <span className="font-medium">
                                {ACCION[cambio.accion] ?? cambio.accion} · {cambio.quien}
                              </span>
                              <span className="text-muted-foreground">
                                {CUANDO.format(new Date(cambio.cuando))} · {DESDE[cambio.origen] ?? cambio.origen}
                              </span>
                            </div>
                            {resumen ? <p className="mt-0.5 text-muted-foreground">{resumen}</p> : null}
                          </li>
                        );
                      })}
                    </ol>
                  </>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => void verHistorial()} disabled={cargandoHistorial}>
                    {cargandoHistorial ? <Loader2 className="animate-spin" /> : <History />}
                    Ver historial
                  </Button>
                )}
              </div>
              </DetallesTecnicos>
            </div>
          </>
        ) : (
          <SheetHeader>
            <SheetTitle>Tarjeta</SheetTitle>
            <SheetDescription>Esta tarjeta ya no está en el tablero.</SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}
