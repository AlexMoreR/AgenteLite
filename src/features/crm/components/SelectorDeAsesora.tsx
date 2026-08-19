"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Users } from "lucide-react";

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/**
 * De quien son los leads que se estan viendo.
 *
 * Solo se muestra al dueño y a los ADMIN. Una asesora no elige: ve lo suyo y punto, porque los
 * numeros del negocio no le dicen nada de su trabajo y le mostraban las ventas de las compañeras.
 *
 * La eleccion viaja en la direccion (`?userId=`) y no en un estado del navegador: asi el jefe
 * puede guardar o mandar el enlace de "el registro de Ingrid" y abre lo mismo.
 */
export function SelectorDeAsesora({
  asesoras,
  elegida,
}: {
  asesoras: Array<{ id: string; nombre: string }>;
  elegida: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pendiente, arrancar] = useTransition();

  if (asesoras.length === 0) {
    return null;
  }

  const cambiar = (valor: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (valor) {
      params.set("userId", valor);
    } else {
      params.delete("userId");
    }
    const query = params.toString();
    arrancar(() => {
      router.push(query ? `?${query}` : "?");
    });
  };

  return (
    <div className="inline-flex items-center gap-2">
      <Users className="size-4 shrink-0 text-muted-foreground" />
      <NativeSelect
        value={elegida}
        disabled={pendiente}
        aria-label="Ver los leads de"
        onChange={(evento) => cambiar(evento.target.value)}
        className="h-9 min-w-44"
      >
        <NativeSelectOption value="">Todo el equipo</NativeSelectOption>
        {asesoras.map((asesora) => (
          <NativeSelectOption key={asesora.id} value={asesora.id}>
            {asesora.nombre}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
