// Estilo visual unificado de las badges de etiqueta en toda la app (look tipo WhatsApp:
// MAYÚSCULAS, sin negrita, radio pequeño, padding 2px/4px). El COLOR (fondo claro +
// texto oscuro del mismo tono) va aparte por `style` inline con getTagBadgeColors().
export const TAG_BADGE_CLASS =
  "rounded-[4px] px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide";

// Paleta fija estilo WhatsApp: cada etiqueta se pinta con un FONDO CLARO y un TEXTO
// OSCURO del mismo tono. Lo que se guarda en la etiqueta es el color de fondo (`bg`);
// el texto se deriva por este mapa. Los swatches del selector usan estos `bg`.
/*
  Mas vivos desde el 03-10-2026 (Alex: "se ven palidos"). Eran pasteles casi blancos -el morado
  #E7DAFB- con letra fina de 10 px: en la lista de chats no se distinguia una etiqueta de otra.

  `bg` es lo que esta GUARDADO en cada etiqueta y no se toca (es la clave: cambiarlo obligaria a
  migrar la base y dejaria huerfanas las etiquetas viejas). Lo que cambia es como se PINTA:
  `fill` es el fondo que se ve, un tono mas saturado, y `text` uno mas oscuro.
*/
export const TAG_COLOR_PAIRS: Array<{ bg: string; fill: string; text: string }> = [
  { bg: "#CAECFA", fill: "#9ED8F2", text: "#05384F" }, // Azul
  { bg: "#B6D9FE", fill: "#93C2F8", text: "#0A2540" }, // Azul oscuro
  { bg: "#C9F0D8", fill: "#A3E4BC", text: "#08471F" }, // Verde
  { bg: "#C7F0EC", fill: "#9EE3DB", text: "#064741" }, // Teal
  { bg: "#FBD7D1", fill: "#F7B4A9", text: "#64140B" }, // Rojo
  { bg: "#FCE4C8", fill: "#F9CB97", text: "#663104" }, // Naranja
  { bg: "#FBF0C4", fill: "#F5E08A", text: "#574400" }, // Amarillo
  { bg: "#E7DAFB", fill: "#CDB5F6", text: "#3B1366" }, // Morado
  { bg: "#FBD6EA", fill: "#F6B3D6", text: "#650D40" }, // Rosa
  { bg: "#E2E8F0", fill: "#CBD5E1", text: "#1E293B" }, // Gris
];

// Colores de fondo para el selector de color de etiqueta (lo que se guarda).
export const TAG_PRESET_COLORS = TAG_COLOR_PAIRS.map((pair) => pair.bg);

const TAG_PAIR_BY_BG = new Map(TAG_COLOR_PAIRS.map((pair) => [pair.bg.toLowerCase(), pair]));

// Devuelve { backgroundColor, color } para una etiqueta segun su color guardado.
// - Si el color es uno de la paleta fija, usa su par exacto (fondo claro + texto oscuro).
// - Si es un color viejo/saturado (etiquetas creadas antes), lo convierte al mismo look
//   con color-mix: fondo aclarado + texto oscurecido del mismo tono, para que TODO
//   quede consistente sin migrar la base de datos.
export function getTagBadgeColors(color?: string | null): { backgroundColor: string; color: string } {
  const normalized = color?.trim();
  if (!normalized) {
    return {
      backgroundColor: "color-mix(in srgb, var(--primary) 35%, white)",
      color: "color-mix(in srgb, var(--primary) 70%, black)",
    };
  }

  const pair = TAG_PAIR_BY_BG.get(normalized.toLowerCase());
  if (pair) {
    return { backgroundColor: pair.fill, color: pair.text };
  }

  return {
    backgroundColor: `color-mix(in srgb, ${normalized} 35%, white)`,
    color: `color-mix(in srgb, ${normalized} 70%, black)`,
  };
}
