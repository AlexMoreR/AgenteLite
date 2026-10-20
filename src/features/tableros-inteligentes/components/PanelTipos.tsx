"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  borrarTipoAction,
  crearTipoAction,
  editarTipoAction,
  type DatosTipoPantalla,
} from "@/app/actions/tableros-inteligentes-actions";
import { ICONOS_DE_TIPO } from "../services/reglas";
import type { TipoVista } from "../services/tableros";
import { IconoDeTipo } from "./IconoDeTipo";

/*
  Panel "Tipos" del Tablero IA: los tipos de tarjeta del tablero abierto (Área, Idea, Tarea...).
  El dueño (o el ADMIN de la plataforma) crea y edita nombre, color, ícono, si tiene estados (Área
  no: es una carpeta), si pide aprobación, de qué tipos puede colgar (también de sí mismo: Área dentro
  de Área) y el orden, y borra los que ninguna tarjeta usa. Los demás solo los ven.
  Quitarle la aprobación a un tipo solo se puede acá (Claude no puede), y no con tarjetas APROBADAS
  o EN_CURSO de ese tipo (lo comprueba el servicio).
*/

type Props = {
  abierto: boolean;
  alCerrar: () => void;
  lado: "bottom" | "right";
  tableroId: string;
  tipos: TipoVista[];
  /** Cuántas tarjetas (vivas) usa cada tipo. */
  usos: ReadonlyMap<string, number>;
  puedeEditar: boolean;
  alCambiar: () => void;
};

const NUEVO: DatosTipoPantalla = {
  nombre: "",
  color: "#71717a",
  icono: null,
  requiereAprobacion: false,
  usaEstados: true,
  orden: 0,
  padres: [],
};

function aDatos(tipo: TipoVista): DatosTipoPantalla {
  return {
    nombre: tipo.nombre,
    color: tipo.color,
    icono: tipo.icono,
    requiereAprobacion: tipo.requiereAprobacion,
    usaEstados: tipo.usaEstados,
    orden: tipo.orden,
    padres: tipo.padres,
  };
}

function FormularioDeTipo({
  tipoId,
  inicial,
  tipos,
  puedeEditar,
  usos,
  tableroId,
  alListo,
}: {
  tipoId: string | null;
  inicial: DatosTipoPantalla;
  tipos: TipoVista[];
  puedeEditar: boolean;
  usos: number;
  tableroId: string;
  alListo: () => void;
}) {
  const [datos, setDatos] = useState(inicial);
  const [guardando, empezar] = useTransition();
  const cambiar = (parte: Partial<DatosTipoPantalla>) => setDatos((previo) => ({ ...previo, ...parte }));

  const guardar = () =>
    empezar(async () => {
      const resultado = tipoId ? await editarTipoAction(tipoId, datos) : await crearTipoAction(tableroId, datos);
      if (resultado.ok) {
        toast.success(tipoId ? "Tipo guardado" : "Tipo creado");
        alListo();
      } else {
        toast.error(resultado.error);
      }
    });

  const borrar = () =>
    empezar(async () => {
      if (!tipoId) return;
      const resultado = await borrarTipoAction(tipoId);
      if (resultado.ok) {
        toast.success("Tipo borrado");
        alListo();
      } else {
        toast.error(resultado.error);
      }
    });

  // También el propio tipo: un Área puede ir dentro de otra Área. (Un tipo nuevo, todavía sin id, no.)
  const otros = tipoId ? tipos : tipos.filter((tipo) => tipo.id !== tipoId);
  return (
    <fieldset disabled={!puedeEditar || guardando} className="space-y-3">
      <div className="flex gap-2">
        <label className="flex-1 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Nombre</span>
          <Input value={datos.nombre} maxLength={40} onChange={(evento) => cambiar({ nombre: evento.target.value })} />
        </label>
        <label className="w-16 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Color</span>
          <input
            type="color"
            value={datos.color}
            onChange={(evento) => cambiar({ color: evento.target.value })}
            className="h-8 w-full cursor-pointer rounded-lg border bg-card p-0.5"
            aria-label="Color del tipo"
          />
        </label>
        <label className="w-16 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Orden</span>
          <Input
            type="number"
            value={datos.orden}
            onChange={(evento) => cambiar({ orden: Number(evento.target.value) || 0 })}
          />
        </label>
      </div>

      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Ícono</span>
        <div className="flex flex-wrap gap-1">
          {ICONOS_DE_TIPO.map((icono) => (
            <button
              key={icono}
              type="button"
              onClick={() => cambiar({ icono: datos.icono === icono ? null : icono })}
              aria-pressed={datos.icono === icono}
              aria-label={icono}
              title={icono}
              className={cn(
                "flex size-8 items-center justify-center rounded-lg border",
                datos.icono === icono ? "border-primary bg-primary/10" : "hover:bg-muted",
              )}
            >
              <IconoDeTipo icono={icono} color={datos.color} className="size-4" />
            </button>
          ))}
        </div>
      </div>

      <label className="flex min-h-10 items-start gap-2 text-sm">
        <Checkbox
          checked={datos.usaEstados}
          onCheckedChange={(valor) =>
            cambiar(valor ? { usaEstados: true } : { usaEstados: false, requiereAprobacion: false })
          }
          className="mt-0.5"
        />
        <span>
          Tiene estados
          <span className="block text-xs text-muted-foreground">
            Sin estados es una carpeta (como Área): solo agrupa, no se aprueba ni cuenta en los filtros.
          </span>
        </span>
      </label>

      <label className="flex min-h-10 items-start gap-2 text-sm">
        <Checkbox
          checked={datos.requiereAprobacion}
          disabled={!datos.usaEstados}
          onCheckedChange={(valor) => cambiar({ requiereAprobacion: Boolean(valor) })}
          className="mt-0.5"
        />
        <span>
          Pide aprobación del dueño
          <span className="block text-xs text-muted-foreground">
            Sus tarjetas pasan por “Por aprobar” y solo se ejecutan aprobadas.
          </span>
        </span>
      </label>

      {otros.length ? (
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Puede colgar de</span>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {otros.map((otro) => (
              <label key={otro.id} className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  checked={datos.padres.includes(otro.id)}
                  onCheckedChange={(valor) =>
                    cambiar({
                      padres: valor ? [...datos.padres, otro.id] : datos.padres.filter((id) => id !== otro.id),
                    })
                  }
                />
                <IconoDeTipo icono={otro.icono} color={otro.color} className="size-3.5" />
                {otro.id === tipoId ? `${otro.nombre} (el mismo)` : otro.nombre}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {puedeEditar ? (
        <div className="flex items-center gap-2 pt-1">
          <Button className="h-10" onClick={guardar} disabled={!datos.nombre.trim()}>
            {guardando ? <Loader2 className="animate-spin" /> : null}
            {tipoId ? "Guardar" : "Crear tipo"}
          </Button>
          {tipoId ? (
            <Button
              variant="ghost"
              className="ml-auto h-10 text-destructive"
              onClick={borrar}
              disabled={usos > 0}
              title={usos > 0 ? "Lo usan tarjetas: no se puede borrar" : "Borrar este tipo"}
            >
              <Trash2 /> Borrar
            </Button>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}

export function PanelTipos({ abierto, alCerrar, lado, tableroId, tipos, usos, puedeEditar, alCambiar }: Props) {
  const [abiertoId, setAbiertoId] = useState<string | null>(null);
  const nombres = new Map(tipos.map((tipo) => [tipo.id, tipo.nombre]));

  const listo = () => {
    setAbiertoId(null);
    alCambiar();
  };

  return (
    <Sheet open={abierto} onOpenChange={(abrir) => (!abrir ? alCerrar() : undefined)}>
      <SheetContent
        side={lado}
        className={cn("gap-0 overflow-y-auto", lado === "bottom" ? "max-h-[85dvh] rounded-t-2xl" : "w-full sm:max-w-md")}
      >
        <SheetHeader className="pb-2">
          <SheetTitle>Tipos de tarjeta</SheetTitle>
          <SheetDescription>
            {puedeEditar
              ? "Qué clases de tarjeta tiene este tablero, de cuál puede colgar cada una y cuáles pide aprobar."
              : "Qué clases de tarjeta tiene este tablero. Los cambia el dueño."}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-2 px-4 pb-6">
          {tipos.map((tipo) => {
            const abiertoEste = abiertoId === tipo.id;
            const cuantas = usos.get(tipo.id) ?? 0;
            return (
              <div key={tipo.id} className="rounded-xl border">
                <button
                  type="button"
                  onClick={() => setAbiertoId(abiertoEste ? null : tipo.id)}
                  aria-expanded={abiertoEste}
                  className="flex min-h-12 w-full items-center gap-2 px-3 py-2.5 text-left"
                >
                  <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: tipo.color }} aria-hidden />
                  <IconoDeTipo icono={tipo.icono} color={tipo.color} className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {tipo.nombre}
                      {tipo.requiereAprobacion ? (
                        <ShieldCheck className="size-3.5 text-amber-600" aria-label="Pide aprobación" />
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {cuantas} tarjeta(s)
                      {tipo.padres.length ? ` · cuelga de ${tipo.padres.map((id) => nombres.get(id) ?? "?").join(", ")}` : ""}
                    </span>
                  </span>
                  <ChevronDown className={cn("size-4 shrink-0 transition-transform", abiertoEste && "rotate-180")} />
                </button>
                {abiertoEste ? (
                  <div className="border-t px-3 py-3">
                    <FormularioDeTipo
                      key={`${tipo.id}-${tipo.nombre}-${tipo.color}-${tipo.icono}-${tipo.requiereAprobacion}-${tipo.orden}-${tipo.padres.join()}`}
                      tipoId={tipo.id}
                      inicial={aDatos(tipo)}
                      tipos={tipos}
                      puedeEditar={puedeEditar}
                      usos={cuantas}
                      tableroId={tableroId}
                      alListo={listo}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}

          {puedeEditar ? (
            abiertoId === "nuevo" ? (
              <div className="rounded-xl border border-dashed px-3 py-3">
                <FormularioDeTipo
                  tipoId={null}
                  inicial={{ ...NUEVO, orden: Math.max(-1, ...tipos.map((tipo) => tipo.orden)) + 1 }}
                  tipos={tipos}
                  puedeEditar
                  usos={0}
                  tableroId={tableroId}
                  alListo={listo}
                />
              </div>
            ) : (
              <Button variant="outline" className="h-10" onClick={() => setAbiertoId("nuevo")}>
                <Plus /> Nuevo tipo
              </Button>
            )
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
