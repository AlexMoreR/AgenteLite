import type { EstadoTarjetaTablero } from "../services/reglas";

/** Color de cada estado: el mismo en el mapa, la lista, el filtro y la ficha (con modo oscuro). */
export const COLOR_DEL_ESTADO: Record<
  EstadoTarjetaTablero,
  { tarjeta: string; punto: string; pastilla: string; trazo: string }
> = {
  IDEA: {
    tarjeta: "border-zinc-300 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900",
    punto: "bg-zinc-400",
    pastilla: "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200",
    trazo: "#a1a1aa",
  },
  POR_APROBAR: {
    tarjeta: "border-amber-400 bg-amber-50 dark:border-amber-500 dark:bg-amber-950",
    punto: "bg-amber-500",
    pastilla: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-600 dark:bg-amber-900 dark:text-amber-100",
    trazo: "#f59e0b",
  },
  APROBADO: {
    tarjeta: "border-sky-400 bg-sky-50 dark:border-sky-500 dark:bg-sky-950",
    punto: "bg-sky-500",
    pastilla: "border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-600 dark:bg-sky-900 dark:text-sky-100",
    trazo: "#0ea5e9",
  },
  EN_CURSO: {
    tarjeta: "border-violet-400 bg-violet-50 dark:border-violet-500 dark:bg-violet-950",
    punto: "bg-violet-500",
    pastilla: "border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-600 dark:bg-violet-900 dark:text-violet-100",
    trazo: "#8b5cf6",
  },
  HECHO: {
    tarjeta: "border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-950",
    punto: "bg-emerald-500",
    pastilla: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-600 dark:bg-emerald-900 dark:text-emerald-100",
    trazo: "#10b981",
  },
  FALLIDO: {
    tarjeta: "border-rose-400 bg-rose-50 dark:border-rose-500 dark:bg-rose-950",
    punto: "bg-rose-500",
    pastilla: "border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-600 dark:bg-rose-900 dark:text-rose-100",
    trazo: "#f43f5e",
  },
};
