/**
 * Los íconos que se le pueden poner a una idea.
 *
 * Es una lista CORTA a propósito, no un selector de emojis completo: acá el ícono es una marca
 * para reconocer la caja de un vistazo —esto es plata, esto es una alerta, esto está listo—, y
 * con dos mil emojis se pasa más tiempo eligiendo el dibujito que pensando.
 *
 * Están elegidos por lo que suele aparecer al planear un negocio: idea, objetivo, dinero, gente,
 * tiempo, alerta, hecho y pregunta.
 */
export const ICONOS_DE_IDEA = [
  "💡",
  "🎯",
  "💰",
  "👥",
  "⏰",
  "⚠️",
  "✅",
  "❓",
  // Los dos de los flujos del agente: el bot que responde y la persona que atiende.
  "🤖",
  "👨🏻‍💻",
] as const;
