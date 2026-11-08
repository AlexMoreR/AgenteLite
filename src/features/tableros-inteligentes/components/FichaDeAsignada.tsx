"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import type { TarjetaVista, TipoVista } from "../services/tableros";
import { RUTA_DEL_INICIO } from "./DialogoDeTablero";
import { FichaTarjeta } from "./FichaTarjeta";

/*
  La ficha de una tarjeta que le asignaron a la persona en un tablero que NO es suyo (se abre desde
  "Asignadas a mí" con ?tarjeta=<id>). Solo se ve ESA tarjeta: sin el resto del tablero, sin flechas y
  sin botones de aprobar ni de asignar. Cerrarla vuelve a la página de inicio.
  También es la ficha de una tarjeta ARCHIVADA (8-nov-2026, ?tarjeta=<id> de una que ya salió del tablero): con
  `puedeCerebro` conserva "Pasar al cerebro", y cerrarla vuelve a `volverA` (Trabajos terminados).
*/

type Props = {
  tarjeta: TarjetaVista;
  tipos: TipoVista[];
  /** Muestra "Pasar al cerebro" (el dueño o quien él autorizó) en una hecha o de decisión. */
  puedeCerebro?: boolean;
  /** A dónde vuelve al cerrarla (por defecto, la página de inicio). */
  volverA?: string;
};

export function FichaDeAsignada({ tarjeta, tipos, puedeCerebro = false, volverA = RUTA_DEL_INICIO }: Props) {
  const router = useRouter();
  const tipoPorId = useMemo(() => new Map(tipos.map((tipo) => [tipo.id, tipo])), [tipos]);
  const soloEsta = useMemo(() => [tarjeta], [tarjeta]);

  return (
    <FichaTarjeta
      tarjeta={tarjeta}
      tarjetas={soloEsta}
      tipos={tipoPorId}
      hijas={0}
      entrantes={[]}
      salientes={[]}
      flechasEntrantes={[]}
      abierta
      lado="right"
      puedeAprobar={false}
      esDueno={false}
      miembros={[]}
      puedeAsignar={false}
      puedeCerebro={puedeCerebro}
      alCerrar={() => router.push(volverA)}
      alElegir={() => undefined}
      alEntrar={() => undefined}
      alAprobar={() => router.refresh()}
    />
  );
}
