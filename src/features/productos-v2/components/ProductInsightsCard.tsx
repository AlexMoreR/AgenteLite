"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Resumen = {
  leidas: number;
  pendientes: number;
  porMotivo: Array<{ motivo: string; cantidad: number }>;
  porUltimaFrase: Array<{ frase: string; cantidad: number }>;
  ejemplos: Array<{ conversationId: string; summary: string; motivo: string | null }>;
};

/**
 * Por que se caen los leads de este producto.
 *
 * La IA lee cada conversacion y deja escrito que pidio el cliente y por que se corto. Se dispara a
 * mano y por tandas —no automatico— porque cada conversacion es una llamada paga: conviene que
 * quien la paga decida cuando y sobre que.
 */
export function ProductInsightsCard({
  productId,
  resumen,
}: {
  productId: string;
  resumen: Resumen;
}) {
  const router = useRouter();
  const [corriendo, setCorriendo] = useState(false);
  const [restantes, setRestantes] = useState(resumen.pendientes);

  const leer = async (forzar = false) => {
    setCorriendo(true);
    let total = 0;
    try {
      // De a 10 y hasta 40 tandas por vez: si hay cientos, se corre el boton de nuevo. Asi nunca
      // hay una peticion eterna que se caiga a la mitad sin saber donde quedo.
      for (let tanda = 0; tanda < 40; tanda += 1) {
        const respuesta = await fetch(
          `/api/cliente/productos-v2/insights?productId=${encodeURIComponent(productId)}&limit=10${forzar ? "&force=1" : ""}`,
          { method: "POST", credentials: "same-origin", cache: "no-store" },
        );
        const datos = (await respuesta.json()) as {
          ok?: boolean;
          error?: string;
          leidas?: number;
          restantes?: number;
        };
        if (!datos.ok) {
          toast.error(datos.error || "No se pudieron leer las conversaciones");
          break;
        }
        total += datos.leidas ?? 0;
        setRestantes(datos.restantes ?? 0);
        // Refrescar en cada tanda y no al final: leer 800 conversaciones son varios minutos, y
        // mirar "Leyendo..." sin que se mueva nada parece que se colgo.
        router.refresh();
        if (!datos.leidas || (!forzar && !datos.restantes)) {
          break;
        }
      }
      toast.success(total > 0 ? `${total} conversaciones leídas` : "No había nada nuevo para leer");
      router.refresh();
    } catch {
      toast.error("Se cortó la lectura. Volvé a intentar y sigue donde quedó.");
    } finally {
      setCorriendo(false);
    }
  };

  const totalCaidas = resumen.porMotivo.reduce((suma, fila) => suma + fila.cantidad, 0);

  return (
    <Card>
      <CardHeader className="pb-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">Por qué se caen</CardTitle>
          <span className="text-xs text-muted-foreground">
            {resumen.leidas} leídas
            {restantes > 0 ? ` · ${restantes} sin leer` : ""}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {totalCaidas === 0 ? (
          <p className="text-xs text-muted-foreground">
            Todavía sin lecturas. La IA lee cada conversación y deja escrito qué pidió el cliente y
            por qué se cortó.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {resumen.porMotivo.map((fila) => {
              const pct = Math.round((fila.cantidad / totalCaidas) * 100);
              return (
                <li key={fila.motivo} className="flex items-center gap-2 text-xs">
                  <span className="w-32 shrink-0 capitalize text-muted-foreground">{fila.motivo}</span>
                  <span className="hidden h-2 flex-1 overflow-hidden rounded-full bg-muted sm:block">
                    <span className="block h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="ml-auto w-20 shrink-0 text-right tabular-nums text-foreground sm:ml-0">
                    {fila.cantidad} · {pct}%
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {resumen.porUltimaFrase.length > 0 ? (
          <div className="space-y-1.5 border-t border-border pt-3">
            <p className="text-xs font-medium text-foreground">Lo último que dijimos antes del silencio</p>
            {resumen.porUltimaFrase.map((fila) => (
              <div key={fila.frase} className="flex items-start gap-2 text-xs">
                <span className="w-10 shrink-0 tabular-nums text-foreground">{fila.cantidad}×</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{fila.frase}</span>
              </div>
            ))}
          </div>
        ) : null}

        {resumen.ejemplos.length > 0 ? (
          <div className="space-y-1.5 border-t border-border pt-3">
            <p className="text-xs font-medium text-foreground">Últimos casos</p>
            {resumen.ejemplos.map((ejemplo) => (
              <Link
                key={ejemplo.conversationId}
                href={`/cliente/chats?chatKey=agent:${ejemplo.conversationId}`}
                className="block truncate text-xs text-muted-foreground transition hover:text-foreground"
              >
                {ejemplo.motivo ? <span className="capitalize">{ejemplo.motivo}</span> : "Caso"} ·{" "}
                {ejemplo.summary}
              </Link>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void leer()} disabled={corriendo}>
            <Sparkles className="h-4 w-4" />
            {corriendo ? "Leyendo…" : restantes > 0 ? `Leer ${restantes} conversaciones` : "Buscar nuevas"}
          </Button>
          {/* Volver a leer lo ya leido: hace falta cuando se corrige como clasifica, si no las
              lecturas viejas quedan para siempre y no hay forma de saber si el arreglo sirvio. */}
          {resumen.leidas > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void leer(true)}
              disabled={corriendo}
            >
              Releer las {resumen.leidas} ya leídas
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
