import type { MouseEvent } from "react";
import { toast } from "sonner";

/*
  Los botones de la barra de acciones del chat (celular, o con la ficha abierta): solo el icono, en un
  cuadrito, como antes del 7-nov-2026. Las etiquetas debajo del icono estorbaban la vista (Alex, 10-nov-2026).
  El nombre se ve al pasar el mouse (atributo title) y, en el celular, al mantener presionado (aviso corto).
  El texto sigue en el codigo como sr-only para los lectores de pantalla; aria-label y onClick no cambian.

  Todos miden lo mismo de alto, y la silueta que se ve mientras carga el chat usa este mismo alto:
  asi la barra no salta al llegar los datos (arreglo del 7-oct).
*/

/** El alto de cada boton de la barra, y de su silueta mientras carga. */
export const ALTO_DE_LA_BARRA = "h-8";

/** El boton de la barra: solo el icono, sin encogerse al deslizar la fila. */
export const CLASES_BOTON_DE_LA_BARRA = `inline-flex ${ALTO_DE_LA_BARRA} min-w-8 shrink-0 items-center justify-center gap-0.5 rounded-lg border border-border bg-card px-1.5 transition hover:bg-muted disabled:opacity-60`;

/** El nombre del boton: no se ve (sr-only), lo leen los lectores de pantalla. */
export const CLASES_ETIQUETA_DE_LA_BARRA = "sr-only";

/**
 * En el celular, mantener presionado un boton muestra su nombre unos segundos (el title solo sale con el
 * mouse). Con mouse no hace nada: el clic derecho sigue siendo el del navegador.
 */
export function mostrarNombreAlMantener(nombre: string) {
  return (evento: MouseEvent<HTMLElement>) => {
    if (typeof window === "undefined" || !window.matchMedia("(pointer: coarse)").matches) return;
    evento.preventDefault();
    toast(nombre, { duration: 1500 });
  };
}
