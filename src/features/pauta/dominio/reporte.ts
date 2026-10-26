/**
 * REPORTE DE PAUTA (reglas puras, sin base ni red): por campaña y por anuncio, cuántos chats llegaron,
 * cuántos llegaron a Caliente, cuántos compraron, cuánto se vendió, la tasa de cierre y el costo por
 * venta. Lo usan la pantalla (CRM → Pauta) y la herramienta MCP `ventas_por_campana`: el mismo cálculo.
 *
 * Este archivo no importa Prisma a propósito: se prueba con `node scripts/check-pauta.mjs`.
 */

export const NOMBRE_ORGANICO = "Orgánico / Marketplace / Otro";
export const NOMBRE_SIN_CAMPANA = "Campaña sin identificar";
export const CLAVE_ORGANICO = "ORGANICO_OTRO";
export const CLAVE_SIN_CAMPANA = "SIN_CAMPANA";

export type OrigenDelChat = {
  contactId: string;
  anuncioId: string;
  anuncioNombre: string | null;
  conjuntoNombre: string | null;
  campanaId: string | null;
  campanaNombre: string | null;
  /** Llegó a Caliente (o ya tenía cotización, anticipo o venta). */
  caliente: boolean;
};

export type VentaConOrigen = {
  /** El origen del cliente de la venta, o null si no vino de un anuncio. */
  origen: Pick<OrigenDelChat, "anuncioId" | "campanaId"> | null;
  /** null = no se conoce el monto. */
  monto: number | null;
};

export type GastoDeAnuncio = {
  anuncioId: string;
  anuncioNombre: string | null;
  conjuntoNombre: string | null;
  campanaId: string | null;
  campanaNombre: string | null;
  gasto: number;
};

export type FilaDePauta = {
  clave: string;
  nombre: string;
  /** null = no disponible (sin llave de Meta). */
  gasto: number | null;
  chats: number;
  calientes: number;
  ventas: number;
  /** null = ninguna venta trae monto. */
  monto: number | null;
  /** ventas ÷ chats, en %. null si no hay chats. */
  tasaCierre: number | null;
  /** gasto ÷ ventas. null si no hay gasto o no hay ventas. */
  costoPorVenta: number | null;
};

export type FilaDeCampana = FilaDePauta & { anuncios: FilaDePauta[] };

export type ReporteDePauta = {
  gastoDisponible: boolean;
  campanas: FilaDeCampana[];
  organico: FilaDePauta;
  total: FilaDePauta;
};

/** Las dos formas de un teléfono colombiano: con y sin el 57 (la misma regla que usa Gestión). */
export function variantesDeTelefono(telefono: string | null | undefined): string[] {
  const digitos = String(telefono ?? "").replace(/\D/g, "");
  if (digitos.length < 7) return [];
  const variantes = new Set<string>([digitos]);
  if (digitos.length === 12 && digitos.startsWith("57")) variantes.add(digitos.slice(2));
  if (digitos.length === 10) variantes.add(`57${digitos}`);
  return [...variantes];
}

export function mismoTelefono(a: string | null | undefined, b: string | null | undefined): boolean {
  const va = variantesDeTelefono(a);
  const vb = new Set(variantesDeTelefono(b));
  return va.some((v) => vb.has(v));
}

function fila(clave: string, nombre: string): FilaDePauta {
  return { clave, nombre, gasto: null, chats: 0, calientes: 0, ventas: 0, monto: null, tasaCierre: null, costoPorVenta: null };
}

function cerrar(f: FilaDePauta, gastoDisponible: boolean): FilaDePauta {
  const gasto = gastoDisponible ? (f.gasto ?? 0) : null;
  return {
    ...f,
    gasto,
    tasaCierre: f.chats > 0 ? (f.ventas / f.chats) * 100 : null,
    // Sin gasto o sin ventas no se divide: sale "—" y no un error ni un infinito.
    costoPorVenta: gasto !== null && gasto > 0 && f.ventas > 0 ? gasto / f.ventas : null,
  };
}

function sumarVenta(f: FilaDePauta, monto: number | null) {
  f.ventas += 1;
  if (monto !== null) f.monto = (f.monto ?? 0) + monto;
}

/**
 * Arma el reporte. `gastos` es null cuando no hay llave de Meta (el gasto sale "no disponible" y
 * todo se agrupa por anuncio, sin nombre de campaña).
 */
export function armarReporte(input: {
  origenes: OrigenDelChat[];
  ventas: VentaConOrigen[];
  gastos: GastoDeAnuncio[] | null;
}): ReporteDePauta {
  const gastoDisponible = input.gastos !== null;
  const campanas = new Map<string, { fila: FilaDePauta; anuncios: Map<string, FilaDePauta> }>();
  const anuncioACampana = new Map<string, string>();

  const clavePorCampana = (campanaId: string | null) => campanaId ?? CLAVE_SIN_CAMPANA;
  function campana(claveDeCampana: string, nombre: string | null) {
    let c = campanas.get(claveDeCampana);
    if (!c) {
      c = { fila: fila(claveDeCampana, nombre ?? NOMBRE_SIN_CAMPANA), anuncios: new Map() };
      campanas.set(claveDeCampana, c);
    } else if (nombre && c.fila.nombre === NOMBRE_SIN_CAMPANA) {
      c.fila.nombre = nombre;
    }
    return c;
  }
  function anuncio(c: ReturnType<typeof campana>, anuncioId: string, nombre: string | null) {
    let a = c.anuncios.get(anuncioId);
    if (!a) {
      a = fila(anuncioId, nombre ?? `Anuncio ${anuncioId}`);
      c.anuncios.set(anuncioId, a);
    } else if (nombre && a.nombre === `Anuncio ${anuncioId}`) {
      a.nombre = nombre;
    }
    return a;
  }

  for (const o of input.origenes) {
    const claveC = clavePorCampana(o.campanaId);
    anuncioACampana.set(o.anuncioId, claveC);
    const c = campana(claveC, o.campanaNombre);
    const a = anuncio(c, o.anuncioId, o.anuncioNombre);
    for (const f of [c.fila, a]) {
      f.chats += 1;
      if (o.caliente) f.calientes += 1;
    }
  }

  for (const g of input.gastos ?? []) {
    const claveC = anuncioACampana.get(g.anuncioId) ?? clavePorCampana(g.campanaId);
    anuncioACampana.set(g.anuncioId, claveC);
    const c = campana(claveC, g.campanaNombre);
    const a = anuncio(c, g.anuncioId, g.anuncioNombre);
    c.fila.gasto = (c.fila.gasto ?? 0) + g.gasto;
    a.gasto = (a.gasto ?? 0) + g.gasto;
  }

  const organico = fila(CLAVE_ORGANICO, NOMBRE_ORGANICO);
  for (const v of input.ventas) {
    const claveC = v.origen ? anuncioACampana.get(v.origen.anuncioId) ?? clavePorCampana(v.origen.campanaId) : null;
    if (!v.origen || claveC === null) {
      sumarVenta(organico, v.monto);
      continue;
    }
    const c = campana(claveC, null);
    const a = anuncio(c, v.origen.anuncioId, null);
    sumarVenta(c.fila, v.monto);
    sumarVenta(a, v.monto);
  }

  const lista: FilaDeCampana[] = [...campanas.values()].map((c) => ({
    ...cerrar(c.fila, gastoDisponible),
    anuncios: [...c.anuncios.values()].map((a) => cerrar(a, gastoDisponible)).sort(ordenar),
  }));
  lista.sort(ordenar);

  const total = fila("TOTAL", "Total");
  total.chats = lista.reduce((s, c) => s + c.chats, 0);
  total.calientes = lista.reduce((s, c) => s + c.calientes, 0);
  total.ventas = lista.reduce((s, c) => s + c.ventas, 0);
  const montos = lista.map((c) => c.monto).filter((m): m is number => m !== null);
  total.monto = montos.length ? montos.reduce((s, m) => s + m, 0) : null;
  total.gasto = gastoDisponible ? lista.reduce((s, c) => s + (c.gasto ?? 0), 0) : null;

  return { gastoDisponible, campanas: lista, organico: cerrar(organico, false), total: cerrar(total, gastoDisponible) };
}

/** Más ventas primero; a igual número de ventas, más chats. */
function ordenar(a: FilaDePauta, b: FilaDePauta) {
  return b.ventas - a.ventas || b.chats - a.chats || (b.gasto ?? 0) - (a.gasto ?? 0);
}

const entero = (n: number) => Math.round(n).toLocaleString("es-CO");

export const textoDinero = (valor: number | null) => (valor === null ? "—" : `$${entero(valor)}`);
export const textoTasa = (valor: number | null) => (valor === null ? "—" : `${(Math.round(valor * 10) / 10).toLocaleString("es-CO")} %`);

/** Frase corta para decir por voz. */
export function resumenParaDecir(r: ReporteDePauta, rango: { desde: string; hasta: string }): string {
  const con = r.campanas.filter((c) => c.ventas > 0);
  const partes: string[] = [];
  if (!con.length) {
    partes.push(`Del ${rango.desde} al ${rango.hasta} ninguna campaña tiene ventas registradas.`);
  } else {
    const mejor = con[0];
    partes.push(
      `Del ${rango.desde} al ${rango.hasta} vendió más "${mejor.nombre}": ${mejor.ventas} ventas de ${mejor.chats} chats (cierre ${textoTasa(mejor.tasaCierre)})` +
        (mejor.costoPorVenta !== null ? `, a ${textoDinero(mejor.costoPorVenta)} por venta.` : ", sin costo por venta porque no hay gasto."),
    );
  }
  partes.push(`En total: ${r.total.chats} chats de pauta, ${r.total.ventas} ventas de pauta y ${r.organico.ventas} ventas orgánicas/otras.`);
  if (!r.gastoDisponible) partes.push("El gasto no está disponible (falta conectar Meta Ads en solo lectura).");
  if (r.total.monto === null && r.total.ventas > 0) partes.push("El monto vendido no está disponible: Gestión no entregó la lista de ventas.");
  return partes.join(" ");
}

export type AnuncioDeLaFicha = {
  anuncioId: string;
  anuncioNombre: string | null;
  red: string | null;
  ctwaClid: string | null;
  llegoEn: Date;
};

/**
 * El anuncio que el webhook ya guardó en la ficha (Contact.metadata: adSourceId, adTitle, adCtwaClid,
 * adSourceApp, adCapturedAt). Una ficha sin anuncio guardado no tiene origen de pauta (null).
 */
export function anuncioDeLaFicha(metadata: unknown, creadoEn: Date): AnuncioDeLaFicha | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const m = metadata as Record<string, unknown>;
  const anuncioId = typeof m.adSourceId === "string" || typeof m.adSourceId === "number" ? String(m.adSourceId).trim() : "";
  if (!anuncioId) return null;
  const capturada = typeof m.adCapturedAt === "string" ? new Date(m.adCapturedAt) : null;
  const red = typeof m.adSourceApp === "string" ? m.adSourceApp.trim().toLowerCase() : "";
  return {
    anuncioId,
    anuncioNombre: typeof m.adTitle === "string" && m.adTitle.trim() ? m.adTitle.trim() : null,
    red: red || null,
    ctwaClid: typeof m.adCtwaClid === "string" && m.adCtwaClid.trim() ? m.adCtwaClid.trim() : null,
    llegoEn: capturada && !Number.isNaN(capturada.getTime()) ? capturada : creadoEn,
  };
}
