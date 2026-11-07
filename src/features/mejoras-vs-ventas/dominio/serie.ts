/**
 * MEJORAS VS VENTAS — cálculos puros (sin base ni red). Arma la serie de los últimos 30 días (hora de Colombia)
 * con leads nuevos, cotizaciones y ventas, y le pega los cambios terminados de cada día.
 *
 * Regla de oro: un dato que no se pudo leer es `null` ("sin dato"), nunca 0.
 */

const HORA = 3_600_000;
const DIA = 24 * HORA;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** Una fecha guardada a la medianoche UTC (así guarda Gestión algunas cotizaciones): vale el día escrito. */
const MEDIANOCHE_UTC = /^(\d{4}-\d{2}-\d{2})T00:00(?::00(?:\.0+)?)?(?:Z|\+00:00)$/;

export const DIAS_DE_LA_SERIE = 30;
export const META_COTIZACIONES_DEL_DIA = 10;

/** El día de hoy en Colombia (sin horario de verano: desfase fijo de 5 h). */
export function hoyEnColombia(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - 5 * HORA).toISOString().slice(0, 10);
}

export function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * DIA).toISOString().slice(0, 10);
}

/** Los `dias` días que terminan en `hoy` (incluido), del más viejo al más nuevo. */
export function diasDeLaVentana(hoy: string, dias: number = DIAS_DE_LA_SERIE): string[] {
  return Array.from({ length: dias }, (_, i) => sumarDias(hoy, i - (dias - 1)));
}

/**
 * El día de Colombia de una fecha que manda Gestión. "AAAA-MM-DD" y la medianoche UTC valen el día escrito
 * (si se pasara a hora de Colombia caería un día antes); cualquier otra hora se pasa a hora de Colombia.
 */
export function diaDeColombia(valor: unknown): string | null {
  if (valor instanceof Date) return Number.isFinite(valor.getTime()) ? hoyEnColombia(valor) : null;
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  if (FECHA.test(texto)) return texto;
  const medianoche = MEDIANOCHE_UTC.exec(texto);
  if (medianoche) return medianoche[1];
  const ms = Date.parse(texto);
  return Number.isFinite(ms) ? hoyEnColombia(new Date(ms)) : null;
}

/** Cuántos hay de cada día de la ventana (los de fuera de la ventana no cuentan). */
export function contarPorDia(fechas: Array<string | null>, dias: string[]): Map<string, number> {
  const conteo = new Map(dias.map((dia) => [dia, 0]));
  for (const fecha of fechas) {
    if (fecha && conteo.has(fecha)) conteo.set(fecha, (conteo.get(fecha) ?? 0) + 1);
  }
  return conteo;
}

export type OrigenDeVenta = "nuevo" | "recurrente" | "sin_clasificar";

/** El campo `origen` de la venta en Gestión → nuevo, recurrente o sin clasificar. */
export function clasificarOrigen(origen: unknown): OrigenDeVenta {
  if (typeof origen !== "string") return "sin_clasificar";
  const texto = origen.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/recurrent|antigu|existente|repetid|recompra/.test(texto)) return "recurrente";
  if (/nuev|lead/.test(texto)) return "nuevo";
  return "sin_clasificar";
}

/** Un abono ya reducido a lo que importa (sin cliente ni monto). */
export type AbonoReducido = { dia: string | null; esPrimerAbono: boolean; ventaCancelada: boolean; venta: string | null; origen?: unknown };

export type VentasDelDia = { total: number; nuevos: number; recurrentes: number; sinClasificar: number };

/**
 * Las ventas de cada día: el primer abono de una venta no anulada, por la fecha del abono. El origen sale de la
 * venta (por su código); si no se encuentra, la venta cuenta igual como "sin clasificar".
 */
export function ventasPorDia(
  abonos: AbonoReducido[],
  origenPorVenta: Map<string, unknown> | null,
  dias: string[],
): Map<string, VentasDelDia> {
  const porDia = new Map<string, VentasDelDia>(dias.map((dia) => [dia, { total: 0, nuevos: 0, recurrentes: 0, sinClasificar: 0 }]));
  for (const abono of abonos) {
    if (!abono.esPrimerAbono || abono.ventaCancelada || !abono.dia) continue;
    const delDia = porDia.get(abono.dia);
    if (!delDia) continue;
    const origen = clasificarOrigen((abono.venta && origenPorVenta?.get(abono.venta)) ?? abono.origen);
    delDia.total += 1;
    if (origen === "nuevo") delDia.nuevos += 1;
    else if (origen === "recurrente") delDia.recurrentes += 1;
    else delDia.sinClasificar += 1;
  }
  return porDia;
}

/** a / b en %, redondeado. Sin dato o sin base (b = 0) → null: nunca se divide por cero. */
export function porcentaje(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b <= 0) return null;
  return Math.round((a / b) * 100);
}

export type CambioDelDia = { codigo: string; titulo: string };

/** Una tarjeta terminada (de `terminadasDeLaSemana`), reducida a lo que se muestra. */
export type TarjetaTerminada = { codigo: string; titulo: string; estado: string; terminadaEn: string };

/** Los cambios de cada día: solo las tarjetas HECHO (una FALLIDO no se marca), por su día de terminada en Colombia. */
export function cambiosPorDia(tarjetas: TarjetaTerminada[], dias: string[]): Map<string, CambioDelDia[]> {
  const porDia = new Map<string, CambioDelDia[]>(dias.map((dia) => [dia, []]));
  const vistas = new Set<string>();
  for (const tarjeta of tarjetas) {
    if (tarjeta.estado !== "HECHO" || vistas.has(tarjeta.codigo)) continue;
    const dia = diaDeColombia(tarjeta.terminadaEn);
    const lista = dia ? porDia.get(dia) : undefined;
    if (!lista) continue;
    vistas.add(tarjeta.codigo);
    lista.push({ codigo: tarjeta.codigo, titulo: tarjeta.titulo });
  }
  return porDia;
}

/** Una fila del día, tal como llega a la pantalla: solo conteos, porcentajes y cambios. */
export type FilaDelDia = {
  fecha: string;
  leads: number | null;
  cotizaciones: number | null;
  ventas: VentasDelDia | null;
  porcentajeLeadACotizacion: number | null;
  porcentajeCotizacionAVenta: number | null;
  cambios: CambioDelDia[];
};

export function armarFilas(
  dias: string[],
  fuentes: {
    leads: Map<string, number | null>;
    cotizaciones: Map<string, number> | null;
    ventas: Map<string, VentasDelDia> | null;
    cambios: Map<string, CambioDelDia[]> | null;
  },
): FilaDelDia[] {
  return dias.map((fecha) => {
    const leads = fuentes.leads.get(fecha) ?? null;
    const cotizaciones = fuentes.cotizaciones ? (fuentes.cotizaciones.get(fecha) ?? 0) : null;
    const ventas = fuentes.ventas ? (fuentes.ventas.get(fecha) ?? { total: 0, nuevos: 0, recurrentes: 0, sinClasificar: 0 }) : null;
    return {
      fecha,
      leads,
      cotizaciones,
      ventas,
      porcentajeLeadACotizacion: porcentaje(cotizaciones, leads),
      porcentajeCotizacionAVenta: porcentaje(ventas ? ventas.total : null, cotizaciones),
      cambios: fuentes.cambios?.get(fecha) ?? [],
    };
  });
}

/** Los tramos [desde, hasta] (inclusive) en que se pide Gestión: un día de más a cada lado, sin solaparse. */
export function tramosDePedido(dias: string[], largo = 8): Array<{ desde: string; hasta: string }> {
  if (!dias.length) return [];
  const inicio = sumarDias(dias[0], -1);
  const fin = sumarDias(dias[dias.length - 1], 1);
  const tramos: Array<{ desde: string; hasta: string }> = [];
  for (let desde = inicio; desde <= fin; desde = sumarDias(desde, largo)) {
    const hasta = sumarDias(desde, largo - 1);
    tramos.push({ desde, hasta: hasta < fin ? hasta : fin });
  }
  return tramos;
}
