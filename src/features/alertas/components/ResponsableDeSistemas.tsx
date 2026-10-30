"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { elegirResponsableDeSistemasAction } from "@/app/actions/alertas-actions";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

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

  // Si el responsable guardado ya no está en la lista (salió del equipo o no se pudo leer), se muestra igual: no parece "Nadie".
  const fueraDeLaLista = !!actualId && !equipo.some((persona) => persona.id === actualId);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Responsable de Sistemas:</span>
        <NativeSelect className="max-w-full" value={actualId ?? ""} disabled={pendiente} onChange={(e) => elegir(e.target.value)}>
          <NativeSelectOption value="">Nadie (se ven juntas)</NativeSelectOption>
          {fueraDeLaLista ? <NativeSelectOption value={actualId}>Persona que ya no está en el equipo</NativeSelectOption> : null}
          {equipo.map((persona) => (
            <NativeSelectOption key={persona.id} value={persona.id}>
              {persona.nombre}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      {equipo.length === 0 ? <p className="text-xs text-muted-foreground">No se pudo leer el equipo. Vuelve a intentar en un momento.</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
