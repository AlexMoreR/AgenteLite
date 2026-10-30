"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { elegirResponsableDeSistemasAction } from "@/app/actions/alertas-actions";

/** Selector del responsable de Sistemas (solo lo ve un jefe). "Nadie" = todas las alertas del negocio se ven como antes. */
export function ResponsableDeSistemas({ equipo, actualId }: { equipo: { id: string; nombre: string }[]; actualId: string | null }) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const elegir = (valor: string) => {
    setError(null);
    empezar(async () => {
      const resultado = await elegirResponsableDeSistemasAction(valor || null);
      if (!resultado.ok) setError(resultado.error);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Responsable de Sistemas:</span>
        <select
          className="min-h-9 rounded-md border bg-background px-2 text-sm"
          value={actualId ?? ""}
          disabled={pendiente}
          onChange={(e) => elegir(e.target.value)}
        >
          <option value="">Nadie (todas se ven juntas)</option>
          {equipo.map((persona) => (
            <option key={persona.id} value={persona.id}>
              {persona.nombre}
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
