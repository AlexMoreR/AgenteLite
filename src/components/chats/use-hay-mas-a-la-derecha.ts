"use client";

import { useCallback, useEffect, useState } from "react";

/*
  ¿Queda contenido escondido a la derecha de una fila que se desliza de lado?

  En el celular la barra del chat no entra entera: Resolver queda fijo a la derecha y lo demas se
  desliza por debajo. Sin una pista nadie sabe que hay mas botones, asi que la barra muestra una
  flechita mientras esto da true y la quita al llegar al final.

  Devuelve un callback ref (y no recibe un useRef) porque la barra se monta y se desmonta segun el
  chat: con un ref comun el efecto no se enteraria del elemento nuevo.

  Se recalcula al deslizar, cuando cambia el ancho (ResizeObserver) y cuando cambian los hijos
  (MutationObserver): los botones de verdad llegan despues de la silueta y agrandan la fila sin que
  cambie su ancho visible.
*/
export function useHayMasALaDerecha<T extends HTMLElement = HTMLDivElement>() {
  const [elemento, setElemento] = useState<T | null>(null);
  const [hayMas, setHayMas] = useState(false);

  const ref = useCallback((nodo: T | null) => {
    setElemento(nodo);
  }, []);

  useEffect(() => {
    if (!elemento) return;

    // El -1 absorbe los medios pixeles que deja el zoom o la densidad de la pantalla.
    const medir = () => {
      setHayMas(elemento.scrollLeft + elemento.clientWidth < elemento.scrollWidth - 1);
    };

    medir();
    elemento.addEventListener("scroll", medir, { passive: true });

    const alCambiarElTamano = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(medir);
    alCambiarElTamano?.observe(elemento);

    const alCambiarLosHijos = typeof MutationObserver === "undefined" ? null : new MutationObserver(medir);
    alCambiarLosHijos?.observe(elemento, { childList: true, subtree: true, characterData: true });

    return () => {
      elemento.removeEventListener("scroll", medir);
      alCambiarElTamano?.disconnect();
      alCambiarLosHijos?.disconnect();
    };
  }, [elemento]);

  // Sin barra montada no hay nada escondido (el ultimo valor medido no cuenta).
  return [ref, elemento ? hayMas : false] as const;
}
