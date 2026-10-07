import { timingSafeEqual } from "node:crypto";

/**
 * ORIGEN DE CADA VENTA: de dónde vino el cliente que compró (reglas puras, sin base de datos).
 *
 * Decisión de Alex (07-10-2026): la regla base es la LÍNEA DE WHATSAPP por la que entró el chat.
 *   - Ventas 1 = Meta Ads (ahí caen los anuncios Click-to-WhatsApp).
 *   - Ventas 2 = Marketplace (las 10 cuentas de Facebook Marketplace).
 *   - Admin    = referidos y clientes recurrentes. El CRM no sabe si ya compró antes: manda
 *                REFERIDO_RECURRENTE y Gestión decide (si tiene ventas previas del cliente, RECURRENTE;
 *                si no, REFERIDO).
 * El detalle (anuncio de Meta, cuenta MK, item de Marketplace) se agrega cuando existe.
 *
 * El mapeo línea → origen NO está escrito con ids: los ids cambian si se reconecta una línea.
 * Se resuelve en este orden (ver `origenDeLinea`):
 *   1. `WhatsAppChannel.metadata.origenVenta` (la configuración del canal).
 *   2. El mapa del negocio en AppSetting `origen-ventas:lineas:<workspaceId>`, por id o por nombre.
 *   3. Los valores por defecto por NOMBRE de línea (abajo).
 *   4. Una línea con purpose ADMIN cuenta como Admin.
 * Si la línea no dice nada, se usan las señales del contacto (anuncio capturado, ref de Marketplace).
 *
 * Este archivo no importa Prisma a propósito: se prueba con `node scripts/check-origen-ventas.mjs`.
 */

export const ORIGENES_DE_VENTA = [
  "META_ADS",
  "MARKETPLACE",
  "REFERIDO_RECURRENTE",
  "REFERIDO",
  "RECURRENTE",
  "MOSTRADOR",
  "SIN_DATO",
] as const;

export type OrigenDeVenta = (typeof ORIGENES_DE_VENTA)[number];

export function esOrigenDeVenta(valor: unknown): valor is OrigenDeVenta {
  return typeof valor === "string" && (ORIGENES_DE_VENTA as readonly string[]).includes(valor);
}

/** "  VENTAS  1 " → "ventas 1". Sin acentos, para que "Admín" y "Admin" sean la misma línea. */
export function normalizarNombreDeLinea(nombre: string | null | undefined): string {
  return String(nombre ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Valores por defecto por nombre de línea (regla de Alex). Se pisan con la configuración. */
export const ORIGEN_POR_DEFECTO_DE_LINEA: Readonly<Record<string, OrigenDeVenta>> = {
  "ventas 1": "META_ADS",
  "ventas 2": "MARKETPLACE",
  admin: "REFERIDO_RECURRENTE",
};

export type MapaDeLineas = Record<string, OrigenDeVenta>;

/**
 * Lee el mapa guardado en AppSetting: `{ "<channelId o nombre de línea>": "META_ADS", ... }`.
 * Lo que no se entiende se descarta; un JSON roto es un mapa vacío (nunca tumba el aviso).
 */
export function parsearMapaDeLineas(valor: string | null | undefined): MapaDeLineas {
  if (!valor) return {};
  try {
    const crudo = JSON.parse(valor) as unknown;
    if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return {};
    const mapa: MapaDeLineas = {};
    for (const [clave, origen] of Object.entries(crudo as Record<string, unknown>)) {
      const limpio = typeof origen === "string" ? origen.trim().toUpperCase() : "";
      if (clave.trim() && esOrigenDeVenta(limpio)) {
        mapa[clave.trim()] = limpio;
        mapa[normalizarNombreDeLinea(clave)] = limpio;
      }
    }
    return mapa;
  } catch {
    return {};
  }
}

export type LineaDelChat = {
  channelId: string | null;
  nombre: string | null;
  purpose?: string | null;
  metadata?: unknown;
};

function comoObjeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

/** El origen que le corresponde a una línea, o null si la línea no dice nada. */
export function origenDeLinea(linea: LineaDelChat | null, mapa: MapaDeLineas = {}): OrigenDeVenta | null {
  if (!linea) return null;

  const delCanal = texto(comoObjeto(linea.metadata).origenVenta)?.toUpperCase();
  if (esOrigenDeVenta(delCanal)) return delCanal;

  if (linea.channelId && mapa[linea.channelId]) return mapa[linea.channelId];

  const nombre = normalizarNombreDeLinea(linea.nombre);
  if (nombre && mapa[nombre]) return mapa[nombre];
  if (nombre && ORIGEN_POR_DEFECTO_DE_LINEA[nombre]) return ORIGEN_POR_DEFECTO_DE_LINEA[nombre];

  if ((linea.purpose ?? "").toUpperCase() === "ADMIN") return "REFERIDO_RECURRENTE";
  return null;
}

export type DetalleDeOrigen = {
  adId?: string;
  adTitle?: string;
  sourceApp?: string;
  ctwaClid?: string;
  adSourceUrl?: string;
  mkCuenta?: string;
  marketplaceItemId?: string;
  crmContactId?: string;
  channelId?: string;
  capturadoEn?: string;
  via: "cotizacion" | "telefono";
};

export type OrigenCalculado = {
  origin: OrigenDeVenta;
  originDetail: DetalleDeOrigen;
  linea: string | null;
};

/**
 * Arma el origen que se le manda a Gestión: la línea manda; el detalle sale de lo que el webhook
 * guardó en Contact.metadata (anuncio: adSourceId/adTitle…; Marketplace: metadata.origen).
 */
export function armarOrigenDeVenta(input: {
  linea: LineaDelChat | null;
  metadataContacto: unknown;
  mapa?: MapaDeLineas;
  contactId?: string | null;
  via?: DetalleDeOrigen["via"];
}): OrigenCalculado {
  const meta = comoObjeto(input.metadataContacto);
  const origenMk = comoObjeto(meta.origen);
  const vinoDeAnuncio = Boolean(texto(meta.adCapturedAt)) || texto(meta.source)?.toLowerCase() === "meta ads";
  const vinoDeMarketplace = texto(origenMk.canal)?.toLowerCase() === "marketplace";

  const detalle: DetalleDeOrigen = { via: input.via ?? "cotizacion" };
  const poner = (clave: Exclude<keyof DetalleDeOrigen, "via">, valor: unknown) => {
    const limpio = texto(valor);
    if (limpio) detalle[clave] = limpio;
  };
  if (vinoDeAnuncio) {
    poner("adId", meta.adSourceId);
    poner("adTitle", meta.adTitle ?? meta.campaign);
    poner("sourceApp", meta.adSourceApp);
    poner("ctwaClid", meta.adCtwaClid);
    poner("adSourceUrl", meta.adSourceUrl);
    poner("capturadoEn", meta.adCapturedAt);
  }
  if (vinoDeMarketplace) {
    poner("mkCuenta", origenMk.cuenta);
    poner("marketplaceItemId", origenMk.itemId);
    if (!detalle.capturadoEn) poner("capturadoEn", origenMk.fecha);
  }
  poner("crmContactId", input.contactId);
  poner("channelId", input.linea?.channelId);

  const porLinea = origenDeLinea(input.linea, input.mapa);
  const origin: OrigenDeVenta =
    porLinea ?? (vinoDeAnuncio ? "META_ADS" : vinoDeMarketplace ? "MARKETPLACE" : "SIN_DATO");

  return { origin, originDetail: detalle, linea: texto(input.linea?.nombre) };
}

/* ------------------------------------------------------------------------------------------------
   MARKETPLACE: el mensaje pre-llenado de NETMAGI ("vengo de Marketplace (ref MK-XXXXX)") y, desde el
   07-10-2026, también el texto que pone Facebook cuando el comprador toca "Enviar mensaje" en una
   publicación: "¿Sigue estando disponible este artículo? - facebook.com/marketplace/item/<ID>".
   Ese segundo caso eran 50+ chats en 60 días que no se detectaban. El item se cruza después con
   las publicaciones de NETMAGI para saber de qué cuenta salió.
------------------------------------------------------------------------------------------------- */

const REF_RE = /\bref\s*:?\s*(MK-[A-Z0-9]{3,10})\b/i;
const VENGO_RE = /vengo\s+de(l)?\s+marketplace/i;
const ITEM_RE = /facebook\.com\/marketplace\/item\/(\d{5,25})/i;

export type OrigenMarketplace = { cuenta: string | null; itemId?: string | null };

/** Lee el texto entrante. Devuelve null si no es un mensaje que venga de Marketplace. */
export function detectarOrigenMarketplace(textoEntrante: string | null | undefined): OrigenMarketplace | null {
  const t = String(textoEntrante ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (!t.trim()) return null;
  const ref = t.match(REF_RE);
  const item = t.match(ITEM_RE);
  if (!ref && !item && !VENGO_RE.test(t)) return null;
  return {
    cuenta: ref ? ref[1].toUpperCase() : null,
    ...(item ? { itemId: item[1] } : {}),
  };
}

/* ------------------------------------------------------------------------------------------------
   API OFICIAL (Cloud API): Meta manda el dato del anuncio en `messages[].referral` del primer
   mensaje que entra por un Click-to-WhatsApp. Se traduce a la misma forma que Evolution/WAHA
   (externalAdReply) para guardarlo igual en Contact.metadata.
------------------------------------------------------------------------------------------------- */

export type AnuncioDelLead = {
  title: string;
  sourceApp: string;
  body: string;
  ctwaClid: string;
  sourceId: string;
  sourceUrl: string;
};

/** `referral` de Cloud API → anuncio, o null si no vino de un anuncio. */
export function leerReferralOficial(referral: unknown): AnuncioDelLead | null {
  const r = comoObjeto(referral);
  if (!Object.keys(r).length) return null;
  const s = (valor: unknown) => (typeof valor === "string" ? valor.trim() : "");
  const sourceType = s(r.source_type).toLowerCase();
  const title = s(r.headline);
  const sourceId = s(r.source_id);
  // Solo cuenta como anuncio si dice "ad" o trae id/título: un referral de una publicación
  // orgánica ("post") también es Meta, y se guarda igual con su id.
  if (!sourceType && !title && !sourceId) return null;
  const url = s(r.source_url);
  return {
    title,
    body: s(r.body),
    sourceApp: /instagram/i.test(url) ? "instagram" : url ? "facebook" : "",
    ctwaClid: s(r.ctwa_clid),
    sourceId,
    sourceUrl: url,
  };
}

/* ------------------------------------------------------------------------------------------------
   CONSULTA DE ORIGEN POR TELÉFONO (la usa el script de relleno de Gestión, solo lectura).
------------------------------------------------------------------------------------------------- */

/**
 * Variantes de un teléfono colombiano para buscar la ficha: el CRM guarda "573001234567", pero
 * Gestión puede tenerlo como "300 123 4567" o "+57 300…". Devuelve [] si no parece un número.
 */
export function variantesDeTelefono(valor: string | null | undefined): string[] {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  if (digitos.length < 7 || digitos.length > 15) return [];
  const variantes = new Set<string>([digitos]);
  if (digitos.length === 10 && digitos.startsWith("3")) variantes.add(`57${digitos}`);
  if (digitos.length === 12 && digitos.startsWith("57")) variantes.add(digitos.slice(2));
  return [...variantes];
}

/** Compara la llave del header contra las llaves de las conexiones con Gestión (tiempo constante). */
export function llaveDelHeader(autorizacion: string | null | undefined): string | null {
  const partes = /^Bearer\s+(.+)$/i.exec(String(autorizacion ?? "").trim());
  return partes?.[1]?.trim() || null;
}

export function mismaLlave(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export type RespuestaDeConsulta = {
  status: number;
  body: Record<string, unknown>;
};

/**
 * Lógica del GET /api/origen?telefono=… con las dependencias inyectadas (para probarla sin base).
 * Nunca devuelve el teléfono ni el nombre: solo el origen.
 */
export async function responderConsultaDeOrigen(
  input: { autorizacion: string | null; telefono: string | null },
  deps: {
    workspacePorLlave: (llave: string) => Promise<string | null>;
    origenPorTelefono: (workspaceId: string, variantes: string[]) => Promise<OrigenCalculado | null>;
  },
): Promise<RespuestaDeConsulta> {
  const llave = llaveDelHeader(input.autorizacion);
  const workspaceId = llave ? await deps.workspacePorLlave(llave) : null;
  if (!workspaceId) {
    return { status: 401, body: { error: "no_autorizado" } };
  }
  const variantes = variantesDeTelefono(input.telefono);
  if (!variantes.length) {
    return { status: 400, body: { error: "telefono_invalido" } };
  }
  const origen = await deps.origenPorTelefono(workspaceId, variantes);
  if (!origen) {
    return { status: 200, body: { encontrado: false, origin: "SIN_DATO", originDetail: null, linea: null } };
  }
  return {
    status: 200,
    body: { encontrado: true, origin: origen.origin, originDetail: { ...origen.originDetail, via: "telefono" }, linea: origen.linea },
  };
}
