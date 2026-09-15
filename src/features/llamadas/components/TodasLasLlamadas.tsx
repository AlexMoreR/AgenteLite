"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";

import { llamadasDelEquipoAction, type LlamadaDelEquipo } from "@/app/actions/call-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const CUANDO = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

type Estado = { filtro: boolean; llamadas: LlamadaDelEquipo[]; hayMas: boolean; pagina: number; error: string | null };

/**
 * Todas las llamadas del equipo con su grabacion, para el dueño (Alex, 15-sep-2026).
 *
 * Se carga aparte de la pagina y de a 30: con grabaciones de por medio la lista crece rapido, y el
 * resto del tablero no tiene por que esperarla. `preload="none"` en cada audio para no bajar 30
 * archivos al abrir.
 */
export function TodasLasLlamadas() {
  const [soloConGrabacion, setSoloConGrabacion] = useState(false);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [cargandoMas, setCargandoMas] = useState(false);
  const cargando = estado?.filtro !== soloConGrabacion;

  useEffect(() => {
    let vigente = true;
    llamadasDelEquipoAction({ pagina: 0, soloConGrabacion })
      .then((respuesta) => {
        if (!vigente) return;
        setEstado(
          "error" in respuesta
            ? { filtro: soloConGrabacion, llamadas: [], hayMas: false, pagina: 0, error: respuesta.error }
            : { filtro: soloConGrabacion, llamadas: respuesta.llamadas, hayMas: respuesta.hayMas, pagina: 0, error: null },
        );
      })
      .catch(() => {
        if (vigente) {
          setEstado({ filtro: soloConGrabacion, llamadas: [], hayMas: false, pagina: 0, error: "No se pudieron cargar las llamadas" });
        }
      });
    return () => {
      vigente = false;
    };
  }, [soloConGrabacion]);

  const verMas = async () => {
    if (!estado || cargandoMas) return;
    setCargandoMas(true);
    try {
      const siguiente = estado.pagina + 1;
      const respuesta = await llamadasDelEquipoAction({ pagina: siguiente, soloConGrabacion });
      if (!("error" in respuesta)) {
        setEstado({ ...estado, llamadas: [...estado.llamadas, ...respuesta.llamadas], hayMas: respuesta.hayMas, pagina: siguiente });
      }
    } finally {
      setCargandoMas(false);
    }
  };

  const filtros = [
    { valor: false, etiqueta: "Todas" },
    { valor: true, etiqueta: "Con grabación" },
  ];

  return (
    <Card className="md:col-span-2">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm">Todas las llamadas</CardTitle>
        <div className="flex gap-1.5">
          {filtros.map((filtro) => (
            <button
              key={filtro.etiqueta}
              type="button"
              onClick={() => setSoloConGrabacion(filtro.valor)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                soloConGrabacion === filtro.valor
                  ? "bg-[var(--primary)] text-white"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {filtro.etiqueta}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {cargando ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Cargando…
          </div>
        ) : estado?.error ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{estado.error}</p>
        ) : !estado || estado.llamadas.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {soloConGrabacion ? "Todavía no hay llamadas grabadas." : "Todavía no hay llamadas."}
          </p>
        ) : (
          <>
            {estado.llamadas.map((llamada) => (
              <div key={llamada.id} className="rounded-lg border border-border px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{llamada.cliente}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {CUANDO.format(new Date(llamada.calledAt))} · {llamada.asesora} · {llamada.telefono}
                    </p>
                  </div>
                  {llamada.conversationId ? (
                    <Link
                      href={`/cliente/chats?chatKey=${encodeURIComponent(`agent:${llamada.conversationId}`)}`}
                      aria-label="Abrir el chat"
                      title="Abrir el chat"
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-emerald-600 transition hover:bg-muted"
                    >
                      <MessageCircle className="size-4" />
                    </Link>
                  ) : null}
                </div>
                <p className={`mt-1 text-xs ${llamada.pendiente ? "text-amber-600" : "text-foreground/80"}`}>
                  {llamada.pendiente ? "Sin clasificar" : llamada.resultado}
                  {llamada.resumen ? <span className="text-muted-foreground"> · {llamada.resumen}</span> : null}
                </p>
                {llamada.resumenIa ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/70">IA:</span> {llamada.resumenIa}
                  </p>
                ) : null}
                {llamada.grabacion ? (
                  <audio controls preload="none" src={llamada.grabacion} className="mt-1.5 h-8 w-full" />
                ) : null}
              </div>
            ))}
            {estado.hayMas ? (
              <Button type="button" variant="outline" className="w-full" onClick={() => void verMas()} disabled={cargandoMas}>
                {cargandoMas ? <Loader2 className="size-4 animate-spin" /> : null}
                Ver más
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
