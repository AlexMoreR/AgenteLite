"use client";

import { useEffect, type ReactNode } from "react";

import { mostrarFotoDeLaBandeja } from "./guardado-local/foto-de-la-bandeja";

/*
  Lo guardado en el celular mientras carga la pantalla de Chats.

  Hasta el 11-11-2026 aca se dibujaba una version SIMPLIFICADA de las filas guardadas (sin pastillas,
  asesora, linea, etiquetas, etapa ni fijados) y al llegar la lista real todo cambiaba de forma: el
  brinco que vio Alex. Ahora lo guardado es la FOTO de la bandeja (guardado-local/foto-de-la-bandeja),
  identica a la lista real, y se pone ENCIMA de la pantalla:
  - al abrir la app, la pone el script de loading.tsx antes que cualquier JavaScript;
  - al llegar a Chats desde otra pantalla de la app (ahi el script del HTML no corre), la pone este
    efecto.
  Debajo quedan siempre las siluetas, con la misma forma que la bandeja real.
*/
export function ListaDesdeGuardado({ fallback }: { fallback: ReactNode }) {
  useEffect(() => {
    mostrarFotoDeLaBandeja();
  }, []);

  return <>{fallback}</>;
}
