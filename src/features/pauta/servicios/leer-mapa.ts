import { prisma } from "@/lib/prisma";

import { departamentoDeCiudad, departamentoDeTelefono } from "../dominio/departamentos";
import {
  DIAS_ROJO,
  departamentoDeVenta,
  esRojo,
  rangoDelMes,
  sumarPorDepartamento,
  type ClaveDelMapa,
  type FilaDelMapa,
} from "../dominio/mapa";
import { variantesDeTelefono } from "../dominio/reporte";
import { rangoPorDefecto } from "./leer-reporte";
import { leerGastoPorRegion } from "./meta-ads-lectura";
import { limitesDelRango, pedirAGestion, type VentaPagada } from "./ventas-de-gestion";

/**
 * MAPA DE COLOMBIA DE LA PAUTA: SOLO LECTURA. Junta, por departamento y para un mes:
 *   - el gasto de Meta (desglose por región, traducido con departamentoDeRegionMeta);
 *   - los chats de anuncio (OrigenDePauta), ubicados por la ciudad del contacto o, si no hay, por el teléfono;
 *   - las ventas y el valor vendido (VentaDePauta más la lista de Gestión), ubicados por lo que dice Gestión
 *     o, si no viene, por la ciudad del contacto cruzado por teléfono.
 * El rojo se calcula aparte con los últimos DIAS_ROJO días (siempre ese rango, sin importar el mes).
 * Si una fuente falla, sale "no disponible" y el resto sale igual. No escribe nada en la base.
 */

export type EstadoDeFuente = "ok" | "no disponible";

export type DepartamentoDelMapa = {
  clave: ClaveDelMapa;
  nombre: string;
  /** null = la fuente no estuvo disponible (no es lo mismo que 0). */
  gasto: number | null;
  /** Porcentaje del gasto del mes (con un decimal). null si no hay gasto o no estuvo disponible. */
  porcentajeDelGasto: number | null;
  chats: number | null;
  ventas: number | null;
  valorVendido: number | null;
  gasto60d: number | null;
  ventas60d: number | null;
  rojo: boolean;
};

export type MapaDelMes = {
  mes: string;
  desde: string;
  hasta: string;
  /** Los 33 departamentos, en el orden de la lista. */
  departamentos: DepartamentoDelMapa[];
  sinUbicar: DepartamentoDelMapa;
  otrasRegiones: DepartamentoDelMapa;
  totales: { gasto: number | null; chats: number | null; ventas: number | null; valorVendido: number | null };
  rojo: { desde: string; hasta: string; dias: number; datosSuficientes: boolean };
  /** Un aviso si quedaron muchas ventas sin ubicar; null si no. */
  aviso: string | null;
  fuentes: { gasto: EstadoDeFuente; chats: EstadoDeFuente; ventas: EstadoDeFuente; gasto60d: EstadoDeFuente; ventas60d: EstadoDeFuente };
};

/** Desde este porcentaje de ventas sin ubicar se avisa que el reparto está incompleto. */
export const PORCIENTO_AVISO_SIN_UBICAR = 30;

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const redondear1 = (valor: number) => Math.round(valor * 10) / 10;

function diasAntes(fecha: string, dias: number): string {
  const base = new Date(`${fecha}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() - dias);
  return base.toISOString().slice(0, 10);
}

function ciudadDeMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const ciudad = (metadata as Record<string, unknown>).city;
  return typeof ciudad === "string" && ciudad.trim() ? ciudad.trim() : null;
}

/** Reglas puras: arma el mapa con las filas de cada fuente (null = esa fuente no estuvo disponible). */
export function armarMapa(datos: {
  mes: string;
  desde: string;
  hasta: string;
  rojoDesde: string;
  rojoHasta: string;
  gasto: FilaDelMapa[] | null;
  chats: FilaDelMapa[] | null;
  ventas: FilaDelMapa[] | null;
  gasto60d: FilaDelMapa[] | null;
  ventas60d: FilaDelMapa[] | null;
}): MapaDelMes {
  const delMes = sumarPorDepartamento([...(datos.gasto ?? []), ...(datos.chats ?? []), ...(datos.ventas ?? [])]);
  const de60 = sumarPorDepartamento([...(datos.gasto60d ?? []), ...(datos.ventas60d ?? [])]);
  const datosSuficientes = datos.gasto60d !== null && datos.ventas60d !== null;
  const totalGasto = delMes.total.gasto;
  const porClave60 = new Map([...de60.departamentos, de60.sinUbicar, de60.otrasRegiones].map((x) => [x.clave, x]));

  const fila = (suma: (typeof delMes.departamentos)[number]): DepartamentoDelMapa => {
    const s60 = porClave60.get(suma.clave)!;
    const gasto60d = datos.gasto60d ? s60.gasto : null;
    const ventas60d = datos.ventas60d ? s60.ventas : null;
    return {
      clave: suma.clave,
      nombre: suma.nombre,
      gasto: datos.gasto ? suma.gasto : null,
      porcentajeDelGasto: datos.gasto && totalGasto > 0 ? redondear1((suma.gasto / totalGasto) * 100) : null,
      chats: datos.chats ? suma.chats : null,
      ventas: datos.ventas ? suma.ventas : null,
      valorVendido: datos.ventas ? suma.valorVendido : null,
      gasto60d,
      ventas60d,
      // Solo los departamentos de verdad pueden quedar en rojo.
      rojo: suma.clave !== delMes.sinUbicar.clave && suma.clave !== delMes.otrasRegiones.clave && esRojo({ gasto60d, ventas60d, datosSuficientes }),
    };
  };

  const sinUbicar = fila(delMes.sinUbicar);
  const totalVentas = datos.ventas ? delMes.total.ventas : null;
  let aviso: string | null = null;
  if (totalVentas && sinUbicar.ventas) {
    const porciento = redondear1((sinUbicar.ventas / totalVentas) * 100);
    if (porciento >= PORCIENTO_AVISO_SIN_UBICAR) {
      aviso = `${sinUbicar.ventas} de ${totalVentas} ventas (${porciento} %) quedaron sin ubicar: Gestión no mandó el departamento y el chat no tiene ciudad. El reparto por departamento está incompleto.`;
    }
  }

  const estado = (filas: FilaDelMapa[] | null): EstadoDeFuente => (filas ? "ok" : "no disponible");
  return {
    mes: datos.mes,
    desde: datos.desde,
    hasta: datos.hasta,
    departamentos: delMes.departamentos.map(fila),
    sinUbicar,
    otrasRegiones: fila(delMes.otrasRegiones),
    totales: {
      gasto: datos.gasto ? delMes.total.gasto : null,
      chats: datos.chats ? delMes.total.chats : null,
      ventas: totalVentas,
      valorVendido: datos.ventas ? delMes.total.valorVendido : null,
    },
    rojo: { desde: datos.rojoDesde, hasta: datos.rojoHasta, dias: DIAS_ROJO, datosSuficientes },
    aviso,
    fuentes: {
      gasto: estado(datos.gasto),
      chats: estado(datos.chats),
      ventas: estado(datos.ventas),
      gasto60d: estado(datos.gasto60d),
      ventas60d: estado(datos.ventas60d),
    },
  };
}

/** Una frase para decir en voz alta: ¿de dónde vienen las ventas? */
export function resumenParaDecir(mapa: MapaDelMes): string {
  const [anio, numeroMes] = mapa.mes.split("-");
  const nombreMes = `${MESES[Number(numeroMes) - 1] ?? numeroMes} de ${anio}`;
  const partes: string[] = [];

  if (mapa.totales.ventas === null) {
    partes.push(`En ${nombreMes} no se pudieron leer las ventas.`);
  } else if (mapa.totales.ventas === 0) {
    partes.push(`En ${nombreMes} todavía no hay ventas registradas.`);
  } else {
    const top = mapa.departamentos
      .filter((d) => (d.ventas ?? 0) > 0)
      .sort((a, b) => (b.ventas ?? 0) - (a.ventas ?? 0) || (b.valorVendido ?? 0) - (a.valorVendido ?? 0))
      .slice(0, 3)
      .map((d) => `${d.nombre} (${d.ventas})`);
    const sinUbicar = mapa.sinUbicar.ventas ? ` ${mapa.sinUbicar.ventas} sin ubicar.` : "";
    partes.push(
      top.length
        ? `En ${nombreMes} hubo ${mapa.totales.ventas} ventas; vienen sobre todo de ${top.length > 1 ? `${top.slice(0, -1).join(", ")} y ${top[top.length - 1]}` : top[0]}.${sinUbicar}`
        : `En ${nombreMes} hubo ${mapa.totales.ventas} ventas, pero ninguna se pudo ubicar en un departamento.`,
    );
  }

  const valle = mapa.departamentos.find((d) => d.clave === "valle-del-cauca");
  if (valle?.porcentajeDelGasto !== null && valle?.porcentajeDelGasto !== undefined) {
    partes.push(`Valle del Cauca se lleva el ${valle.porcentajeDelGasto} % del gasto de Meta.`);
  } else if (mapa.fuentes.gasto === "no disponible") {
    partes.push("El gasto de Meta no está disponible.");
  }

  const enRojo = mapa.departamentos.filter((d) => d.rojo).map((d) => d.nombre);
  if (enRojo.length) partes.push(`En rojo (gastan y no venden en ${mapa.rojo.dias} días): ${enRojo.join(", ")}.`);
  return partes.join(" ");
}

/* ------------------------------------------------------------------ lectura (base, Meta y Gestión) */

async function gastoPorDepartamento(desde: string, hasta: string): Promise<FilaDelMapa[] | null> {
  if (desde > hasta) return [];
  const gasto = await leerGastoPorRegion(desde, hasta);
  return gasto.estado === "ok" ? gasto.filas.map((f) => ({ regionMeta: f.region, gasto: f.gasto })) : null;
}

async function chatsPorDepartamento(workspaceId: string, desdeFecha: Date, hastaFecha: Date): Promise<FilaDelMapa[] | null> {
  try {
    const origenes = await prisma.origenDePauta.findMany({
      where: { workspaceId, llegoEn: { gte: desdeFecha, lt: hastaFecha } },
      select: { contactId: true },
    });
    const ids = [...new Set(origenes.map((o) => o.contactId))];
    const contactos = ids.length
      ? await prisma.contact.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, phoneNumber: true, metadata: true } })
      : [];
    const porId = new Map(contactos.map((c) => [c.id, c]));
    return origenes.map((o) => {
      const contacto = porId.get(o.contactId);
      return { departamento: departamentoDeCiudad(ciudadDeMetadata(contacto?.metadata)) ?? departamentoDeTelefono(contacto?.phoneNumber), chats: 1 };
    });
  } catch (error) {
    console.warn("[mapa] no se pudieron leer los chats de anuncio", error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function ventasPorDepartamento(workspaceId: string, desde: string, hasta: string): Promise<FilaDelMapa[] | null> {
  const { desdeFecha, hastaFecha } = limitesDelRango(desde, hasta);
  const [deLaBase, deGestion] = await Promise.all([
    prisma.ventaDePauta
      .findMany({
        where: { workspaceId, pagadaEn: { gte: desdeFecha, lt: hastaFecha } },
        select: { ventaGestionId: true, telefono: true, monto: true, contactId: true },
      })
      .catch((error: unknown) => {
        console.warn("[mapa] no se pudieron leer las ventas de pauta", error instanceof Error ? error.message : String(error));
        return null;
      }),
    pedirAGestion(workspaceId, desde, hasta).catch(() => null as VentaPagada[] | null),
  ]);
  if (!deLaBase && !deGestion) return null;

  // Una venta por número de Gestión: lo guardado en la base, completado con lo que manda Gestión.
  const gestionPorId = new Map((deGestion ?? []).map((v) => [v.id, v]));
  const ventas = new Map<string, { telefono: string | null; monto: number | null; contactId: string | null; gestion: VentaPagada | null }>();
  for (const v of deLaBase ?? []) {
    const gestion = gestionPorId.get(v.ventaGestionId) ?? null;
    ventas.set(v.ventaGestionId, { telefono: v.telefono ?? gestion?.telefono ?? null, monto: v.monto ?? gestion?.monto ?? null, contactId: v.contactId, gestion });
  }
  for (const v of deGestion ?? []) {
    if (!ventas.has(v.id)) ventas.set(v.id, { telefono: v.telefono, monto: v.monto, contactId: null, gestion: v });
  }

  // La ciudad del contacto, por su id o cruzando el teléfono (con y sin 57). Si falla, se sigue sin ella.
  const lista = [...ventas.values()];
  const ids = [...new Set(lista.map((v) => v.contactId).filter((id): id is string => Boolean(id)))];
  const telefonos = [...new Set(lista.flatMap((v) => variantesDeTelefono(v.telefono)))];
  let contactos: Array<{ id: string; phoneNumber: string; metadata: unknown }> = [];
  if (ids.length || telefonos.length) {
    try {
      contactos = await prisma.contact.findMany({
        where: { workspaceId, OR: [{ id: { in: ids } }, { phoneNumber: { in: telefonos } }] },
        select: { id: true, phoneNumber: true, metadata: true },
      });
    } catch (error) {
      console.warn("[mapa] no se pudo leer la ciudad de los contactos", error instanceof Error ? error.message : String(error));
    }
  }
  const ciudadPorId = new Map(contactos.map((c) => [c.id, ciudadDeMetadata(c.metadata)]));
  const ciudadPorTelefono = new Map<string, string>();
  for (const c of contactos) {
    const ciudad = ciudadDeMetadata(c.metadata);
    if (ciudad && !ciudadPorTelefono.has(c.phoneNumber)) ciudadPorTelefono.set(c.phoneNumber, ciudad);
  }

  return lista.map((v) => {
    const ciudadChat =
      (v.contactId ? ciudadPorId.get(v.contactId) : null) ??
      variantesDeTelefono(v.telefono).map((t) => ciudadPorTelefono.get(t)).find(Boolean) ??
      null;
    const departamento = departamentoDeVenta({
      departamentoGestion: v.gestion?.departamento,
      ciudadGestion: v.gestion?.ciudad,
      ciudadChat,
      telefono: v.telefono,
    });
    return { departamento, ventas: 1, valorVendido: v.monto };
  });
}

/** El mapa de un mes 'AAAA-MM' (por defecto el mes en curso, hora de Colombia). Lanza solo si el mes no es válido. */
export async function leerMapa(workspaceId: string, pedido: { mes?: string | null } = {}): Promise<MapaDelMes> {
  const hoy = rangoPorDefecto().hasta;
  const mes = pedido.mes?.trim() || hoy.slice(0, 7);
  const rango = rangoDelMes(mes);
  if (!rango) throw new Error('"mes" tiene que ser AAAA-MM (por ejemplo 2026-10).');
  if (rango.desde > hoy) throw new Error(`"mes" ${mes} todavía no empieza.`);
  // El mes en curso se lee hasta hoy (Meta no da días que no han pasado).
  const hasta = rango.hasta < hoy ? rango.hasta : hoy;
  const rojoDesde = diasAntes(hoy, DIAS_ROJO - 1);

  const [gasto, chats, ventas, gasto60d, ventas60d] = await Promise.all([
    gastoPorDepartamento(rango.desde, hasta),
    chatsPorDepartamento(workspaceId, rango.desdeFecha, rango.hastaFecha),
    ventasPorDepartamento(workspaceId, rango.desde, hasta),
    gastoPorDepartamento(rojoDesde, hoy),
    ventasPorDepartamento(workspaceId, rojoDesde, hoy),
  ]);
  return armarMapa({ mes, desde: rango.desde, hasta, rojoDesde, rojoHasta: hoy, gasto, chats, ventas, gasto60d, ventas60d });
}
