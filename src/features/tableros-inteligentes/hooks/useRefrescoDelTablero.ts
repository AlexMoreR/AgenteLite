"use client";

import { useCallback, useEffect, useRef } from "react";

import type { ConexionVista, TarjetaVista, TipoVista } from "../services/tableros";

/*
  Refresco del tablero cada 5 s, sin cargar el servidor:
  - con la pestaña oculta no pregunta nada; al volver a verla pregunta en el acto;
  - nunca hay dos preguntas encimadas (si una no volvió, se salta el turno);
  - si falla, espera 30 s antes de volver a intentar;
  - cada pregunta lleva `?desde=` y el servidor contesta `{cambio:false}` si no hubo nada nuevo.
*/

const CADA_MS = 5_000;
const TRAS_ERROR_MS = 30_000;

export type ContenidoNuevo = {
  actualizadoEn: string;
  tarjetas: TarjetaVista[];
  conexiones: ConexionVista[];
  tipos: TipoVista[];
};

export function useRefrescoDelTablero(
  tableroId: string | null,
  actualizadoEn: string | null,
  alCambiar: (contenido: ContenidoNuevo) => void,
) {
  const desdeRef = useRef(actualizadoEn);
  const enCursoRef = useRef(false);
  const alCambiarRef = useRef(alCambiar);
  const relojRef = useRef<number | null>(null);
  const preguntarRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    desdeRef.current = actualizadoEn;
  }, [actualizadoEn]);

  useEffect(() => {
    alCambiarRef.current = alCambiar;
  }, [alCambiar]);

  useEffect(() => {
    if (!tableroId) {
      return;
    }
    let cancelado = false;

    const programar = (ms: number) => {
      if (relojRef.current !== null) window.clearTimeout(relojRef.current);
      relojRef.current = window.setTimeout(() => void preguntar(), ms);
    };

    const preguntar = async () => {
      if (cancelado) return;
      if (document.visibilityState !== "visible") {
        // Oculta: no se vuelve a programar; `visibilitychange` la despierta.
        relojRef.current = null;
        return;
      }
      if (enCursoRef.current) return;
      enCursoRef.current = true;
      let espera = CADA_MS;
      try {
        const desde = desdeRef.current ? `?desde=${encodeURIComponent(desdeRef.current)}` : "";
        const respuesta = await fetch(`/api/cliente/tableros-inteligentes/${encodeURIComponent(tableroId)}${desde}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!respuesta.ok) throw new Error(String(respuesta.status));
        const datos = (await respuesta.json()) as { cambio?: boolean } & Partial<ContenidoNuevo>;
        if (!cancelado && datos.cambio && datos.actualizadoEn && datos.tarjetas && datos.conexiones && datos.tipos) {
          desdeRef.current = datos.actualizadoEn;
          alCambiarRef.current({
            actualizadoEn: datos.actualizadoEn,
            tarjetas: datos.tarjetas,
            conexiones: datos.conexiones,
            tipos: datos.tipos,
          });
        }
      } catch {
        espera = TRAS_ERROR_MS;
      } finally {
        enCursoRef.current = false;
      }
      if (!cancelado) programar(espera);
    };

    preguntarRef.current = preguntar;

    const alVerse = () => {
      if (document.visibilityState === "visible") void preguntar();
    };

    programar(CADA_MS);
    document.addEventListener("visibilitychange", alVerse);

    return () => {
      cancelado = true;
      if (relojRef.current !== null) window.clearTimeout(relojRef.current);
      relojRef.current = null;
      document.removeEventListener("visibilitychange", alVerse);
      preguntarRef.current = async () => {};
    };
  }, [tableroId]);

  /** Pregunta ya (por ejemplo, después de aprobar). */
  return useCallback(() => void preguntarRef.current(), []);
}
