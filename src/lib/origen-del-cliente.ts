import { origenDeLinea, type LineaDelChat, type MapaDeLineas } from "@/lib/origen-de-venta";

/**
 * ORIGEN DEL CLIENTE para la ficha del chat y el filtro de `listar_conversaciones` (solo lectura,
 * sin base de datos). Lee lo que el webhook ya guardó en `Contact.metadata` y la línea del chat.
 *
 * Orden: 1) anuncio de Meta, 2) Marketplace, 3) orgánico / desconocido.
 *
 * Ojo: aquí manda primero el ANUNCIO (como pide la tarjeta). La regla que se manda a Gestión
 * (`armarOrigenDeVenta`) le da prioridad a la línea; no se cambia. Un cliente de anuncio que escribe
 * a la línea de Marketplace sale "anuncio" acá y "MARKETPLACE" en Gestión.
 *
 * Evolution entrega el anuncio (id, título, link, red) pero NO la campaña.
 */

export const TIPOS_DE_ORIGEN = ["anuncio", "marketplace", "organico"] as const;
export type TipoDeOrigen = (typeof TIPOS_DE_ORIGEN)[number];

export function esTipoDeOrigen(valor: unknown): valor is TipoDeOrigen {
  return typeof valor === "string" && (TIPOS_DE_ORIGEN as readonly string[]).includes(valor);
}

export type OrigenDelCliente = {
  tipo: TipoDeOrigen;
  etiqueta: string;
  anuncioTitulo: string | null;
  anuncioId: string | null;
  anuncioUrl: string | null;
  red: string | null;
};

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

/** "facebook" → "Facebook", "instagram" → "Instagram"; lo desconocido se deja como vino. */
function nombreDeRed(valor: unknown): string | null {
  const red = texto(valor);
  if (!red) return null;
  const minuscula = red.toLowerCase();
  if (minuscula.includes("instagram")) return "Instagram";
  if (minuscula.includes("facebook")) return "Facebook";
  return red;
}

/** Solo links web: el link viene de un anuncio de afuera y se muestra como enlace. */
function enlaceSeguro(valor: unknown): string | null {
  const url = texto(valor);
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export function origenDelCliente(input: {
  metadataContacto: unknown;
  linea?: LineaDelChat | null;
  mapa?: MapaDeLineas;
}): OrigenDelCliente {
  const meta = objeto(input.metadataContacto);
  const vinoDeAnuncio = Boolean(texto(meta.adCapturedAt)) || texto(meta.source)?.toLowerCase() === "meta ads";

  if (vinoDeAnuncio) {
    const anuncioTitulo = texto(meta.adTitle) ?? texto(meta.campaign);
    const red = nombreDeRed(meta.adSourceApp);
    const partes = ["Anuncio de Meta", red, anuncioTitulo ? `«${anuncioTitulo}»` : null].filter(Boolean);
    return {
      tipo: "anuncio",
      etiqueta: partes.join(" · "),
      anuncioTitulo,
      anuncioId: texto(meta.adSourceId),
      anuncioUrl: enlaceSeguro(meta.adSourceUrl),
      red,
    };
  }

  const vinoDeMarketplace =
    texto(objeto(meta.origen).canal)?.toLowerCase() === "marketplace" ||
    origenDeLinea(input.linea ?? null, input.mapa) === "MARKETPLACE";
  if (vinoDeMarketplace) {
    return { tipo: "marketplace", etiqueta: "Marketplace", anuncioTitulo: null, anuncioId: null, anuncioUrl: null, red: null };
  }

  return { tipo: "organico", etiqueta: "Orgánico / desconocido", anuncioTitulo: null, anuncioId: null, anuncioUrl: null, red: null };
}
