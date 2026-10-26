import { origenDeLinea, type LineaDelChat, type MapaDeLineas } from "@/lib/origen-de-venta";

/**
 * ORIGEN DEL CLIENTE (reglas puras, sin base de datos): de dónde llegó el cliente, para mostrarlo en la
 * ficha del chat y filtrar en el MCP (`listar_conversaciones`). Solo LEE lo que el webhook ya guardó en
 * `Contact.metadata`; no cambia cómo se reciben los mensajes.
 *
 * Orden (ojo: distinto a `armarOrigenDeVenta`, que es lo que se manda a Gestión y le da prioridad a la LÍNEA):
 *   1. anuncio: trae datos de anuncio (adCapturedAt, source "meta ads" o id/título del anuncio).
 *   2. marketplace: `metadata.origen.canal = marketplace`, o el chat es de la línea de Marketplace ("Ventas 2").
 *   3. organico: todo lo demás ("Orgánico / desconocido").
 * Un cliente de anuncio que escribe a la línea de Marketplace sale "anuncio".
 *
 * Evolution entrega el id y el título del anuncio, pero NO la campaña: "nacional" o "Cali" solo se
 * pueden saber si el título del anuncio lo dice.
 *
 * Este archivo no importa Prisma a propósito: se prueba con `node scripts/check-origen-del-cliente.mjs`.
 */

export const TIPOS_DE_ORIGEN = ["anuncio", "marketplace", "organico"] as const;
export type TipoDeOrigen = (typeof TIPOS_DE_ORIGEN)[number];

export type OrigenDelCliente = {
  tipo: TipoDeOrigen;
  etiqueta: string;
  tituloAnuncio: string | null;
  idAnuncio: string | null;
  red: string | null;
  enlace: string | null;
};

export function esTipoDeOrigen(valor: unknown): valor is TipoDeOrigen {
  return typeof valor === "string" && (TIPOS_DE_ORIGEN as readonly string[]).includes(valor);
}

function comoObjeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

function nombreDeRed(valor: string | null): string | null {
  if (!valor) return null;
  if (/instagram/i.test(valor)) return "Instagram";
  if (/facebook/i.test(valor)) return "Facebook";
  return valor;
}

export function origenDelCliente(
  metadataContacto: unknown,
  linea: LineaDelChat | null = null,
  mapa: MapaDeLineas = {},
): OrigenDelCliente {
  const meta = comoObjeto(metadataContacto);
  const tituloAnuncio = texto(meta.adTitle) ?? texto(meta.campaign);
  const idAnuncio = texto(meta.adSourceId);
  const vinoDeAnuncio =
    Boolean(texto(meta.adCapturedAt)) || texto(meta.source)?.toLowerCase() === "meta ads" || Boolean(idAnuncio);

  if (vinoDeAnuncio) {
    const red = nombreDeRed(texto(meta.adSourceApp));
    const partes = ["Anuncio de Meta", red, tituloAnuncio ? `«${tituloAnuncio}»` : null].filter(Boolean);
    const enlace = texto(meta.adSourceUrl);
    return {
      tipo: "anuncio",
      etiqueta: partes.join(" · "),
      tituloAnuncio,
      idAnuncio,
      red,
      enlace: enlace && /^https?:\/\//i.test(enlace) ? enlace : null,
    };
  }

  const vinoDeMarketplace = texto(comoObjeto(meta.origen).canal)?.toLowerCase() === "marketplace";
  if (vinoDeMarketplace || origenDeLinea(linea, mapa) === "MARKETPLACE") {
    return { tipo: "marketplace", etiqueta: "Marketplace", tituloAnuncio: null, idAnuncio: null, red: null, enlace: null };
  }

  return { tipo: "organico", etiqueta: "Orgánico / desconocido", tituloAnuncio: null, idAnuncio: null, red: null, enlace: null };
}
