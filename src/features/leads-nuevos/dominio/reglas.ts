import { detectarOrigenMarketplace, origenDeLinea, type MapaDeLineas } from "../../../lib/origen-de-venta";

/**
 * LEADS NUEVOS REALES: las reglas, en código puro (sin base, sin Next). Las pruebas están en
 * scripts/check-leads-nuevos.mjs.
 *
 * Lead nuevo = un cliente (por teléfono normalizado) cuyo PRIMER mensaje de la vida cae en el día pedido
 * (hora de Colombia: el día arranca a las 05:00 UTC), entrando por cualquier línea, Admin incluida.
 * Si escribe por dos líneas cuenta UNA vez, en la línea donde escribió primero.
 *
 * Origen, en este orden: meta (anuncio) > marketplace por texto > marketplace por línea > directo.
 * Asesora: la dueña actual del chat; si no tiene, la del chat del mismo cliente en la otra línea; si no, sin asignar.
 */

const HORA = 3_600_000;

/** [desde, hasta) en UTC del día "AAAA-MM-DD" de Colombia (corte 05:00 UTC). */
export function limitesDelDia(fecha: string): { desde: number; hasta: number } {
  const desde = new Date(`${fecha}T00:00:00Z`).getTime() + 5 * HORA;
  return { desde, hasta: desde + 24 * HORA };
}

/** Solo dígitos; un celular colombiano de 10 dígitos que empieza por 3 se completa con el 57. */
export function normalizarTelefono(valor: string | null | undefined): string {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  return digitos.length === 10 && digitos.startsWith("3") ? `57${digitos}` : digitos;
}

/** Un chat del cliente (una conversación) con lo que hace falta para contarlo. */
export type FilaDeLeadNuevo = {
  telefono: string;
  /** Primer mensaje ENTRANTE de este chat, en toda su vida (ISO o Date). */
  primerMensajeEn: string | Date;
  /** Texto del primer mensaje entrante de este chat. */
  primerTexto?: string | null;
  canalId: string | null;
  linea: string | null;
  proposito?: string | null;
  metadataLinea?: unknown;
  /** Contact.metadata (datos del anuncio o de Marketplace). */
  metadataContacto?: unknown;
  /** El EmbudoLead de este chat trae anuncio. */
  anuncioEnEmbudo?: boolean;
  /** El contacto tiene la etiqueta Marketplace. */
  etiquetaMarketplace?: boolean;
  asesoraId?: string | null;
  asesora?: string | null;
};

export type OrigenDelLead = "meta" | "marketplace_por_texto" | "marketplace_por_linea" | "directo";
export type LineaDelLead = "admin" | "ventas_1" | "ventas_2" | "otras";

export type DesgloseDeOrigen = {
  meta: number;
  marketplace: { total: number; por_texto: number; por_linea: number };
  directo: number;
};

export type LeadNuevo = {
  telefono: string;
  origen: OrigenDelLead;
  linea: LineaDelLead;
  asesoraId: string | null;
  asesora: string | null;
  primerMensajeEn: string;
};

export type LeadsNuevosAgrupados = {
  fecha: string;
  total: number;
  por_origen: DesgloseDeOrigen;
  por_linea: { admin: number; ventas_1: number; ventas_2: number; otras: number; solo_ventas: number };
  por_asesora: Array<{ asesora: string; id: string; total: number; por_origen: DesgloseDeOrigen }>;
  sin_asignar: number;
};

function comoObjeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

const aMs = (valor: string | Date) => new Date(valor).getTime();

/** ¿El contacto trae datos de un anuncio de Meta? (lo que guarda el webhook en Contact.metadata). */
export function metadataTraeAnuncio(metadata: unknown): boolean {
  const meta = comoObjeto(metadata);
  return Boolean(texto(meta.adCapturedAt) || texto(meta.adSourceId) || texto(meta.source)?.toLowerCase() === "meta ads");
}

function metadataTraeMarketplace(metadata: unknown): boolean {
  return texto(comoObjeto(comoObjeto(metadata).origen).canal)?.toLowerCase() === "marketplace";
}

export function lineaDeLaFila(fila: FilaDeLeadNuevo, mapa: MapaDeLineas = {}): LineaDelLead {
  if ((fila.proposito ?? "").toUpperCase() === "ADMIN") return "admin";
  const origen = origenDeLinea(
    { channelId: fila.canalId, nombre: fila.linea, purpose: fila.proposito, metadata: fila.metadataLinea },
    mapa,
  );
  if (origen === "REFERIDO_RECURRENTE") return "admin";
  if (origen === "MARKETPLACE") return "ventas_2";
  if (origen === "META_ADS") return "ventas_1";
  return "otras";
}

export function origenDelLead(filas: FilaDeLeadNuevo[], primera: FilaDeLeadNuevo, mapa: MapaDeLineas = {}): OrigenDelLead {
  if (filas.some((f) => f.anuncioEnEmbudo || metadataTraeAnuncio(f.metadataContacto))) return "meta";
  if (
    filas.some((f) => f.etiquetaMarketplace || metadataTraeMarketplace(f.metadataContacto)) ||
    detectarOrigenMarketplace(primera.primerTexto)
  ) {
    return "marketplace_por_texto";
  }
  const origenLinea = origenDeLinea(
    { channelId: primera.canalId, nombre: primera.linea, purpose: primera.proposito, metadata: primera.metadataLinea },
    mapa,
  );
  return origenLinea === "MARKETPLACE" ? "marketplace_por_linea" : "directo";
}

/**
 * Los leads nuevos del día. Un cliente cuyo primer mensaje es de antes del día (o de después) no cuenta:
 * `filas` trae todos los chats de cada cliente, así se ve su primer mensaje de la vida.
 */
export function leadsNuevosDeLasFilas(filas: FilaDeLeadNuevo[], fecha: string, mapa: MapaDeLineas = {}): LeadNuevo[] {
  const { desde, hasta } = limitesDelDia(fecha);
  const porCliente = new Map<string, FilaDeLeadNuevo[]>();
  for (const fila of filas) {
    const telefono = normalizarTelefono(fila.telefono);
    if (!telefono || !Number.isFinite(aMs(fila.primerMensajeEn))) continue;
    const lista = porCliente.get(telefono) ?? [];
    lista.push({ ...fila, telefono });
    porCliente.set(telefono, lista);
  }

  const leads: LeadNuevo[] = [];
  for (const [telefono, chats] of porCliente) {
    const ordenados = [...chats].sort((a, b) => aMs(a.primerMensajeEn) - aMs(b.primerMensajeEn));
    const primera = ordenados[0];
    const cuando = aMs(primera.primerMensajeEn);
    if (cuando < desde || cuando >= hasta) continue;
    // Dueña: la del chat donde escribió primero; si no tiene, la de su chat en la otra línea.
    const conDuena = ordenados.find((f) => f.asesoraId);
    leads.push({
      telefono,
      origen: origenDelLead(ordenados, primera, mapa),
      linea: lineaDeLaFila(primera, mapa),
      asesoraId: conDuena?.asesoraId ?? null,
      asesora: conDuena?.asesoraId ? (conDuena.asesora?.trim() || "Sin nombre") : null,
      primerMensajeEn: new Date(cuando).toISOString(),
    });
  }
  return leads;
}

const desgloseVacio = (): DesgloseDeOrigen => ({ meta: 0, marketplace: { total: 0, por_texto: 0, por_linea: 0 }, directo: 0 });

function sumarOrigen(desglose: DesgloseDeOrigen, origen: OrigenDelLead) {
  if (origen === "meta") desglose.meta += 1;
  else if (origen === "directo") desglose.directo += 1;
  else {
    desglose.marketplace.total += 1;
    if (origen === "marketplace_por_texto") desglose.marketplace.por_texto += 1;
    else desglose.marketplace.por_linea += 1;
  }
}

/** Arma el resultado final. `filas` son los chats de los clientes (ver `leadsNuevosDeLasFilas`). */
export function agruparLeadsNuevos(filas: FilaDeLeadNuevo[], fecha: string, mapa: MapaDeLineas = {}): LeadsNuevosAgrupados {
  return agruparLeads(leadsNuevosDeLasFilas(filas, fecha, mapa), fecha);
}

export function agruparLeads(leads: LeadNuevo[], fecha: string): LeadsNuevosAgrupados {
  const por_origen = desgloseVacio();
  const por_linea = { admin: 0, ventas_1: 0, ventas_2: 0, otras: 0, solo_ventas: 0 };
  const asesoras = new Map<string, { asesora: string; id: string; total: number; por_origen: DesgloseDeOrigen }>();
  let sin_asignar = 0;

  for (const lead of leads) {
    sumarOrigen(por_origen, lead.origen);
    por_linea[lead.linea] += 1;
    if (lead.linea !== "admin") por_linea.solo_ventas += 1;
    if (!lead.asesoraId) {
      sin_asignar += 1;
      continue;
    }
    const actual = asesoras.get(lead.asesoraId) ?? {
      asesora: lead.asesora ?? "Sin nombre",
      id: lead.asesoraId,
      total: 0,
      por_origen: desgloseVacio(),
    };
    actual.total += 1;
    sumarOrigen(actual.por_origen, lead.origen);
    asesoras.set(lead.asesoraId, actual);
  }

  const por_asesora = [...asesoras.values()].sort((a, b) => b.total - a.total || a.asesora.localeCompare(b.asesora, "es"));
  return { fecha, total: leads.length, por_origen, por_linea, por_asesora, sin_asignar };
}
