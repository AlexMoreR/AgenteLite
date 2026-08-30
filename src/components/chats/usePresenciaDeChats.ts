"use client";

import { useEffect, useState } from "react";

/**
 * Quien esta escribiendo AHORA, por telefono.
 *
 * El dato llega por el altavoz con el contenido adentro (evento `chat-presence`), no como un
 * "algo cambio": "escribiendo" dura segundos y, para cuando el navegador volviera a preguntar, la
 * persona ya paro.
 *
 * Se guarda en un solo lugar y lo leen todas las filas: montar un escucha por conversacion seria
 * un escucha por cada fila de la lista, y son cientos.
 */

export type QuienEscribe = "escribiendo" | "grabando";

/** Si se pierde el aviso de "dejo de escribir", esto lo apaga igual. */
const APAGADO_POR_LAS_DUDAS_MS = 10_000;

const escuchas = new Set<(mapa: Map<string, QuienEscribe>) => void>();
const activos = new Map<string, QuienEscribe>();
const relojes = new Map<string, ReturnType<typeof setTimeout>>();
let enchufado = false;

function avisarATodos() {
  const copia = new Map(activos);
  escuchas.forEach((escucha) => escucha(copia));
}

function soloDigitos(valor: string) {
  return valor.replace(/\D/g, "");
}

function enchufar() {
  if (enchufado || typeof window === "undefined") {
    return;
  }
  enchufado = true;

  window.addEventListener("chat-presence", (evento) => {
    const detalle = (evento as CustomEvent).detail as
      | { telefono?: string; activo?: boolean; que?: QuienEscribe | null }
      | null;
    const telefono = detalle?.telefono ? soloDigitos(detalle.telefono) : "";
    if (!telefono) {
      return;
    }

    const reloj = relojes.get(telefono);
    if (reloj) {
      clearTimeout(reloj);
      relojes.delete(telefono);
    }

    if (detalle?.activo) {
      activos.set(telefono, detalle.que ?? "escribiendo");
      relojes.set(
        telefono,
        setTimeout(() => {
          activos.delete(telefono);
          relojes.delete(telefono);
          avisarATodos();
        }, APAGADO_POR_LAS_DUDAS_MS),
      );
    } else {
      activos.delete(telefono);
    }

    avisarATodos();
  });
}

export function usePresenciaDeChats(telefono?: string | null): QuienEscribe | null {
  const [quien, setQuien] = useState<QuienEscribe | null>(null);
  const buscado = telefono ? soloDigitos(telefono) : "";

  useEffect(() => {
    enchufar();

    const escucha = (mapa: Map<string, QuienEscribe>) => {
      setQuien(buscado ? mapa.get(buscado) ?? null : null);
    };
    escuchas.add(escucha);
    escucha(activos);

    return () => {
      escuchas.delete(escucha);
    };
  }, [buscado]);

  return quien;
}
