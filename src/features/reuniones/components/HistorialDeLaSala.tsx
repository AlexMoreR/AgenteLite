"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { EstadoReunion } from "@prisma/client";
import { CalendarClock } from "lucide-react";

import { ESTADOS_EN_CURSO } from "@/features/reuniones/estados";
import { EtiquetaDeEstado, formatearFecha } from "@/features/reuniones/components/ReunionesWorkspace";

/*
  HISTORIAL DE UNA SALA FIJA: todas sus reuniones, la más nueva primero, con la fecha en que empezó de
  verdad, cuánto duró, quién entró, el estado y el resumen del acta. Cada fila abre el detalle
  (/cliente/reuniones/<id>). Mientras alguna está en vivo o en la cola, se pone al día sola.
*/

export type ReunionDelHistorialDeLaPantalla = {
  id: string;
  titulo: string;
  estado: EstadoReunion;
  sinGrabar: boolean;
  /** Cuándo entró el primero (o cuándo se creó, si nadie entró). */
  empezoEn: string | null;
  terminoEn: string | null;
  creada: string;
  participantes: string[];
  resumen: string | null;
};

/** "1 h 5 min", "12 min" o "menos de 1 min". */
export function duracion(desde: string, hasta: string) {
  const minutos = Math.round((new Date(hasta).getTime() - new Date(desde).getTime()) / 60_000);
  if (minutos < 1) {
    return "menos de 1 min";
  }
  const horas = Math.floor(minutos / 60);
  return horas ? `${horas} h ${minutos % 60} min` : `${minutos} min`;
}

export function HistorialDeLaSala({ reuniones }: { reuniones: ReunionDelHistorialDeLaPantalla[] | null }) {
  const router = useRouter();
  const enCurso = Boolean(reuniones?.some((reunion) => ESTADOS_EN_CURSO.includes(reunion.estado)));
  useEffect(() => {
    if (!enCurso) {
      return;
    }
    const reloj = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, 15_000);
    return () => window.clearInterval(reloj);
  }, [enCurso, router]);

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">Historial</h2>
      {reuniones === null ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No se pudo cargar el historial. Recarga la página.
        </p>
      ) : reuniones.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
          <CalendarClock className="mx-auto mb-2 size-5 text-muted-foreground" />
          <p className="text-sm font-medium">Todavía no hay reuniones en esta sala</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">Toca «Iniciar» para empezar la primera. Aquí quedan todas, con su acta.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {reuniones.map((reunion) => (
            <Link
              key={reunion.id}
              href={`/cliente/reuniones/${reunion.id}`}
              className="block space-y-1 rounded-xl border border-border bg-card px-3 py-2.5 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                  {formatearFecha(reunion.empezoEn ?? reunion.creada)}
                  {reunion.empezoEn && reunion.terminoEn ? (
                    <span className="font-normal text-muted-foreground"> · {duracion(reunion.empezoEn, reunion.terminoEn)}</span>
                  ) : null}
                </span>
                <EtiquetaDeEstado estado={reunion.estado} sinGrabar={reunion.sinGrabar} />
              </div>
              <p className="text-xs text-muted-foreground">
                {reunion.participantes.length ? `Entraron: ${reunion.participantes.join(", ")}` : "Nadie entró"}
              </p>
              {reunion.resumen ? <p className="line-clamp-3 text-sm text-foreground">{reunion.resumen}</p> : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
