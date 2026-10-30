/**
 * MAPA DE COLOMBIA DE LA PAUTA (reglas puras, sin base ni red): suma gasto, chats, ventas y valor
 * vendido por departamento; decide el departamento de una venta; y marca en rojo el departamento donde
 * se gasta y no se vende.
 *
 * Este archivo no importa Prisma a propósito: se prueba con `node scripts/check-mapa-colombia.mjs`.
 */

import {
  DEPARTAMENTOS,
  departamentoDeCiudad,
  departamentoDeNombre,
  departamentoDeRegionMeta,
  departamentoDeTelefono,
  esClaveDepartamento,
  type ClaveDepartamento,
} from "./departamentos";

/** Días que se miran para el rojo: gasto sin ventas en este tiempo. */
export const DIAS_ROJO = 60;

export const CLAVE_SIN_UBICAR = "sin-ubicar";
export const CLAVE_OTRAS_REGIONES = "otras-regiones";
export const NOMBRE_SIN_UBICAR = "Sin ubicar";
export const NOMBRE_OTRAS_REGIONES = "Otras regiones";

export type ClaveDelMapa = ClaveDepartamento | typeof CLAVE_SIN_UBICAR | typeof CLAVE_OTRAS_REGIONES;

/**
 * Una fila de datos. Si trae `departamento` (una clave), manda esa. Si no, se mira `regionMeta`: si
 * Meta la nombra pero no es un departamento conocido, va a 'otras-regiones'. Sin ninguna de las dos,
 * va a 'sin-ubicar'. Las cantidades que faltan cuentan 0.
 */
export type FilaDelMapa = {
  departamento?: string | null;
  regionMeta?: string | null;
  gasto?: number | null;
  chats?: number | null;
  ventas?: number | null;
  valorVendido?: number | null;
};

export type SumaDelMapa = {
  clave: ClaveDelMapa;
  nombre: string;
  gasto: number;
  chats: number;
  ventas: number;
  valorVendido: number;
};

export type MapaSumado = {
  /** Los 33 departamentos, en el orden de la lista, aunque estén en 0. */
  departamentos: SumaDelMapa[];
  sinUbicar: SumaDelMapa;
  otrasRegiones: SumaDelMapa;
  /** La suma de todas las filas: igual a departamentos + sin ubicar + otras regiones. */
  total: Omit<SumaDelMapa, "clave" | "nombre">;
};

function numero(valor: number | null | undefined): number {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : 0;
}

/** Redondea a centavos para que las sumas no se descuadren por decimales. */
function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

export function claveDeLaFila(fila: Pick<FilaDelMapa, "departamento" | "regionMeta">): ClaveDelMapa {
  if (esClaveDepartamento(fila.departamento)) return fila.departamento;
  if (fila.regionMeta && fila.regionMeta.trim()) return departamentoDeRegionMeta(fila.regionMeta) ?? CLAVE_OTRAS_REGIONES;
  return CLAVE_SIN_UBICAR;
}

export function sumarPorDepartamento(filas: FilaDelMapa[]): MapaSumado {
  const vacia = (clave: ClaveDelMapa, nombre: string): SumaDelMapa => ({ clave, nombre, gasto: 0, chats: 0, ventas: 0, valorVendido: 0 });
  const sumas = new Map<ClaveDelMapa, SumaDelMapa>(DEPARTAMENTOS.map((d) => [d.clave, vacia(d.clave, d.nombre)]));
  sumas.set(CLAVE_SIN_UBICAR, vacia(CLAVE_SIN_UBICAR, NOMBRE_SIN_UBICAR));
  sumas.set(CLAVE_OTRAS_REGIONES, vacia(CLAVE_OTRAS_REGIONES, NOMBRE_OTRAS_REGIONES));
  const total = { gasto: 0, chats: 0, ventas: 0, valorVendido: 0 };

  for (const fila of filas) {
    const suma = sumas.get(claveDeLaFila(fila))!;
    for (const campo of ["gasto", "chats", "ventas", "valorVendido"] as const) {
      suma[campo] += numero(fila[campo]);
      total[campo] += numero(fila[campo]);
    }
  }
  for (const suma of sumas.values()) {
    suma.gasto = redondear(suma.gasto);
    suma.valorVendido = redondear(suma.valorVendido);
  }
  return {
    departamentos: DEPARTAMENTOS.map((d) => sumas.get(d.clave)!),
    sinUbicar: sumas.get(CLAVE_SIN_UBICAR)!,
    otrasRegiones: sumas.get(CLAVE_OTRAS_REGIONES)!,
    total: { ...total, gasto: redondear(total.gasto), valorVendido: redondear(total.valorVendido) },
  };
}

/**
 * El departamento de una venta: primero lo que dice Gestión (departamento y, si falta, su ciudad),
 * después la ciudad del chat y por último el indicativo del teléfono. null = no se sabe (sin ubicar).
 */
export function departamentoDeVenta(datos: {
  departamentoGestion?: string | null;
  ciudadGestion?: string | null;
  ciudadChat?: string | null;
  telefono?: string | null;
}): ClaveDepartamento | null {
  return (
    departamentoDeNombre(datos.departamentoGestion) ??
    departamentoDeCiudad(datos.ciudadGestion) ??
    departamentoDeCiudad(datos.ciudadChat) ??
    departamentoDeTelefono(datos.telefono)
  );
}

/**
 * Rojo: en los últimos DIAS_ROJO días se gastó (más de 0), no hubo ninguna venta y hay datos
 * suficientes para decirlo. Sin gasto, o con al menos una venta, no es rojo.
 */
export function esRojo(datos: { gasto60d: number | null | undefined; ventas60d: number | null | undefined; datosSuficientes: boolean }): boolean {
  return datos.datosSuficientes && numero(datos.gasto60d) > 0 && numero(datos.ventas60d) === 0;
}

/**
 * Un mes 'AAAA-MM' en hora de Colombia (UTC-5, sin horario de verano): el primer y el último día
 * (AAAA-MM-DD, como los pide Meta) y los instantes [desdeFecha, hastaFecha). null si el mes no es válido.
 */
export function rangoDelMes(mes: string): { desde: string; hasta: string; desdeFecha: Date; hastaFecha: Date } | null {
  const partes = /^(\d{4})-(\d{2})$/.exec(String(mes ?? "").trim());
  if (!partes) return null;
  const anio = Number(partes[1]);
  const numeroMes = Number(partes[2]);
  if (numeroMes < 1 || numeroMes > 12) return null;
  const diasDelMes = new Date(Date.UTC(anio, numeroMes, 0)).getUTCDate();
  const mm = String(numeroMes).padStart(2, "0");
  const siguiente = numeroMes === 12 ? `${anio + 1}-01` : `${anio}-${String(numeroMes + 1).padStart(2, "0")}`;
  return {
    desde: `${anio}-${mm}-01`,
    hasta: `${anio}-${mm}-${String(diasDelMes).padStart(2, "0")}`,
    desdeFecha: new Date(`${anio}-${mm}-01T00:00:00-05:00`),
    hastaFecha: new Date(`${siguiente}-01T00:00:00-05:00`),
  };
}
