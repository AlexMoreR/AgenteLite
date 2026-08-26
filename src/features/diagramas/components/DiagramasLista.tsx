"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { borrarDiagramaAction, crearDiagramaAction } from "@/app/actions/diagram-actions";

type DiagramaDeLaLista = {
  id: string;
  titulo: string;
  actualizado: string;
  ideas: number;
};

/**
 * La lista de mapas mentales.
 *
 * Ordenada por el último tocado y no por fecha de creación: uno vuelve a lo que estaba pensando,
 * no a lo que empezó primero.
 */
export function DiagramasLista({ diagramas }: { diagramas: DiagramaDeLaLista[] }) {
  const router = useRouter();
  const [creando, setCreando] = useState(false);
  const [, startTransition] = useTransition();

  const crear = () => {
    setCreando(true);
    startTransition(async () => {
      const resultado = await crearDiagramaAction();
      setCreando(false);
      if (resultado.error || !resultado.id) {
        toast.error(resultado.error ?? "No se pudo crear el diagrama.");
        return;
      }
      // Se entra directo al lienzo: crear uno y quedarse mirando la lista no le sirve a nadie.
      router.push(`/cliente/diagramas/${resultado.id}`);
    });
  };

  const borrar = (diagrama: DiagramaDeLaLista) => {
    if (!window.confirm(`¿Borrar "${diagrama.titulo}"? No se puede deshacer.`)) {
      return;
    }
    startTransition(async () => {
      const resultado = await borrarDiagramaAction(diagrama.id);
      if (resultado.error) {
        toast.error(resultado.error);
        return;
      }
      toast.success("Diagrama borrado");
      router.refresh();
    });
  };

  return (
    <section className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5">
      <div className="flex justify-end">
        <Button size="sm" onClick={crear} disabled={creando} className="gap-1.5">
          {creando ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Nuevo diagrama
        </Button>
      </div>

      {diagramas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-12 text-center">
          <Share2 className="mx-auto mb-2 size-6 text-muted-foreground" />
          <p className="text-sm font-medium">Todavía no hay diagramas</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            Un lienzo en blanco para pensar: poné una idea, sacale ramas y unilas. Son solo tuyos.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {diagramas.map((diagrama) => (
            <div
              key={diagrama.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
            >
              <Link href={`/cliente/diagramas/${diagrama.id}`} className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {diagrama.titulo}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {diagrama.ideas === 0
                    ? "Vacío"
                    : `${diagrama.ideas} ${diagrama.ideas === 1 ? "idea" : "ideas"}`}
                  {" · "}
                  {formatearFecha(diagrama.actualizado)}
                </span>
              </Link>

              <button
                type="button"
                onClick={() => borrar(diagrama)}
                aria-label={`Borrar ${diagrama.titulo}`}
                title="Borrar"
                className="shrink-0 rounded-full p-2 text-muted-foreground transition hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** "Hoy" y "Ayer" en vez de la fecha: es lo que uno necesita para encontrar en qué estaba. */
function formatearFecha(iso: string) {
  const fecha = new Date(iso);
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" });
  const hoy = dia.format(new Date());
  const ayer = dia.format(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const suyo = dia.format(fecha);

  if (suyo === hoy) {
    return "Hoy";
  }
  if (suyo === ayer) {
    return "Ayer";
  }
  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
    timeZone: "America/Bogota",
  }).format(fecha);
}
