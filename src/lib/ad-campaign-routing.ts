/**
 * A quien le toca un lead que entra por un anuncio.
 *
 * El reparto normal es por turnos entre los colaboradores del canal, y para la pauta eso no
 * siempre sirve: una campana puede necesitar a la persona que mas sabe de ese producto. Aca se
 * decide, POR EL ANUNCIO del que vino el lead, si le corresponde a alguien en particular.
 *
 * Se resuelve con el titulo del anuncio, que WhatsApp manda dentro del PRIMER mensaje: llega
 * antes que la etiqueta del producto (esa la pone el agente despues, cuando el lead ya fue
 * repartido) y antes de que nadie vea el chat. Por eso asigna en vez de reasignar: nunca hay un
 * chat que aparezca en la lista de una asesora y despues se lo saquen.
 *
 * La configuracion vive en el metadata del canal, al lado de los colaboradores: no hace falta
 * tabla nueva y se edita desde la pantalla de Conexion.
 */

export const AD_CAMPAIGN_ROUTING_METADATA_KEY = "adCampaignRouting";

export type AdCampaignRouting = {
  /** Palabras que debe contener el titulo del anuncio. Si esta vacio, la regla no aplica. */
  keywords: string[];
  /** A quien se le asigna. Vacio = regla apagada. */
  userId: string;
};

/**
 * Compara sin acentos, sin mayusculas y sin los emojis/simbolos con los que vienen decorados los
 * titulos reales ("👌 Combo Completo para Estéticas", "¡Oferta especial...!"). Sin esto, una regla
 * con la palabra "estetica" no encontraria "Estéticas" y la campana entera se repartiria por
 * turnos sin que nadie se entere.
 */
export function normalizeAdText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function readAdCampaignRouting(metadata: unknown): AdCampaignRouting | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const raw = (metadata as Record<string, unknown>)[AD_CAMPAIGN_ROUTING_METADATA_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const userId = typeof record.userId === "string" ? record.userId.trim() : "";
  const keywords = Array.isArray(record.keywords)
    ? record.keywords
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  if (!userId || keywords.length === 0) {
    return null;
  }

  return { keywords, userId };
}

/** ¿El titulo de este anuncio cae en la regla? */
export function adTitleMatchesRouting(adTitle: string, routing: AdCampaignRouting): boolean {
  const titulo = normalizeAdText(adTitle);
  if (!titulo) {
    return false;
  }
  return routing.keywords.some((keyword) => {
    const palabra = normalizeAdText(keyword);
    return palabra.length > 0 && titulo.includes(palabra);
  });
}

/** Para mostrar la regla escrita en la pantalla de Conexion. */
export function describeAdCampaignRouting(keywords: string[]): string {
  const limpias = keywords.map((value) => value.trim()).filter(Boolean);
  if (limpias.length === 0) {
    return "";
  }
  if (limpias.length === 1) {
    return `los anuncios cuyo título contenga «${limpias[0]}»`;
  }
  return `los anuncios cuyo título contenga ${limpias.map((value) => `«${value}»`).join(" o ")}`;
}
