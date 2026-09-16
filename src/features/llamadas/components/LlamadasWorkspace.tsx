"use client";

import { TodasLasLlamadas, type AsesoraDeLlamadas } from "@/features/llamadas/components/TodasLasLlamadas";

export function LlamadasWorkspace({
  asesoras,
}: {
  /** Para el filtro por asesora. Vacio para quien no supervisa: ve solo sus llamadas. */
  asesoras: AsesoraDeLlamadas[];
}) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5">
      {/*
        Llamadas = las llamadas recientes (Alex, 15-sep-2026).

        Antes esta pantalla eran tres pestañas: "Mi dia" (se mudo a Mi dia, junto con los chats),
        "Resumen" (el informe del dia, que se cierra al final de Mi dia) y "Tablero". Lo que uno
        viene a buscar aca es la lista: quien llamo, a quien, por que linea y como quedo.

        Quien supervisa ve las de todo el equipo y puede filtrar por asesora; una asesora ve solo
        las suyas -se lo impone la accion, no la pantalla-.
      */}
      <TodasLasLlamadas asesoras={asesoras} />

    </div>
  );
}
