/*
  Los botones de la barra de acciones del chat en celular (o con la ficha abierta): icono arriba y,
  debajo, una etiqueta corta a la vista (Asignar, Nota, Agendar, Etiquetas, Resolver). Con el icono
  solo, las asesoras no sabian que hacia cada cuadrito (Alex, 7-nov-2026).

  Todos miden lo mismo de alto, y la silueta que se ve mientras carga el chat usa este mismo alto:
  asi la barra no salta al llegar los datos (arreglo del 7-oct).
*/

/** El alto de cada boton de la barra, y de su silueta mientras carga. */
export const ALTO_DE_LA_BARRA = "h-11";

/** El boton con etiqueta: icono arriba, texto abajo, sin encogerse al deslizar la fila. */
export const CLASES_BOTON_DE_LA_BARRA = `inline-flex ${ALTO_DE_LA_BARRA} min-w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-border bg-card px-1.5 transition hover:bg-muted disabled:opacity-60`;

/** El texto de unos 10 px debajo del icono; una sola linea, nunca se corta. */
export const CLASES_ETIQUETA_DE_LA_BARRA = "whitespace-nowrap text-[10px] font-medium leading-none text-muted-foreground";
