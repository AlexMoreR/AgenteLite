"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { guardarAvisosDelTableroAction } from "@/app/actions/avisos-al-equipo-actions";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

/** Casilla del perfil: recibir por WhatsApp los avisos del Tablero IA (tarea asignada, urgente, el Coordinador necesita algo). */
export function AvisosDelTablero({ defaultActivo }: { defaultActivo: boolean }) {
  const [activo, setActivo] = useState(defaultActivo);
  const [guardando, empezar] = useTransition();

  function cambiar(valor: boolean) {
    const anterior = activo;
    setActivo(valor);
    empezar(async () => {
      const resultado = await guardarAvisosDelTableroAction(valor);
      if (!resultado.ok) {
        setActivo(anterior);
        toast.error(resultado.error);
        return;
      }
      toast.success(valor ? "Recibirás los avisos del Tablero IA por WhatsApp." : "Ya no recibirás avisos del Tablero IA por WhatsApp.");
    });
  }

  return (
    <Card className="p-5">
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-sm font-semibold text-slate-900">Recibir avisos del Tablero IA por WhatsApp</span>
          <span className="block text-xs text-slate-500">
            Cuando te asignan una tarea, es urgente o el Coordinador necesita algo tuyo. Llegan al número de avisos de Mi empresa → Equipo.
          </span>
        </span>
        <Switch checked={activo} disabled={guardando} onCheckedChange={cambiar} aria-label="Recibir avisos del Tablero IA por WhatsApp" />
      </label>
    </Card>
  );
}
