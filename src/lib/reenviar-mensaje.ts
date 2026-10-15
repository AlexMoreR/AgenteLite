/*
  Reglas puras del "Reenviar" de un mensaje a otro chat (sin base, sin red).

  Viven aparte para poder probarlas solas (npm run test:reenviar).
*/

const TIPOS_CON_ARCHIVO = ["IMAGE", "VIDEO", "DOCUMENT"] as const;

export type TipoConArchivo = (typeof TIPOS_CON_ARCHIVO)[number];

/**
 * Como se reenvia cada tipo de mensaje.
 *
 * El audio (nota de voz o archivo de audio) va por su propio camino, el mismo de la nota de voz
 * grabada en el CRM: antes caia en "texto", no tenia texto y avisaba "Ese mensaje no se puede
 * reenviar" (Alex, 15-10-2026).
 */
export function comoSeReenvia(tipo?: string | null): "archivo" | "audio" | "texto" {
  const valor = (tipo ?? "").toUpperCase();
  if (valor === "AUDIO") return "audio";
  if ((TIPOS_CON_ARCHIVO as readonly string[]).includes(valor)) return "archivo";
  return "texto";
}

/**
 * ¿El archivo vive en NUESTRO servidor?
 *
 * Se mira la RUTA, no el texto completo: los mensajes guardan la direccion absoluta
 * ("https://app.aizenbot.com/uploads/chat-media/...") y comparar el principio contra "/uploads/"
 * no coincidia NUNCA. Resultado: reenviar cualquier foto o PDF avisaba "todavia se esta
 * guardando" y no mandaba nada, siempre.
 */
export function esArchivoDeNuestroServidor(mediaUrl?: string | null): boolean {
  const direccion = mediaUrl?.trim();
  if (!direccion) {
    return false;
  }
  try {
    const ruta = direccion.startsWith("/") ? direccion : new URL(direccion).pathname;
    return ruta.startsWith("/uploads/");
  } catch {
    return false;
  }
}

/**
 * Clave anti doble toque de una nota de voz: CHAT + audio.
 *
 * Solo por URL, reenviar el MISMO audio a un segundo chat se tomaba como repeticion del primero
 * y no salia. El reintento en el mismo chat (misma URL, mismo chat) se sigue enganchando al envio
 * en curso.
 */
export function claveDeNotaDeVoz(conversationId?: string | null, audioUrl?: string | null): string {
  const url = typeof audioUrl === "string" ? audioUrl.trim() : "";
  const chat = typeof conversationId === "string" ? conversationId.trim() : "";
  if (!url) return "";
  return `${chat}|${url}`;
}

/**
 * La direccion que se le pasa al gateway (Evolution/WAHA), que la descarga por su cuenta: tiene
 * que ser absoluta. La nota grabada ya llega absoluta; un audio reenviado puede venir con la ruta
 * relativa ("/uploads/chat-media/...").
 */
export function urlAbsolutaParaEnviar(audioUrl: string, baseUrl: string): string {
  const url = audioUrl.trim();
  if (!url.startsWith("/")) return url;
  const base = baseUrl.trim().replace(/\/+$/, "");
  return base ? `${base}${url}` : url;
}
