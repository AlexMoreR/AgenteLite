"use client";

import { useState, useTransition } from "react";

import { cambiarInterruptorDelAgenteAction } from "@/app/actions/agentes-de-area-actions";
import { Switch } from "@/components/ui/switch";

/** El interruptor del agente de un área. Empieza apagado: con él apagado no sale ningún WhatsApp. */
export function InterruptorDelAgente({ area, activo }: { area: string; activo: boolean }) {
  const [valor, setValor] = useState(activo);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();

  const cambiar = (nuevo: boolean) => {
    setError(null);
    empezar(async () => {
      const resultado = await cambiarInterruptorDelAgenteAction(area, nuevo);
      if (resultado.ok) setValor(resultado.activo);
      else setError(resultado.error);
    });
  };

  return (
    <div className="space-y-1">
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>
          {area === "sistemas"
            ? valor
              ? "Prendido: su línea va en el mensaje de las 7:30 y crea las tarjetas de arreglo"
              : "Apagado: solo genera el resumen; no sale en el mensaje ni crea tarjetas"
            : valor
              ? "Prendido: los mensajes salen"
              : "Apagado: no sale ningún mensaje"}
        </span>
        <Switch checked={valor} disabled={pendiente} onCheckedChange={cambiar} />
      </label>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
