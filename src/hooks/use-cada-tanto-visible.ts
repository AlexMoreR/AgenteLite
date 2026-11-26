"use client";

import { useEffect, useRef } from "react";

/*
  Repite una tarea cada tanto, pero SOLO mientras la pestaña está a la vista.

  Una pestaña olvidada en segundo plano seguía pidiendo datos cada minuto, todo el día, para una pantalla
  que nadie miraba. Con esto el reloj se para al ocultarse la pestaña y, al volver, la tarea corre como
  mucho una vez (si ya tocaba) y después retoma su ritmo.

  No hace la primera lectura al montar (salvo con `alEmpezar`): esa la sigue haciendo cada pantalla a su
  manera. El reloj cuenta desde que se monta.
*/

export type OpcionesCadaTantoVisible = {
  /** Con `false` no programa nada. Por defecto `true`. */
  activo?: boolean;
  /** Con `true` corre la tarea apenas empieza (si la pestaña está a la vista). Por defecto `false`. */
  alEmpezar?: boolean;
};

type DocumentoVisible = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

/**
 * El reloj sin React, para poder probarlo con un documento falso. Devuelve la función que lo apaga.
 * `leerTarea` se llama en cada vuelta, así la tarea puede cambiar sin reiniciar el reloj.
 */
export function empezarCadaTantoVisible(
  documento: DocumentoVisible,
  leerTarea: () => () => void | Promise<void>,
  cadaMs: number,
  alEmpezar = false,
): () => void {
  let reloj: ReturnType<typeof setTimeout> | null = null;
  // Cuándo corrió por última vez (o cuándo empezó a contar). Con `alEmpezar` y la pestaña oculta al
  // montar, queda en 0 para que corra apenas se vuelva a ver.
  let ultimaVez = Date.now();

  const parar = () => {
    if (reloj !== null) {
      clearTimeout(reloj);
      reloj = null;
    }
  };

  const programar = (enMs: number) => {
    parar();
    reloj = setTimeout(vuelta, Math.max(0, enMs));
  };

  const correr = () => {
    ultimaVez = Date.now();
    // Se programa ANTES de correr: si la tarea revienta, el reloj sigue.
    programar(cadaMs);
    void leerTarea()();
  };

  function vuelta() {
    reloj = null;
    if (documento.visibilityState !== "visible") return;
    correr();
  }

  const alCambiarVisibilidad = () => {
    if (documento.visibilityState !== "visible") {
      parar();
      return;
    }
    const pasaron = Date.now() - ultimaVez;
    if (pasaron >= cadaMs) correr();
    else programar(cadaMs - pasaron);
  };

  documento.addEventListener("visibilitychange", alCambiarVisibilidad);

  if (documento.visibilityState === "visible") {
    if (alEmpezar) correr();
    else programar(cadaMs);
  } else if (alEmpezar) {
    ultimaVez = 0;
  }

  return () => {
    documento.removeEventListener("visibilitychange", alCambiarVisibilidad);
    parar();
  };
}

/**
 * Corre `tarea` cada `cadaMs` mientras la pestaña está a la vista. Al ocultarse para el reloj; al volver,
 * si ya pasaron `cadaMs` desde la última vez la corre una vez enseguida, y si no, espera solo lo que falta.
 */
export function useCadaTantoVisible(
  tarea: () => void | Promise<void>,
  cadaMs: number,
  opciones?: OpcionesCadaTantoVisible,
) {
  const activo = opciones?.activo ?? true;
  const alEmpezar = opciones?.alEmpezar ?? false;

  // La tarea va en un ref: cambiar el callback en cada render no reinicia el reloj.
  const tareaRef = useRef(tarea);
  useEffect(() => {
    tareaRef.current = tarea;
  }, [tarea]);

  useEffect(() => {
    if (!activo || typeof document === "undefined" || !(cadaMs > 0)) return;
    return empezarCadaTantoVisible(document, () => tareaRef.current, cadaMs, alEmpezar);
  }, [activo, alEmpezar, cadaMs]);
}
