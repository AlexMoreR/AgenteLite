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
  /** Palabras que debe contener el anuncio o la frase del cliente. Vacio = la regla no aplica. */
  keywords: string[];
  /** A quien se le asigna. Si hay varias personas, se turnan entre ellas. Vacio = regla apagada. */
  userIds: string[];
  /** Ultima persona a la que le toco, para saber a quien le sigue en el turno. */
  lastAssignedUserId: string;
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
  const keywords = Array.isArray(record.keywords)
    ? record.keywords
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  // `userId` (uno solo) es como se guardaba antes de poder elegir varias personas. Se sigue
  // leyendo para que las reglas ya configuradas no dejen de funcionar de un dia para el otro.
  const desdeLista = Array.isArray(record.userIds)
    ? record.userIds
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  const desdeUnico = typeof record.userId === "string" && record.userId.trim() ? [record.userId.trim()] : [];
  const userIds = Array.from(new Set(desdeLista.length > 0 ? desdeLista : desdeUnico));

  if (userIds.length === 0 || keywords.length === 0) {
    return null;
  }

  return {
    keywords,
    userIds,
    lastAssignedUserId:
      typeof record.lastAssignedUserId === "string" ? record.lastAssignedUserId.trim() : "",
  };
}

/**
 * A quien le toca ahora, cuando la regla tiene varias personas: la siguiente despues de la
 * ultima que atendio, dando la vuelta. Con una sola persona siempre devuelve a esa.
 *
 * Se reparte solo entre quienes SIGUEN activos: si alguien se fue del equipo, sus leads no
 * quedan en el limbo esperando a nadie.
 */
export function pickNextAdCampaignAssignee(
  routing: AdCampaignRouting,
  activeUserIds: Set<string>,
): string | null {
  const disponibles = routing.userIds.filter((id) => activeUserIds.has(id));
  if (disponibles.length === 0) {
    return null;
  }
  const ultimo = routing.lastAssignedUserId ? disponibles.indexOf(routing.lastAssignedUserId) : -1;
  return disponibles[(ultimo + 1) % disponibles.length];
}

/**
 * ¿Este lead de anuncio cae en la regla?
 *
 * Se miran TRES textos, no solo el titulo. El titulo es texto de marketing y cambia solo: el
 * anuncio que mas vende camillas se llama "Solo 989.000 COP - Todo lo que necesitas", donde no
 * aparece ni "camilla" ni "combo". Quien si nombra el producto es la frase con la que el cliente
 * llega, porque el anuncio se la deja escrita: "me interesa el COMBO de estetica (camilla,
 * escalera, silla y auxiliar)". Con solo el titulo, esa campana entera se repartia por turnos.
 */
export function adLeadMatchesRouting(
  lead: { title?: string; body?: string; messageText?: string },
  routing: AdCampaignRouting,
): boolean {
  const textos = [lead.title, lead.body, lead.messageText]
    .map((value) => normalizeAdText(value ?? ""))
    .filter(Boolean);

  if (textos.length === 0) {
    return false;
  }

  return routing.keywords.some((keyword) => {
    const palabra = normalizeAdText(keyword);
    return palabra.length > 0 && textos.some((texto) => texto.includes(palabra));
  });
}

/** Para mostrar la regla escrita en la pantalla de Conexion. */
export function describeAdCampaignRouting(keywords: string[]): string {
  const limpias = keywords.map((value) => value.trim()).filter(Boolean);
  if (limpias.length === 0) {
    return "";
  }
  if (limpias.length === 1) {
    return `los leads de anuncios donde aparezca «${limpias[0]}»`;
  }
  return `los leads de anuncios donde aparezca ${limpias.map((value) => `«${value}»`).join(" o ")}`;
}
