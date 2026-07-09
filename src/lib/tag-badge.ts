// Estilo visual unificado de las badges de etiqueta en toda la app (look tipo WhatsApp:
// MAYÚSCULAS, sin negrita, radio pequeño y un poco de tracking). El color de fondo va
// aparte por `style` inline (cada etiqueta tiene su color). Al usar el componente Badge
// (que hace cn() con tailwind-merge), estas clases ganan sobre las base del Badge.
export const TAG_BADGE_CLASS =
  "rounded-[4px] px-2 py-0.5 text-[10px] font-normal uppercase tracking-wide";
