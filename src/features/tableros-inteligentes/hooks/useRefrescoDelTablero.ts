"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ConexionVista, TableroDelInicio, TarjetaVista, TipoVista } from "../services/tableros";

/*
  Refresco del Tablero IA cada 5 s, sin cargar el servidor (el del tablero abierto y el de la lista
  de tableros usan el mismo reloj):
  - con la pestaña oculta no pregunta nada; al volver a verla pregunta en el acto;
  - nunca hay dos preguntas encimadas (si una no volvió, se salta el turno);
  - una pregunta que no vuelve en 15 s se corta: antes una conexión colgada (la PC que se durmió, un
    corte de red, un reinicio del servidor) dejaba la pregunta "en curso" para siempre y la pantalla
    no se volvía a actualizar hasta recargar;
  - si falla, espera 30 s antes de volver a intentar;
  - cada pregunta lleva lo último que se vio (`?desde=` o `?firma=`) y el servidor contesta
    `{cambio:false}` si no hubo nada nuevo.
*/

const CADA_MS = 5_000;
const TRAS_ERROR_MS = 30_000;
const LIMITE_MS = 15_000;

export type ContenidoNuevo = {
  actualizadoEn: string;
  tarjetas: TarjetaVista[];
  conexiones: ConexionVista[];
  tipos: TipoVista[];
};

/**
 * El reloj compartido: mientras `clave` no sea null, pide `armarUrl()` cada 5 s y le pasa la
 * respuesta a `alResponder`. Devuelve "pregunta ya" (espera la respuesta).
 */
function useConsultaPeriodica(clave: string | null, armarUrl: () => string, alResponder: (datos: unknown) => void) {
  const enCursoRef = useRef(false);
  const armarUrlRef = useRef(armarUrl);
  const alResponderRef = useRef(alResponder);
  const relojRef = useRef<number | null>(null);
  const preguntarRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    armarUrlRef.current = armarUrl;
    alResponderRef.current = alResponder;
  }, [armarUrl, alResponder]);

  useEffect(() => {
    if (!clave) {
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
      const corte = new AbortController();
      const limite = window.setTimeout(() => corte.abort(), LIMITE_MS);
      try {
        const respuesta = await fetch(armarUrlRef.current(), {
          cache: "no-store",
          credentials: "same-origin",
          signal: corte.signal,
        });
        if (!respuesta.ok) throw new Error(String(respuesta.status));
        const datos: unknown = await respuesta.json();
        if (!cancelado) alResponderRef.current(datos);
      } catch {
        espera = TRAS_ERROR_MS;
      } finally {
        window.clearTimeout(limite);
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
  }, [clave]);

  return useCallback(() => preguntarRef.current(), []);
}

/** El tablero abierto: tarjetas, flechas y tipos cuando cambia `TableroInteligente.actualizadoEn`. */
export function useRefrescoDelTablero(
  tableroId: string | null,
  actualizadoEn: string | null,
  alCambiar: (contenido: ContenidoNuevo) => void,
) {
  const desdeRef = useRef(actualizadoEn);

  useEffect(() => {
    desdeRef.current = actualizadoEn;
  }, [actualizadoEn]);

  const armarUrl = useCallback(() => {
    const desde = desdeRef.current ? `?desde=${encodeURIComponent(desdeRef.current)}` : "";
    return `/api/cliente/tableros-inteligentes/${encodeURIComponent(tableroId ?? "")}${desde}`;
  }, [tableroId]);

  const alResponder = useCallback(
    (respuesta: unknown) => {
      const datos = respuesta as { cambio?: boolean } & Partial<ContenidoNuevo>;
      if (!datos.cambio || !datos.actualizadoEn || !datos.tarjetas || !datos.conexiones || !datos.tipos) return;
      desdeRef.current = datos.actualizadoEn;
      alCambiar({
        actualizadoEn: datos.actualizadoEn,
        tarjetas: datos.tarjetas,
        conexiones: datos.conexiones,
        tipos: datos.tipos,
      });
    },
    [alCambiar],
  );

  const preguntar = useConsultaPeriodica(tableroId, armarUrl, alResponder);
  /** Pregunta ya (por ejemplo, después de aprobar). */
  return useCallback(() => void preguntar(), [preguntar]);
}

/**
 * La lista de tableros (la página de inicio y el selector de arriba). La `firma` es la hora del
 * último cambio de los tableros que la persona ve y cuántos son (firmaDeLaLista): si no cambió, el
 * servidor contesta "nada nuevo". Devuelve la lista al día, para cambiarla a mano (renombrar) y
 * "pregunta ya" (al abrir el selector).
 */
export function useListaDeTableros(iniciales: TableroDelInicio[], firmaInicial: string) {
  const [tableros, setTableros] = useState(iniciales);
  const firmaRef = useRef(firmaInicial);

  const armarUrl = useCallback(
    () => `/api/cliente/tableros-inteligentes?firma=${encodeURIComponent(firmaRef.current)}`,
    [],
  );

  const alResponder = useCallback((respuesta: unknown) => {
    const datos = respuesta as { cambio?: boolean; firma?: string; tableros?: TableroDelInicio[] };
    if (!datos.cambio || !datos.firma || !datos.tableros) return;
    firmaRef.current = datos.firma;
    setTableros(datos.tableros);
  }, []);

  const preguntarYa = useConsultaPeriodica("lista", armarUrl, alResponder);
  return { tableros, setTableros, preguntarYa };
}
