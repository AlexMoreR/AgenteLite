import { origenDeLinea, type LineaDelChat, type MapaDeLineas } from "@/lib/origen-de-venta";

/**
 * DE DÓNDE LLEGÓ EL CLIENTE: la regla que se muestra en la ficha del chat y filtra listar_conversaciones
 * (sin base de datos: se prueba con `npm run test:origen-del-cliente`).
 *
 * Solo LEE lo que el webhook ya guardó en Contact.metadata (source, adTitle, adSourceId, adSourceUrl,
 * adSourceApp, adCapturedAt; origen.canal para Marketplace). No cambia cómo se reciben los mensajes.
 *
 * Orden: 1) anuncio de Meta, 2) Marketplace, 3) orgánico / desconocido.
 * OJO: aquí manda primero el ANUNCIO. `armarOrigenDeVenta` (lo que se manda a Gestión) le da prioridad
 * a la LÍNEA: un cliente de anuncio que escribe a la línea de Marketplace sale "anuncio" aquí y
 * MARKETPLACE allá. Es a propósito (la tarjeta pide ver de qué anuncio vino); lo de Gestión no cambia.
 */

export const TIPOS_DE_ORIGEN = ["anuncio", "marketplace", "organico"] as const;
export type TipoDeOrigen = (typeof TIPOS_DE_ORIGEN)[number];

export type OrigenDelCliente = {
  tipo: TipoDeOrigen;
  /** Texto corto para la ficha: "Anuncio de Meta · Instagram · «título»", "Marketplace"… */
  etiqueta: string;
  tituloDelAnuncio: string | null;
  idDelAnuncio: string | null;
  /** "Facebook" o "Instagram" cuando Meta lo dijo. */
  red: string | null;
  /** Solo si es un link http(s): se puede abrir desde la ficha. */
  enlace: string | null;
};

function comoObjeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

export function esTipoDeOrigen(valor: unknown): valor is TipoDeOrigen {
  return typeof valor === "string" && (TIPOS_DE_ORIGEN as readonly string[]).includes(valor);
}

function nombreDeLaRed(valor: unknown): string | null {
  const red = texto(valor)?.toLowerCase();
  if (!red) return null;
  if (red.includes("insta")) return "Instagram";
  if (red.includes("face") || red === "fb") return "Facebook";
  return null;
}

function enlaceSeguro(valor: unknown): string | null {
  const url = texto(valor);
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export function origenDelCliente(input: {
  metadataContacto: unknown;
  linea?: LineaDelChat | null;
  mapa?: MapaDeLineas;
}): OrigenDelCliente {
  const meta = comoObjeto(input.metadataContacto);
  const vinoDeAnuncio = Boolean(texto(meta.adCapturedAt)) || texto(meta.source)?.toLowerCase() === "meta ads";

  if (vinoDeAnuncio) {
    const tituloDelAnuncio = texto(meta.adTitle ?? meta.campaign);
    const red = nombreDeLaRed(meta.adSourceApp);
    const partes = ["Anuncio de Meta", red, tituloDelAnuncio ? `«${tituloDelAnuncio}»` : null];
    return {
      tipo: "anuncio",
      etiqueta: partes.filter(Boolean).join(" · "),
      tituloDelAnuncio,
      idDelAnuncio: texto(meta.adSourceId),
      red,
      enlace: enlaceSeguro(meta.adSourceUrl),
    };
  }

  const vinoDeMarketplace =
    texto(comoObjeto(meta.origen).canal)?.toLowerCase() === "marketplace" ||
    origenDeLinea(input.linea ?? null, input.mapa) === "MARKETPLACE";

  return {
    tipo: vinoDeMarketplace ? "marketplace" : "organico",
    etiqueta: vinoDeMarketplace ? "Marketplace" : "Orgánico / desconocido",
    tituloDelAnuncio: null,
    idDelAnuncio: null,
    red: null,
    enlace: null,
  };
}
