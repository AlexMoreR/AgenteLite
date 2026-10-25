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
*/

type Props = {
  tarjeta: TarjetaVista;
  tipos: TipoVista[];
};

export function FichaDeAsignada({ tarjeta, tipos }: Props) {
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
      alCerrar={() => router.push(RUTA_DEL_INICIO)}
      alElegir={() => undefined}
      alEntrar={() => undefined}
      alAprobar={() => router.refresh()}
    />
  );
}
