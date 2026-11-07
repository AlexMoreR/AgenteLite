import { useCallback, useEffect, useState } from "react";

// Avisa si una fila que se desliza de lado todavia tiene botones escondidos a la derecha.
// Lo usa la barra de acciones del chat en el celular: Resolver queda fijo a la derecha y, mientras
// quede algo por ver debajo, se muestra una flechita al lado.

/** Si queda contenido a la derecha. Se deja 1 px de margen por los anchos con decimales. */
export function quedaContenidoALaDerecha(scrollLeft: number, clientWidth: number, scrollWidth: number): boolean {
  return scrollLeft + clientWidth < scrollWidth - 1;
}

/**
 * Devuelve una callback ref para poner en el elemento que se desliza, y si queda algo a la derecha.
 *
 * Callback ref (no useRef): la barra se monta y se desmonta segun haya chat y segun la escondan,
 * y asi el hook se entera cada vez. Recalcula al deslizar, cuando cambia el tamaño y cuando cambian
 * los hijos, porque los botones reales llegan despues de la silueta.
 */
export function useHayMasALaDerecha<T extends HTMLElement = HTMLDivElement>(): [(elemento: T | null) => void, boolean] {
  const [elemento, setElemento] = useState<T | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const ref = useCallback((nodo: T | null) => setElemento(nodo), []);

  useEffect(() => {
    if (!elemento) return;
    const medir = () => {
      setHayMas(quedaContenidoALaDerecha(elemento.scrollLeft, elemento.clientWidth, elemento.scrollWidth));
    };
    medir();
    elemento.addEventListener("scroll", medir, { passive: true });
    const tamano = typeof ResizeObserver !== "undefined" ? new ResizeObserver(medir) : null;
    tamano?.observe(elemento);
    const hijos = typeof MutationObserver !== "undefined" ? new MutationObserver(medir) : null;
    hijos?.observe(elemento, { childList: true, subtree: true, characterData: true });
    return () => {
      elemento.removeEventListener("scroll", medir);
      tamano?.disconnect();
      hijos?.disconnect();
      // Sin barra no hay nada a la derecha; al volver a montarse se mide de nuevo.
      setHayMas(false);
    };
  }, [elemento]);

  return [ref, elemento ? hayMas : false];
}
