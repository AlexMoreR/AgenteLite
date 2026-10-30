"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { iniciarReunionDeSalaAction } from "@/app/actions/reuniones-actions";

/** Cada cuánto el invitado vuelve a preguntar si ya empezó. */
const ESPERA_MS = 15_000;

/**
 * La puerta del link fijo de una sala cuando no hay reunión abierta.
 * Quien puede iniciar ve «Iniciar reunión»; el invitado espera y la página se refresca sola:
 * cuando alguien la inicia, el servidor lo manda a la reunión.
 */
export function EntradaALaSala({ salaId, nombre, puedeIniciar }: { salaId: string; nombre: string; puedeIniciar: boolean }) {
  const router = useRouter();
  const [iniciando, setIniciando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (puedeIniciar) {
      return;
    }
    const intervalo = window.setInterval(() => router.refresh(), ESPERA_MS);
    return () => window.clearInterval(intervalo);
  }, [puedeIniciar, router]);

  const iniciar = async () => {
    setIniciando(true);
    setError(null);
    try {
      const resultado = await iniciarReunionDeSalaAction(salaId);
      if (!resultado.codigo) {
        setError(resultado.error ?? "No se pudo iniciar la reunión. Intenta de nuevo.");
        setIniciando(false);
        return;
      }
      // Se queda "iniciando" mientras navega, para que no se oprima dos veces.
      router.push(`/reunion/${encodeURIComponent(resultado.codigo)}`);
    } catch {
      setError("No hay conexión. Intenta de nuevo.");
      setIniciando(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card px-5 py-6">
        <div className="space-y-1 text-center">
          <Video className="mx-auto size-7 text-primary" />
          <h1 className="text-lg font-semibold break-words">{nombre}</h1>
        </div>

        {puedeIniciar ? (
          <>
            <p className="text-center text-sm text-muted-foreground">No hay ninguna reunión abierta en esta sala.</p>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="button" size="lg" className="w-full" disabled={iniciando} onClick={iniciar}>
              {iniciando ? <Loader2 className="animate-spin" /> : null}
              Iniciar reunión
            </Button>
          </>
        ) : (
          <div className="space-y-1 text-center">
            <p className="text-sm font-medium">La reunión todavía no empieza</p>
            <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Deja esta página abierta: te lleva a la reunión cuando la inicien.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
