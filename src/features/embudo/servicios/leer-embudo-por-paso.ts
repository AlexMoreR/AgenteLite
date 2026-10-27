import { Prisma } from "@prisma/client";

import { CacheConTtl } from "@/lib/cache-en-memoria";
import { prisma } from "@/lib/prisma";

import type { CambioDePaso } from "../dominio/eventos";
import { armarEmbudoPorPaso, type EmbudoPorPaso, type LeadPorPaso } from "../dominio/por-paso";
import { familiaDelLead, type ClaveDeFamilia } from "../dominio/semanal";
import { embudoActivo } from "./config";
import { PATRON_LINEA_MARKETPLACE } from "./leer-embudo-semanal";
import { bogotaHoy, sumarDiasBogota } from "./leer-comparacion";

/**
 * Lo que lee "Embudo por paso" (pantalla y MCP). SOLO LEE. Las cuentas están en dominio/por-paso.ts.
 *
 * UNA consulta por rango de fechas (índice EmbudoLead[workspaceId, entradaEn]); la familia de
 * producto se filtra en memoria. "Se quedó aquí" depende de la hora, por eso el caché es corto
 * (2 minutos) y la cuenta se hace con la hora de cada lectura.
 */

/** Sin fechas, los últimos 30 días. */
export const DIAS_POR_DEFECTO = 30;

const cache = new CacheConTtl<LeadPorPaso[]>({ ttlMs: 2 * 60_000, maxEntradas: 30 });

type FilaPorPaso = {
  id: string;
  canalId: string | null;
  canal: string | null;
  entradaEn: Date;
  anuncioTitulo: string | null;
  productoEntrada: string | null;
  productoActual: string | null;
  productoInteres: string | null;
  pasoActual: string | null;
  pasoMaximo: string | null;
  pasoAnterior: string | null;
  pasoDesde: Date | null;
  pasoHistorial: unknown;
  ultimoClienteEn: Date | null;
  ventaEn: Date | null;
  transferencia: string | null;
  asignadaA: string | null;
  primeraRespuestaAsesoraEn: Date | null;
  crmStage: string | null;
  automationPaused: boolean | null;
  assignedToUserId: string | null;
};

export function leerLeadsPorPaso(workspaceId: string, desde: string, hasta: string): Promise<LeadPorPaso[]> {
  return cache.obtener(`${workspaceId}:${desde}:${hasta}`, () => cargar(workspaceId, desde, hasta));
}

async function cargar(workspaceId: string, desde: string, hasta: string): Promise<LeadPorPaso[]> {
  const inicio = new Date(`${desde}T00:00:00.000-05:00`);
  const fin = new Date(`${sumarDiasBogota(hasta, 1)}T00:00:00.000-05:00`);
  const filas = await prisma.$queryRaw<FilaPorPaso[]>(Prisma.sql`
    SELECT el."conversationId" AS "id", el."channelId" AS "canalId", w."name" AS "canal", el."entradaEn",
           el."anuncioTitulo", el."productoEntrada", el."productoActual", el."productoInteres",
           el."pasoActual", el."pasoMaximo", el."pasoAnterior", el."pasoDesde", el."pasoHistorial",
           el."ultimoClienteEn", el."ventaEn", el."transferencia", el."asignadaA", el."primeraRespuestaAsesoraEn",
           ct."crmStage"::text AS "crmStage", cv."automationPaused", cv."assignedToUserId"
    FROM "EmbudoLead" el
    JOIN "Contact" ct ON ct."id" = el."contactId"
    LEFT JOIN "Conversation" cv ON cv."id" = el."conversationId"
    LEFT JOIN "WhatsAppChannel" w ON w."id" = el."channelId"
    WHERE el."workspaceId" = ${workspaceId}
      AND el."entradaEn" >= ${inicio} AND el."entradaEn" < ${fin}
      AND el."exterior" = false
      AND ct."excludedFromCrm" = false
  `);

  return filas.map((fila): LeadPorPaso => {
    const esMarketplace = PATRON_LINEA_MARKETPLACE.test(fila.canal ?? "");
    return {
      conversationId: fila.id,
      entradaEn: fila.entradaEn,
      familia: familiaDelLead({
        esMarketplace,
        productoInteres: fila.productoInteres,
        productoActual: fila.productoActual,
        primerMensaje: fila.productoEntrada,
        anuncioTitulo: fila.anuncioTitulo,
      }),
      canalId: fila.canalId,
      pasoActual: fila.pasoActual,
      pasoMaximo: fila.pasoMaximo,
      pasoAnterior: fila.pasoAnterior,
      pasoDesde: fila.pasoDesde,
      pasoHistorial: Array.isArray(fila.pasoHistorial) ? (fila.pasoHistorial as CambioDePaso[]) : null,
      ultimoClienteEn: fila.ultimoClienteEn,
      compro: fila.crmStage === "GANADO" || Boolean(fila.ventaEn),
      // Lo tomó una asesora: IA en pausa, chat asignado, escalado/asignado en el embudo o ya le respondió una persona.
      conAsesora: Boolean(
        fila.automationPaused ||
          fila.assignedToUserId ||
          fila.asignadaA ||
          fila.primeraRespuestaAsesoraEn ||
          (fila.transferencia && fila.transferencia !== "NO"),
      ),
    };
  });
}

export type LecturaPorPaso = {
  activo: boolean;
  desde: string;
  hasta: string;
  familia: ClaveDeFamilia;
  embudo: EmbudoPorPaso;
  ahora: Date;
};

/** Lee, filtra por producto y arma el embudo por paso. */
export async function leerEmbudoPorPaso(
  workspaceId: string,
  pedido: { familia: ClaveDeFamilia; desde?: string | null; hasta?: string | null; ahora?: Date },
): Promise<LecturaPorPaso> {
  const ahora = pedido.ahora ?? new Date();
  const hasta = pedido.hasta || bogotaHoy(ahora);
  const desde = pedido.desde || sumarDiasBogota(hasta, -(DIAS_POR_DEFECTO - 1));
  if (!(await embudoActivo(workspaceId))) {
    return { activo: false, desde, hasta, familia: pedido.familia, embudo: armarEmbudoPorPaso([], ahora), ahora };
  }
  const todos = await leerLeadsPorPaso(workspaceId, desde, hasta);
  const deLaFamilia = todos.filter((lead) => lead.familia === pedido.familia);
  return { activo: true, desde, hasta, familia: pedido.familia, embudo: armarEmbudoPorPaso(deLaFamilia, ahora), ahora };
}
