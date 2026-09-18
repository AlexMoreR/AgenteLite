/**
 * Los colores de una idea.
 *
 * Es una lista CERRADA y no una paleta libre: en un mapa mental el color sirve para agrupar
 * —"esto es plata", "esto es gente", "esto está pendiente"— y con tonos a mano alzada deja de
 * agrupar y pasa a decorar. Alex pidió ampliarla a doce (18-sep-2026), con un transparente para
 * los textos sueltos y versiones claras y oscuras del azul y el verde.
 *
 * Cada uno trae su versión clara y su versión oscura: el mismo amarillo que se lee sobre blanco
 * desaparece sobre el fondo oscuro de la app. Los "oscuros" son un tono más fuerte y no un relleno
 * saturado, para que el texto siga leyéndose sin cambiarle el color.
 *
 * Los valores viejos (neutro, amarillo, verde, azul, rosa, violeta) se conservan tal cual: son los
 * que ya están guardados en los diagramas.
 */

export type ColorDeIdea =
  | "transparente"
  | "neutro"
  | "gris"
  | "azul"
  | "azulOscuro"
  | "amarillo"
  | "naranja"
  | "verde"
  | "verdeOscuro"
  | "rojo"
  | "rosa"
  | "violeta";

export type OpcionDeColor = {
  valor: ColorDeIdea;
  nombre: string;
  /** Cómo se pinta la caja. */
  caja: string;
  /** El puntito del selector. */
  punto: string;
};

export const COLORES_DE_IDEA: OpcionDeColor[] = [
  {
    valor: "transparente",
    nombre: "Transparente",
    // Sin fondo, sin borde y sin sombra: queda solo el texto sobre el lienzo.
    caja: "border-transparent bg-transparent !shadow-none",
    // Blanco cruzado por una raya roja, como en cualquier editor: "sin color".
    punto:
      "border-border bg-background bg-[linear-gradient(135deg,transparent_44%,#ef4444_44%,#ef4444_56%,transparent_56%)]",
  },
  {
    valor: "neutro",
    nombre: "Blanco",
    caja: "border-border bg-card",
    punto: "bg-white border-border",
  },
  {
    valor: "gris",
    nombre: "Gris",
    caja: "border-slate-300 bg-slate-100 dark:border-slate-500/50 dark:bg-slate-500/20",
    punto: "bg-slate-300 border-slate-400",
  },
  {
    valor: "azul",
    nombre: "Azul claro",
    caja: "border-sky-300 bg-sky-50 dark:border-sky-500/40 dark:bg-sky-500/10",
    punto: "bg-sky-300 border-sky-400",
  },
  {
    valor: "azulOscuro",
    nombre: "Azul oscuro",
    caja: "border-blue-400 bg-blue-200 dark:border-blue-400/60 dark:bg-blue-500/35",
    punto: "bg-blue-600 border-blue-700",
  },
  {
    valor: "amarillo",
    nombre: "Amarillo",
    caja: "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10",
    punto: "bg-amber-300 border-amber-400",
  },
  {
    valor: "naranja",
    nombre: "Naranja",
    caja: "border-orange-300 bg-orange-100 dark:border-orange-500/50 dark:bg-orange-500/20",
    punto: "bg-orange-400 border-orange-500",
  },
  {
    valor: "verde",
    nombre: "Verde claro",
    caja: "border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10",
    punto: "bg-emerald-300 border-emerald-400",
  },
  {
    valor: "verdeOscuro",
    nombre: "Verde oscuro",
    caja: "border-emerald-500 bg-emerald-200 dark:border-emerald-400/60 dark:bg-emerald-600/35",
    punto: "bg-emerald-600 border-emerald-700",
  },
  {
    valor: "rojo",
    nombre: "Rojo",
    caja: "border-red-400 bg-red-100 dark:border-red-500/60 dark:bg-red-500/25",
    punto: "bg-red-500 border-red-600",
  },
  {
    valor: "rosa",
    nombre: "Rosado",
    caja: "border-pink-300 bg-pink-50 dark:border-pink-500/40 dark:bg-pink-500/10",
    punto: "bg-pink-300 border-pink-400",
  },
  {
    valor: "violeta",
    nombre: "Morado",
    caja: "border-violet-300 bg-violet-50 dark:border-violet-500/40 dark:bg-violet-500/10",
    punto: "bg-violet-400 border-violet-500",
  },
];

/** El color de una idea, o el blanco de siempre si no tiene (o trae uno que ya no existe). */
export function opcionDelColor(color: unknown): OpcionDeColor {
  return (
    COLORES_DE_IDEA.find((opcion) => opcion.valor === color) ??
    COLORES_DE_IDEA.find((opcion) => opcion.valor === "neutro")!
  );
}

export function cajaDelColor(color: unknown): string {
  return opcionDelColor(color).caja;
}
