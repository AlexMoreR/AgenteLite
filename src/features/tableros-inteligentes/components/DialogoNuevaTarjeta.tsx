"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { crearTarjetaAction } from "@/app/actions/tableros-inteligentes-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { TarjetaVista, TipoVista } from "../services/tableros";

/*
  «+ Nuevo» en el medio del espacio (28-nov-2026, pedido de Alex: armarlo como Notion, a mano).
  Dos pasos: primero el tipo (Área, Idea, Tarea… los del espacio), después el nombre y, si quiere, el
  detalle. Si está dentro de un nivel del mapa, nace colgando de esa tarjeta; solo se ofrecen los tipos
  que pueden colgar de ella (el servidor lo vuelve a revisar con revisarMadre).
*/

/** Los tipos que se pueden crear aquí: en la raíz, todos; dentro de una tarjeta, los que la aceptan como madre. */
export function tiposParaCrear(tipos: readonly TipoVista[], madre: Pick<TarjetaVista, "tipoId"> | null): TipoVista[] {
  const ordenados = [...tipos].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"));
  return madre ? ordenados.filter((tipo) => tipo.padres.includes(madre.tipoId)) : ordenados;
}

export function DialogoNuevaTarjeta({
  abierto,
  alCerrar,
  tableroId,
  tipos,
  madre,
  alCrear,
}: {
  abierto: boolean;
  alCerrar: () => void;
  tableroId: string;
  tipos: readonly TipoVista[];
  /** La tarjeta del nivel abierto del mapa (la nueva cuelga de ella), o null en la raíz. */
  madre: Pick<TarjetaVista, "id" | "titulo" | "tipoId"> | null;
  alCrear: (id: string) => void;
}) {
  const [tipoId, setTipoId] = useState<string | null>(null);
  const [titulo, setTitulo] = useState("");
  const [detalle, setDetalle] = useState("");
  const [guardando, setGuardando] = useState(false);
  const disponibles = useMemo(() => tiposParaCrear(tipos, madre), [tipos, madre]);
  const tipo = disponibles.find((candidato) => candidato.id === tipoId) ?? null;

  const reiniciar = () => {
    setTipoId(null);
    setTitulo("");
    setDetalle("");
  };

  const cerrar = () => {
    if (guardando) return;
    reiniciar();
    alCerrar();
  };

  const crear = async (evento: FormEvent) => {
    evento.preventDefault();
    if (!tipo || !titulo.trim() || guardando) return;
    setGuardando(true);
    const resultado = await crearTarjetaAction({
      tableroId,
      tipoId: tipo.id,
      titulo: titulo.trim(),
      detalle: detalle.trim(),
      padreId: madre?.id ?? null,
    }).catch(() => ({ ok: false as const, error: "No se pudo crear: revisa la conexión e inténtalo de nuevo." }));
    setGuardando(false);
    if (!resultado.ok) {
      toast.error(resultado.error);
      return;
    }
    toast.success(`${tipo.nombre} creada: ${titulo.trim()}`);
    reiniciar();
    alCerrar();
    alCrear(resultado.id);
  };

  return (
    <Dialog open={abierto} onOpenChange={(abrir) => (abrir ? undefined : cerrar())}>
      <DialogContent className="sm:max-w-md">
        {!tipo ? (
          <>
            <DialogHeader>
              <DialogTitle>¿Qué quieres crear?</DialogTitle>
              {madre ? <DialogDescription>Va dentro de «{madre.titulo}».</DialogDescription> : null}
            </DialogHeader>
            {disponibles.length ? (
              <div className="grid gap-2">
                {disponibles.map((candidato) => (
                  <button
                    key={candidato.id}
                    type="button"
                    onClick={() => setTipoId(candidato.id)}
                    className="flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition hover:bg-muted"
                  >
                    <span
                      className="size-3 shrink-0 rounded-full"
                      style={{ background: candidato.color || "var(--muted-foreground)" }}
                      aria-hidden
                    />
                    {candidato.nombre}
                  </button>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                Dentro de «{madre?.titulo}» no puede ir ningún tipo. Sube un nivel o cámbialo en el panel Tipos.
              </p>
            )}
          </>
        ) : (
          <form onSubmit={crear} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Nueva {tipo.nombre.toLowerCase()}</DialogTitle>
              {madre ? <DialogDescription>Va dentro de «{madre.titulo}».</DialogDescription> : null}
            </DialogHeader>
            <Input
              autoFocus
              value={titulo}
              onChange={(evento) => setTitulo(evento.target.value)}
              placeholder="Nombre"
              maxLength={200}
              aria-label="Nombre"
              className="h-11 md:h-10"
            />
            <Textarea
              value={detalle}
              onChange={(evento) => setDetalle(evento.target.value)}
              placeholder="Detalle (opcional)"
              aria-label="Detalle"
              rows={4}
            />
            <DialogFooter className="sm:justify-between">
              <Button type="button" variant="ghost" disabled={guardando} onClick={() => setTipoId(null)}>
                <ArrowLeft />
                Otro tipo
              </Button>
              <Button type="submit" disabled={guardando || !titulo.trim()}>
                {guardando ? <Loader2 className="animate-spin" /> : <Plus />}
                Crear
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
