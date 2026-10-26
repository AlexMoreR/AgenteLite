import { origenDeLinea, type LineaDelChat, type MapaDeLineas } from "@/lib/origen-de-venta";

/**
 * ORIGEN DEL CLIENTE: de dónde llegó (anuncio de Meta, Marketplace u orgánico). Reglas puras, sin
 * base de datos: solo LEEN lo que el webhook ya guardó en Contact.metadata.
 *
 * Orden (manda el anuncio, como pidió la tarjeta del Embudo 4):
 *   1. Anuncio de Meta: hay datos de anuncio guardados (adCapturedAt, source "meta ads" o adSourceId).
 *   2. Marketplace: metadata.origen.canal = "marketplace", o el chat es de la línea de Marketplace.
 *   3. Orgánico / desconocido: todo lo demás (incluye chats anteriores a la captura).
 *
 * OJO: `armarOrigenDeVenta` (lo que se manda a Gestión) le da prioridad a la LÍNEA; aquí manda primero
 * el anuncio. Un cliente de anuncio que escribe a "Ventas 2" sale "anuncio" acá y no cambia lo de Gestión.
 *
 * La campaña no llega desde Evolution (solo id y título del anuncio): no se inventa.
 */

export const TIPOS_DE_ORIGEN = ["anuncio", "marketplace", "organico"] as const;
export type TipoDeOrigen = (typeof TIPOS_DE_ORIGEN)[number];

export type OrigenDelCliente = {
  tipo: TipoDeOrigen;
  /** Texto corto listo para mostrar: "Anuncio de Meta · Instagram · «título»". */
  etiqueta: string;
  adTitulo: string | null;
  adId: string | null;
  red: string | null;
  adUrl: string | null;
};

function comoObjeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

function nombreDeLaRed(valor: string | null): string | null {
  if (!valor) return null;
  if (/instagram/i.test(valor)) return "Instagram";
  if (/facebook/i.test(valor)) return "Facebook";
  return valor;
}

/** Solo se acepta http(s): el link viene de afuera y se muestra como enlace. */
function urlSegura(valor: string | null): string | null {
  return valor && /^https?:\/\//i.test(valor) ? valor : null;
}

export function clasificarOrigenDelCliente(input: {
  metadataContacto: unknown;
  linea?: LineaDelChat | null;
  mapa?: MapaDeLineas;
}): OrigenDelCliente {
  const meta = comoObjeto(input.metadataContacto);
  const vinoDeAnuncio =
    Boolean(texto(meta.adCapturedAt)) ||
    Boolean(texto(meta.adSourceId)) ||
    texto(meta.source)?.toLowerCase() === "meta ads";

  if (vinoDeAnuncio) {
    const adTitulo = texto(meta.adTitle) ?? texto(meta.campaign);
    const red = nombreDeLaRed(texto(meta.adSourceApp));
    const partes = ["Anuncio de Meta", ...(red ? [red] : []), ...(adTitulo ? [`«${adTitulo}»`] : [])];
    return {
      tipo: "anuncio",
      etiqueta: partes.join(" · "),
      adTitulo,
      adId: texto(meta.adSourceId),
      red,
      adUrl: urlSegura(texto(meta.adSourceUrl)),
    };
  }

  const vinoDeMarketplace =
    texto(comoObjeto(meta.origen).canal)?.toLowerCase() === "marketplace" ||
    origenDeLinea(input.linea ?? null, input.mapa) === "MARKETPLACE";
  if (vinoDeMarketplace) {
    return { tipo: "marketplace", etiqueta: "Marketplace", adTitulo: null, adId: null, red: null, adUrl: null };
  }

  return { tipo: "organico", etiqueta: "Orgánico / desconocido", adTitulo: null, adId: null, red: null, adUrl: null };
}
