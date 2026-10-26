import { Prisma } from "@prisma/client";

import { CacheConTtl } from "@/lib/cache-en-memoria";
import { prisma } from "@/lib/prisma";

import {
  compararVersiones,
  filtrarLeads,
  versionesDisponibles,
  type ClaveDeOrigen,
  type Comparacion,
  type FiltrosDeComparacion,
  type LeadParaComparar,
} from "../dominio/comparar";
import { familiaDelLead } from "../dominio/semanal";
import { embudoActivo } from "./config";
import { PATRON_LINEA_MARKETPLACE } from "./leer-embudo-semanal";

/**
 * Lo que lee "Comparar embudos" (pantalla y MCP). SOLO LEE. Ver las definiciones en
 * dominio/comparar.ts.
 *
 * UNA consulta por rango de fechas (índice EmbudoLead[workspaceId, entradaEn]): trae los leads con
 * lo justo para los cinco pasos. Los filtros de línea, origen, producto y versión se aplican en
 * memoria, así que cambiarlos no vuelve a la base. Se guarda 10 minutos, como el embudo semanal.
 */

/** Sin fechas, los últimos 60 días. */
export const DIAS_POR_DEFECTO = 60;

const cache = new CacheConTtl<LeadParaComparar[]>({ ttlMs: 10 * 60_000, maxEntradas: 30 });

type FilaComparar = {
  id: string;
  canalId: string | null;
  canal: string | null;
  entradaEn: Date;
  anuncioId: string | null;
  anuncioTitulo: string | null;
  productoEntrada: string | null;
  productoActual: string | null;
  productoInteres: string | null;
  libroVersionEntrada: number | null;
  temperatura: string | null;
  cotizacionEn: Date | null;
  cotizacionRef: string | null;
  anticipoEn: Date | null;
  ventaEn: Date | null;
  crmStage: string | null;
  wonAt: Date | null;
  respondio: boolean | null;
  dioCiudad: boolean | null;
};

export function bogotaHoy(ahora = new Date()): string {
  return new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

export function sumarDiasBogota(dia: string, dias: number): string {
  const fecha = new Date(`${dia}T12:00:00.000Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

export function leerLeadsParaComparar(workspaceId: string, desde: string, hasta: string): Promise<LeadParaComparar[]> {
  return cache.obtener(`${workspaceId}:${desde}:${hasta}`, () => cargar(workspaceId, desde, hasta));
}

async function cargar(workspaceId: string, desde: string, hasta: string): Promise<LeadParaComparar[]> {
  const inicio = new Date(`${desde}T00:00:00.000-05:00`);
  const fin = new Date(`${sumarDiasBogota(hasta, 1)}T00:00:00.000-05:00`);
  const filas = await prisma.$queryRaw<FilaComparar[]>(Prisma.sql`
    SELECT el."conversationId" AS "id", el."channelId" AS "canalId", w."name" AS "canal", el."entradaEn",
           el."anuncioId", el."anuncioTitulo", el."productoEntrada", el."productoActual", el."productoInteres",
           el."libroVersionEntrada", el."temperatura", el."cotizacionEn", el."cotizacionRef", el."anticipoEn", el."ventaEn",
           ct."crmStage"::text AS "crmStage", ct."wonAt",
           EXISTS (
             SELECT 1 FROM "EmbudoEvento" e
             WHERE e."conversationId" = el."conversationId" AND e."tipo" = 'CLIENTE_RESPONDIO'
           ) AS "respondio",
           COALESCE(el."senales" @> '[{"tipo":"envio_ciudad"}]'::jsonb, false) AS "dioCiudad"
    FROM "EmbudoLead" el
    JOIN "Contact" ct ON ct."id" = el."contactId"
    LEFT JOIN "WhatsAppChannel" w ON w."id" = el."channelId"
    WHERE el."workspaceId" = ${workspaceId}
      AND el."entradaEn" >= ${inicio} AND el."entradaEn" < ${fin}
      AND el."exterior" = false
      AND ct."excludedFromCrm" = false
  `);

  return filas.map((fila): LeadParaComparar => {
    const esMarketplace = PATRON_LINEA_MARKETPLACE.test(fila.canal ?? "");
    const origen: ClaveDeOrigen = esMarketplace ? "marketplace" : fila.anuncioId || fila.anuncioTitulo ? "anuncio" : "directo";
    const compro = fila.crmStage === "GANADO" || Boolean(fila.ventaEn);
    return {
      conversationId: fila.id,
      entradaEn: fila.entradaEn,
      libroVersion: fila.libroVersionEntrada,
      familia: familiaDelLead({
        esMarketplace,
        productoInteres: fila.productoInteres,
        productoActual: fila.productoActual,
        primerMensaje: fila.productoEntrada,
        anuncioTitulo: fila.anuncioTitulo,
      }),
      canalId: fila.canalId,
      origen,
      respondio: Boolean(fila.respondio),
      dioCiudad: Boolean(fila.dioCiudad),
      caliente: fila.temperatura === "CALIENTE" || Boolean(fila.cotizacionEn || fila.cotizacionRef || fila.anticipoEn),
      compro,
      ventaEn: compro ? (fila.wonAt ?? fila.ventaEn) : null,
      // El CRM no guarda el monto (vive en Gestión): sale "no disponible".
      monto: null,
    };
  });
}

export type LineaParaFiltro = { id: string; nombre: string };

/** Las líneas de ventas del negocio, para el filtro. */
export async function leerLineasDeVentas(workspaceId: string): Promise<LineaParaFiltro[]> {
  const canales = await prisma.whatsAppChannel.findMany({
    where: { workspaceId, purpose: "SALES" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return canales.map((canal) => ({ id: canal.id, nombre: canal.name }));
}

export type PedidoDeComparacion = FiltrosDeComparacion & {
  /** null = los chats sin versión. undefined = elegir sola. */
  versionA?: number | null;
  versionB?: number | null;
};

export type LecturaDeComparacion = {
  activo: boolean;
  desde: string;
  hasta: string;
  /** Las versiones con chats, ya con los filtros (menos el de versión). */
  versiones: Array<{ version: number; chats: number }>;
  sinVersion: number;
  comparacion: Comparacion | null;
};

/**
 * Lee, filtra y compara. Sin versiones pedidas elige las dos con más chats (la de MENOS número
 * va a la izquierda: la vieja contra la nueva).
 */
export async function leerComparacion(workspaceId: string, pedido: PedidoDeComparacion): Promise<LecturaDeComparacion> {
  const hoy = bogotaHoy();
  const hasta = pedido.hasta || hoy;
  const desde = pedido.desde || sumarDiasBogota(hasta, -(DIAS_POR_DEFECTO - 1));
  if (!(await embudoActivo(workspaceId))) {
    return { activo: false, desde, hasta, versiones: [], sinVersion: 0, comparacion: null };
  }
  const todos = await leerLeadsParaComparar(workspaceId, desde, hasta);
  const filtrados = filtrarLeads(todos, { ...pedido, desde, hasta });
  const versiones = versionesDisponibles(filtrados);
  const sinVersion = filtrados.filter((lead) => lead.libroVersion === null).length;

  let versionA = pedido.versionA;
  let versionB = pedido.versionB;
  if (versionA === undefined && versionB === undefined) {
    const dos = versiones.slice(0, 2).map((item) => item.version).sort((x, y) => x - y);
    if (dos.length === 2) [versionA, versionB] = dos;
  }
  const comparacion =
    versionA !== undefined && versionB !== undefined ? compararVersiones(filtrados, versionA, versionB) : null;
  return { activo: true, desde, hasta, versiones, sinVersion, comparacion };
}
