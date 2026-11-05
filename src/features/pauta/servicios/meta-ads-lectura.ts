import type { GastoDeAnuncio } from "../dominio/reporte";

/**
 * META ADS: SOLO LECTURA. Este archivo solo hace peticiones GET al Graph API de Meta, para cuatro cosas:
 *   1. Saber a qué campaña y conjunto pertenece un anuncio (el mensaje de WhatsApp solo trae el anuncio).
 *   2. Leer el gasto por anuncio en un rango de fechas.
 *   3. Leer el gasto de la cuenta por región en un rango de fechas (para el mapa de Colombia).
 *   4. Listar los anuncios de una campaña (el reparto por anuncio los aprende para las reglas por campaña).
 * Nunca pausa, edita ni crea nada (la prueba scripts/check-pauta.mjs vigila que no aparezca otro método).
 *
 * Hace falta una llave con permiso `ads_read` y el número de la cuenta publicitaria, en las variables
 * META_ADS_ACCESS_TOKEN y META_ADS_ACCOUNT_ID. Sin ellas todo devuelve "no disponible" y no lanza; el gasto por
 * región además dice si fue por falta de llave o porque Meta contestó con error (y el error de Meta va al log).
 */

const VERSION = "v21.0";

const texto = (valor: unknown): string | null => (typeof valor === "string" && valor.trim() ? valor.trim() : null);
const BASE = `https://graph.facebook.com/${VERSION}`;

export function metaAdsConfigurado(): boolean {
  return Boolean(process.env.META_ADS_ACCESS_TOKEN?.trim() && process.env.META_ADS_ACCOUNT_ID?.trim());
}

function cuenta(): string {
  const id = (process.env.META_ADS_ACCOUNT_ID ?? "").trim();
  return id.startsWith("act_") ? id : `act_${id}`;
}

async function leer(ruta: string, parametros: Record<string, string>): Promise<Record<string, unknown>> {
  const url = new URL(ruta.startsWith("http") ? ruta : `${BASE}/${ruta}`);
  for (const [clave, valor] of Object.entries(parametros)) url.searchParams.set(clave, valor);
  const respuesta = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${(process.env.META_ADS_ACCESS_TOKEN ?? "").trim()}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!respuesta.ok) throw new Error(`Meta Ads respondió ${respuesta.status}: ${await motivoDeMeta(respuesta)}`);
  return (await respuesta.json()) as Record<string, unknown>;
}

/**
 * El motivo que Meta da cuando contesta con error ({"error":{"message","type","code"}}), para el log.
 * Solo el mensaje, el tipo y el código, recortado: nunca la URL ni la llave.
 */
async function motivoDeMeta(respuesta: Response): Promise<string> {
  try {
    const cuerpo = (await respuesta.json()) as Record<string, unknown>;
    const error = (cuerpo.error ?? {}) as Record<string, unknown>;
    const partes = [texto(error.message), texto(error.type), error.code !== undefined ? `código ${String(error.code)}` : null].filter(Boolean);
    return partes.length ? partes.join(" · ").slice(0, 300) : "sin detalle";
  } catch {
    return "sin detalle";
  }
}

export type DatosDeAnuncio = {
  anuncioNombre: string | null;
  conjuntoId: string | null;
  conjuntoNombre: string | null;
  campanaId: string | null;
  campanaNombre: string | null;
};

/** La campaña y el conjunto de un anuncio. null si Meta no lo conoce o no hay llave. Nunca lanza. */
export async function buscarAnuncio(anuncioId: string): Promise<DatosDeAnuncio | null> {
  if (!metaAdsConfigurado() || !/^\d{5,25}$/.test(anuncioId)) return null;
  try {
    const d = await leer(anuncioId, { fields: "name,adset{id,name},campaign{id,name}" });
    const conjunto = (d.adset ?? {}) as Record<string, unknown>;
    const campana = (d.campaign ?? {}) as Record<string, unknown>;
    return {
      anuncioNombre: texto(d.name),
      conjuntoId: texto(conjunto.id),
      conjuntoNombre: texto(conjunto.name),
      campanaId: texto(campana.id),
      campanaNombre: texto(campana.name),
    };
  } catch (error) {
    console.warn("[pauta] no se pudo leer el anuncio en Meta", { anuncioId, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export type AnuncioDeCampana = {
  anuncioId: string;
  anuncioNombre: string | null;
  campanaId: string | null;
  campanaNombre: string | null;
};

/**
 * Los anuncios de una campaña (GET a `<campaña>/ads`, siguiendo la paginación hasta 20 páginas).
 * null = no disponible (sin llave, id inválido o Meta falló). Nunca lanza.
 */
export async function listarAnunciosDeCampana(campanaId: string): Promise<AnuncioDeCampana[] | null> {
  if (!metaAdsConfigurado() || !/^\d{5,25}$/.test(campanaId)) return null;
  try {
    const anuncios: AnuncioDeCampana[] = [];
    let siguiente: string | null = null;
    for (let pagina = 0; pagina < 20; pagina += 1) {
      const d: Record<string, unknown> = siguiente
        ? await leer(siguiente, {})
        : await leer(`${campanaId}/ads`, { fields: "id,name,campaign{id,name}", limit: "200" });
      for (const fila of Array.isArray(d.data) ? (d.data as Record<string, unknown>[]) : []) {
        const anuncioId = texto(fila.id);
        if (!anuncioId) continue;
        const campana = (fila.campaign ?? {}) as Record<string, unknown>;
        anuncios.push({
          anuncioId,
          anuncioNombre: texto(fila.name),
          campanaId: texto(campana.id),
          campanaNombre: texto(campana.name),
        });
      }
      siguiente = texto(((d.paging ?? {}) as Record<string, unknown>).next);
      if (!siguiente) break;
    }
    return anuncios;
  } catch (error) {
    console.warn("[pauta] no se pudo leer los anuncios de la campaña en Meta", {
      campanaId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Gasto por anuncio entre dos días AAAA-MM-DD (incluidos). null = no disponible (sin llave o Meta falló). */
export async function leerGastoPorAnuncio(desde: string, hasta: string): Promise<GastoDeAnuncio[] | null> {
  if (!metaAdsConfigurado()) return null;
  try {
    const gastos: GastoDeAnuncio[] = [];
    let siguiente: string | null = null;
    for (let pagina = 0; pagina < 20; pagina += 1) {
      const d: Record<string, unknown> = siguiente
        ? await leer(siguiente, {})
        : await leer(`${cuenta()}/insights`, {
            level: "ad",
            fields: "ad_id,ad_name,adset_name,campaign_id,campaign_name,spend",
            time_range: JSON.stringify({ since: desde, until: hasta }),
            limit: "200",
          });
      for (const fila of Array.isArray(d.data) ? (d.data as Record<string, unknown>[]) : []) {
        const anuncioId = texto(fila.ad_id);
        const gasto = Number(fila.spend);
        if (!anuncioId || !Number.isFinite(gasto)) continue;
        gastos.push({
          anuncioId,
          anuncioNombre: texto(fila.ad_name),
          conjuntoNombre: texto(fila.adset_name),
          campanaId: texto(fila.campaign_id),
          campanaNombre: texto(fila.campaign_name),
          gasto,
        });
      }
      siguiente = texto(((d.paging ?? {}) as Record<string, unknown>).next);
      if (!siguiente) break;
    }
    return gastos;
  } catch (error) {
    console.warn("[pauta] no se pudo leer el gasto en Meta", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export type GastoDeRegion = { region: string; gasto: number };

/** Por qué no hay gasto: falta la llave en el servidor, o Meta contestó con error (o no contestó a tiempo). */
export type MotivoSinGasto = "sin llave" | "meta fallo";

/** Gasto por región de Meta: "ok" con las filas, o "no disponible" con su motivo. */
export type GastoPorRegion = { estado: "ok"; filas: GastoDeRegion[] } | { estado: "no disponible"; motivo: MotivoSinGasto };

/**
 * Gasto de toda la cuenta por región entre dos días AAAA-MM-DD (incluidos): una sola consulta a insights
 * con breakdowns=region, siguiendo la paginación. La región viene como la nombra Meta ("Valle del Cauca
 * Department"); la traduce el mapa. Nunca lanza.
 */
export async function leerGastoPorRegion(desde: string, hasta: string): Promise<GastoPorRegion> {
  if (!metaAdsConfigurado()) return { estado: "no disponible", motivo: "sin llave" };
  try {
    const filas: GastoDeRegion[] = [];
    let siguiente: string | null = null;
    for (let pagina = 0; pagina < 20; pagina += 1) {
      const d: Record<string, unknown> = siguiente
        ? await leer(siguiente, {})
        : await leer(`${cuenta()}/insights`, {
            level: "account",
            fields: "spend",
            breakdowns: "region",
            time_range: JSON.stringify({ since: desde, until: hasta }),
            limit: "500",
          });
      for (const fila of Array.isArray(d.data) ? (d.data as Record<string, unknown>[]) : []) {
        const gasto = Number(fila.spend);
        if (!Number.isFinite(gasto)) continue;
        filas.push({ region: texto(fila.region) ?? "", gasto });
      }
      siguiente = texto(((d.paging ?? {}) as Record<string, unknown>).next);
      if (!siguiente) break;
    }
    return { estado: "ok", filas };
  } catch (error) {
    console.warn("[pauta] no se pudo leer el gasto por región en Meta", error instanceof Error ? error.message : String(error));
    return { estado: "no disponible", motivo: "meta fallo" };
  }
}
