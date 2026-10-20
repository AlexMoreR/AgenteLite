"use client";

import { useState, useTransition } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, History, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  aprobarTarjetaAction,
  historialDeTarjetaAction,
  type CambioDeTarjetaVista,
} from "@/app/actions/tableros-inteligentes-actions";
import { NOMBRE_DEL_ESTADO, esEstado } from "../services/reglas";
import type { TarjetaVista } from "../services/tableros";
import { COLOR_DEL_ESTADO } from "./colores";

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
  deshacer: "Deshizo un cambio",
};

const DESDE: Record<string, string> = { MCP: "Claude", PANTALLA: "pantalla", TRABAJADOR: "trabajador" };

function resumenDelCambio(cambio: CambioDeTarjetaVista): string | null {
  const despues = (cambio.despues ?? {}) as Record<string, unknown>;
  const antes = (cambio.antes ?? {}) as Record<string, unknown>;
  if (cambio.accion === "estado" || cambio.accion === "aprobar") {
    const de = esEstado(antes.estado) ? NOMBRE_DEL_ESTADO[antes.estado] : "?";
    const a = esEstado(despues.estado) ? NOMBRE_DEL_ESTADO[despues.estado] : "?";
    return `${de} → ${a}`;
  }
  if (cambio.accion === "editar") {
    const campos = Object.keys(despues).filter((campo) => campo !== "estado");
    const volvio = despues.estado === "POR_APROBAR" ? " (volvió a Por aprobar)" : "";
    return campos.length ? `Cambió ${campos.join(", ")}${volvio}` : null;
  }
  return null;
}

type Props = {
  tarjeta: TarjetaVista | null;
  tarjetas: TarjetaVista[];
  entrantes: string[];
  salientes: string[];
  abierta: boolean;
  lado: "bottom" | "right";
  puedeAprobar: boolean;
  alCerrar: () => void;
  alElegir: (tarjetaId: string) => void;
  alAprobar: () => void;
};

/** La ficha de una tarjeta: el detalle, sus flechas, el historial y el botón Aprobar. */
export function FichaTarjeta({
  tarjeta,
  tarjetas,
  entrantes,
  salientes,
  abierta,
  lado,
  puedeAprobar,
  alCerrar,
  alElegir,
  alAprobar,
}: Props) {
  const [aprobando, empezarAprobar] = useTransition();
  const [historial, setHistorial] = useState<{ tarjetaId: string; cambios: CambioDeTarjetaVista[] } | null>(null);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  const titulo = new Map(tarjetas.map((otra) => [otra.id, otra.titulo]));
  const historialDeEsta = tarjeta && historial?.tarjetaId === tarjeta.id ? historial.cambios : null;

  const aprobar = () => {
    if (!tarjeta) return;
    const id = tarjeta.id;
    const vistaEn = tarjeta.actualizadoEn;
    empezarAprobar(async () => {
      const resultado = await aprobarTarjetaAction(id, vistaEn);
      if (resultado.ok) {
        toast.success("Aprobada");
        setHistorial(null);
        alAprobar();
      } else {
        toast.error(resultado.error);
        alAprobar();
      }
    });
  };

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
                <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", color.pastilla)}>
                  {NOMBRE_DEL_ESTADO[tarjeta.estado]}
                </span>
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
              {tarjeta.detalle ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{tarjeta.detalle}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Sin detalle.</p>
              )}

              {tarjeta.estado === "POR_APROBAR" && puedeAprobar ? (
                <Button className="h-11 w-full text-base" onClick={aprobar} disabled={aprobando}>
                  {aprobando ? <Loader2 className="animate-spin" /> : <Check />}
                  Aprobar
                </Button>
              ) : null}
              {tarjeta.estado === "POR_APROBAR" && !puedeAprobar ? (
                <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                  Espera la aprobación del dueño.
                </p>
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

              <div className="space-y-2">
                {historialDeEsta ? (
                  <>
                    <p className="text-xs font-medium text-muted-foreground">Historial</p>
                    <ol className="space-y-1.5">
                      {historialDeEsta.map((cambio) => {
                        const resumen = resumenDelCambio(cambio);
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
