"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { guardarReglaDeDemoraAction } from "@/app/actions/equipo-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type CambioDeDemoraParaPantalla = {
  /** Fecha y hora ya en texto, en hora de Colombia (la arma el servidor). */
  cuando: string;
  quien: string;
  resumen: string;
};

/**
 * Tarjeta de Equipo para prender o apagar la regla de demora de asesora (aviso a los 5 min, el chat
 * pasa a otra asesora activa a los 10). Muestra el estado guardado en la misma fila que usa la regla.
 */
export function ReglaDeDemoraDeAsesora({
  activo,
  minutosAviso,
  minutosReasignar,
  cambios,
}: {
  activo: boolean;
  minutosAviso: number;
  minutosReasignar: number;
  /** Los últimos cambios, del más nuevo al más viejo. */
  cambios: CambioDeDemoraParaPantalla[];
}) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [prendida, setPrendida] = useState(activo);
  const [aviso, setAviso] = useState(String(minutosAviso));
  const [reasignar, setReasignar] = useState(String(minutosReasignar));
  const [error, setError] = useState("");

  function guardar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (
      prendida &&
      !activo &&
      !window.confirm(
        `¿Prender la regla? Si una asesora no responde en ${reasignar} min, los chats pasarán solos a otra asesora activa.`,
      )
    ) {
      return;
    }
    setError("");
    empezar(async () => {
      const resultado = await guardarReglaDeDemoraAction({
        activo: prendida,
        minutosAviso: aviso,
        minutosReasignar: reasignar,
      });
      if ("error" in resultado) {
        setError(resultado.error);
        return;
      }
      toast.success(prendida ? "Regla prendida" : "Regla apagada");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          Regla de demora de asesora
          <Badge variant={activo ? "default" : "secondary"}>{activo ? "Prendida" : "Apagada"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Aviso a la asesora a los {minutosAviso} min sin respuesta. A los {minutosReasignar} min el chat pasa a otra
          asesora activa.
        </p>
        <form onSubmit={guardar} className="space-y-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Regla de demora de asesora">
            <Button
              type="button"
              size="sm"
              variant={prendida ? "default" : "outline"}
              aria-pressed={prendida}
              onClick={() => setPrendida(true)}
            >
              Prendida
            </Button>
            <Button
              type="button"
              size="sm"
              variant={!prendida ? "default" : "outline"}
              aria-pressed={!prendida}
              onClick={() => setPrendida(false)}
            >
              Apagada
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="demora-minutos-aviso">Aviso (min)</Label>
              <Input
                id="demora-minutos-aviso"
                type="number"
                inputMode="numeric"
                min={1}
                max={120}
                step={1}
                value={aviso}
                onChange={(evento) => setAviso(evento.target.value)}
                className="w-24"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="demora-minutos-reasignar">Pasa a otra (min)</Label>
              <Input
                id="demora-minutos-reasignar"
                type="number"
                inputMode="numeric"
                min={2}
                max={120}
                step={1}
                value={reasignar}
                onChange={(evento) => setReasignar(evento.target.value)}
                className="w-24"
              />
            </div>
            <Button type="submit" size="sm" disabled={pendiente}>
              {pendiente ? "Guardando…" : "Guardar"}
            </Button>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </form>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Últimos cambios</p>
          {cambios.length ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {cambios.map((cambio, indice) => (
                <li key={`${cambio.cuando}-${indice}`} className="break-words">
                  {cambio.cuando} · {cambio.quien}: {cambio.resumen}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Todavía no hay cambios desde este botón.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
