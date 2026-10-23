"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, CornerLeftUp, ExternalLink, History, Layers, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { historialDeTarjetaAction, type CambioDeTarjetaVista } from "@/app/actions/tableros-inteligentes-actions";
import { NOMBRE_DEL_ESTADO, esEstado, textoDelLink } from "../services/reglas";
import type { TarjetaVista, TipoVista } from "../services/tableros";
import { COLOR_DEL_ESTADO } from "./colores";
import { IconoDeTipo } from "./IconoDeTipo";
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
};

const DESDE: Record<string, string> = { MCP: "Claude", PANTALLA: "pantalla", TRABAJADOR: "trabajador" };

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
};

function resumenDelCambio(cambio: CambioDeTarjetaVista, nombreDelTipo: ReadonlyMap<string, string>): string | null {
  const despues = (cambio.despues ?? {}) as Record<string, unknown>;
  const antes = (cambio.antes ?? {}) as Record<string, unknown>;
  if (cambio.accion === "estado" || cambio.accion === "aprobar") {
    const de = esEstado(antes.estado) ? NOMBRE_DEL_ESTADO[antes.estado] : "?";
    const a = esEstado(despues.estado) ? NOMBRE_DEL_ESTADO[despues.estado] : "?";
    // Una aprobación de la fase 2 dice qué se aprobó y por dónde; un error del trabajador, su motivo.
    const como = typeof despues.como === "string" ? ` · ${despues.como}` : "";
    const momento = typeof despues.momento === "string" ? ` (${MOMENTO[despues.momento] ?? despues.momento})` : "";
    const motivo = typeof despues.motivo === "string" ? ` · ${despues.motivo}` : "";
    return `${de} → ${a}${momento}${como}${motivo}`;
  }
  if (cambio.accion === "editar") {
    const campos = Object.keys(despues).filter((campo) => campo !== "estado");
    const tipo =
      typeof antes.tipoId === "string" && typeof despues.tipoId === "string"
        ? ` (${nombreDelTipo.get(antes.tipoId) ?? "?"} → ${nombreDelTipo.get(despues.tipoId) ?? "?"})`
        : "";
    const estado = esEstado(despues.estado) ? ` y quedó ${NOMBRE_DEL_ESTADO[despues.estado]}` : "";
    return campos.length ? `Cambió ${campos.map((campo) => CAMPO[campo] ?? campo).join(", ")}${tipo}${estado}` : null;
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
  abierta: boolean;
  lado: "bottom" | "right";
  puedeAprobar: boolean;
  /** Dueño del negocio: el sí final (subir a producción) y quitar zonas protegidas. */
  esDueno: boolean;
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
  abierta,
  lado,
  puedeAprobar,
  esDueno,
  alCerrar,
  alElegir,
  alEntrar,
  alAprobar,
}: Props) {
  const [historial, setHistorial] = useState<{ tarjetaId: string; cambios: CambioDeTarjetaVista[] } | null>(null);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

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

  const color = tarjeta ? COLOR_DEL_ESTADO[tarjeta.estado] : null;

  return (
    <Sheet open={abierta} onOpenChange={(abrir) => (!abrir ? alCerrar() : undefined)}>
      <SheetContent
        side={lado}
        className={cn(
          "gap-0 overflow-y-auto",
          lado === "bottom" ? "max-h-[85dvh] rounded-t-2xl" : "w-full sm:max-w-md",
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
                {usaEstados ? (
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
              <SheetTitle className="text-lg leading-snug">{tarjeta.titulo}</SheetTitle>
              <SheetDescription className="sr-only">Detalle de la tarjeta</SheetDescription>
            </SheetHeader>

            <div className="space-y-4 px-4 pb-6">
              {/* Las tarjetas con aprobación muestran arriba el resumen corto (TrabajoDeLaTarjeta) y su detalle
                  completo va en "Ver detalles"; las demás (áreas, ideas) muestran el detalle tal cual. */}
              {pideAprobacion ? null : tarjeta.detalle ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{tarjeta.detalle}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Sin detalle.</p>
              )}

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

              <TrabajoDeLaTarjeta
                tarjeta={tarjeta}
                pideAprobacion={pideAprobacion}
                puedeAprobar={puedeAprobar}
                esDueno={esDueno}
                alCambiar={() => {
                  setHistorial(null);
                  alAprobar();
                }}
              />

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
                  {entrantes.map((id) => (
                    <button
                      key={`e-${id}`}
                      type="button"
                      onClick={() => alElegir(id)}
                      className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <ArrowDownLeft className="size-4 shrink-0 text-muted-foreground" />
                      <span className="line-clamp-2">{titulo.get(id) ?? "Tarjeta"}</span>
                    </button>
                  ))}
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
