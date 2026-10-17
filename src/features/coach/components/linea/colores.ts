/**
 * Un color por asesora (en el orden de `asesorasDe`: por nombre). Las variables --chart-* del tema
 * son grises, y aca cada linea tiene que distinguirse: azul, naranja, verde, rosa, violeta.
 * `punto` es la misma tinta en clases de Tailwind, para el puntito de cada tarjeta.
 */
export const COLORES_DE_ASESORA = [
  { light: "#2563eb", dark: "#60a5fa", punto: "bg-blue-600 dark:bg-blue-400" },
  { light: "#ea580c", dark: "#fb923c", punto: "bg-orange-600 dark:bg-orange-400" },
  { light: "#059669", dark: "#34d399", punto: "bg-emerald-600 dark:bg-emerald-400" },
  { light: "#db2777", dark: "#f472b6", punto: "bg-pink-600 dark:bg-pink-400" },
  { light: "#7c3aed", dark: "#a78bfa", punto: "bg-violet-600 dark:bg-violet-400" },
] as const;

export function colorDe(indice: number) {
  return COLORES_DE_ASESORA[((indice % COLORES_DE_ASESORA.length) + COLORES_DE_ASESORA.length) % COLORES_DE_ASESORA.length];
}

/** "a2" -> 2 (la clave que da `asesorasDe`). */
export const indiceDeClave = (clave: string) => Number(clave.replace(/\D/g, "")) || 0;
