/**
 * Los colores de una idea.
 *
 * Son SEIS y no una paleta libre: en un mapa mental el color sirve para agrupar —"esto es
 * plata", "esto es gente", "esto está pendiente"— y con veinte tonos parecidos deja de agrupar y
 * pasa a decorar. Seis se distinguen de un vistazo y se recuerdan.
 *
 * Cada uno trae su versión clara y su versión oscura: el mismo amarillo que se lee sobre blanco
 * desaparece sobre el fondo oscuro de la app.
 */

export type ColorDeIdea = "neutro" | "amarillo" | "verde" | "azul" | "rosa" | "violeta";

export const COLORES_DE_IDEA: Array<{
  valor: ColorDeIdea;
  nombre: string;
  /** Cómo se pinta la caja. */
  caja: string;
  /** El puntito del selector. */
  punto: string;
}> = [
  {
    valor: "neutro",
    nombre: "Sin color",
    caja: "border-border bg-card",
    punto: "bg-muted border-border",
  },
  {
    valor: "amarillo",
    nombre: "Amarillo",
    caja: "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10",
    punto: "bg-amber-300 border-amber-400",
  },
  {
    valor: "verde",
    nombre: "Verde",
    caja: "border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10",
    punto: "bg-emerald-300 border-emerald-400",
  },
  {
    valor: "azul",
    nombre: "Azul",
    caja: "border-sky-300 bg-sky-50 dark:border-sky-500/40 dark:bg-sky-500/10",
    punto: "bg-sky-300 border-sky-400",
  },
  {
    valor: "rosa",
    nombre: "Rosa",
    caja: "border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10",
    punto: "bg-rose-300 border-rose-400",
  },
  {
    valor: "violeta",
    nombre: "Violeta",
    caja: "border-violet-300 bg-violet-50 dark:border-violet-500/40 dark:bg-violet-500/10",
    punto: "bg-violet-300 border-violet-400",
  },
];

export function cajaDelColor(color: unknown): string {
  const encontrado = COLORES_DE_IDEA.find((opcion) => opcion.valor === color);
  return (encontrado ?? COLORES_DE_IDEA[0]).caja;
}
