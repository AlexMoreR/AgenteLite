// Estilo visual unificado de las badges de etiqueta en toda la app (look tipo WhatsApp:
// MAYÚSCULAS, sin negrita, radio pequeño, padding 2px/4px). El COLOR (fondo claro +
// texto oscuro del mismo tono) va aparte por `style` inline con getTagBadgeColors().
export const TAG_BADGE_CLASS =
  "rounded-[4px] px-1 py-0.5 text-[10px] font-normal uppercase tracking-wide";

// Paleta fija estilo WhatsApp: cada etiqueta se pinta con un FONDO CLARO y un TEXTO
// OSCURO del mismo tono. Lo que se guarda en la etiqueta es el color de fondo (`bg`);
// el texto se deriva por este mapa. Los swatches del selector usan estos `bg`.
export const TAG_COLOR_PAIRS: Array<{ bg: string; text: string }> = [
  { bg: "#CAECFA", text: "#074B6A" }, // Azul
  { bg: "#B6D9FE", text: "#092642" }, // Azul oscuro
  { bg: "#C9F0D8", text: "#0B5B2E" }, // Verde
  { bg: "#C7F0EC", text: "#0A5B54" }, // Teal
  { bg: "#FBD7D1", text: "#7A1C12" }, // Rojo
  { bg: "#FCE4C8", text: "#7A3E06" }, // Naranja
  { bg: "#FBF0C4", text: "#6B5300" }, // Amarillo
  { bg: "#E7DAFB", text: "#4A1F7A" }, // Morado
  { bg: "#FBD6EA", text: "#7A1450" }, // Rosa
  { bg: "#E2E8F0", text: "#334155" }, // Gris
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
      backgroundColor: "color-mix(in srgb, var(--primary) 20%, white)",
      color: "color-mix(in srgb, var(--primary) 60%, black)",
    };
  }

  const pair = TAG_PAIR_BY_BG.get(normalized.toLowerCase());
  if (pair) {
    return { backgroundColor: pair.bg, color: pair.text };
  }

  return {
    backgroundColor: `color-mix(in srgb, ${normalized} 20%, white)`,
    color: `color-mix(in srgb, ${normalized} 60%, black)`,
  };
}
