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

  8-nov-2026: también es la ficha de una tarjeta ARCHIVADA (los links de la campanita, de "Hoy" y "Ver tarjeta" en
  Trabajos terminados), que el tablero ya no trae. Es para consultar: cerrarla vuelve a su tablero (`volverA`) y
  conserva "Pasar al cerebro" si la persona puede (`puedeCerebro`).
*/

type Props = {
  tarjeta: TarjetaVista;
  tipos: TipoVista[];
  /** A dónde vuelve al cerrarla (por defecto, la página de inicio). */
  volverA?: string;
  /** "Pasar al cerebro": el dueño o quien él autorizó (la página lo sabe). */
  puedeCerebro?: boolean;
};

export function FichaDeAsignada({ tarjeta, tipos, volverA = RUTA_DEL_INICIO, puedeCerebro = false }: Props) {
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
