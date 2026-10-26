import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { armarEmbudoPorPaso, type EmbudoPorPaso, type LeadPorPaso } from "../dominio/por-paso";
import type { CambioDePaso } from "../dominio/eventos";
import { familiaDelLead, type ClaveDeFamilia } from "../dominio/semanal";
import { embudoActivo } from "./config";
import { bogotaHoy, sumarDiasBogota } from "./leer-comparacion";
import { PATRON_LINEA_MARKETPLACE } from "./leer-embudo-semanal";

/**
 * Lo que lee el reporte "Embudo por paso" (pantalla y MCP). SOLO LEE. Definiciones en
 * dominio/por-paso.ts.
 *
 * UNA consulta por rango de fechas de entrada (índice EmbudoLead[workspaceId, entradaEn]); el
 * filtro de producto se aplica en memoria con la misma regla de familias del embudo semanal.
 */

/** Sin fechas, los últimos 30 días. */
export const DIAS_POR_DEFECTO_POR_PASO = 30;

type FilaPorPaso = {
  id: string;
  canal: string | null;
  entradaEn: Date;
  anuncioTitulo: string | null;
  productoEntrada: string | null;
  productoActual: string | null;
  productoInteres: string | null;
  pasoActual: string | null;
  pasoMaximo: string | null;
  pasoDesde: Date | null;
  pasoHistorial: unknown;
  ultimoClienteEn: Date | null;
  transferencia: string;
  iaPausada: boolean | null;
  asignada: boolean | null;
};

export type LecturaPorPaso = {
  activo: boolean;
  desde: string;
  hasta: string;
  familia: ClaveDeFamilia;
  embudo: EmbudoPorPaso;
};

export async function leerEmbudoPorPaso(
  workspaceId: string,
  pedido: { familia: ClaveDeFamilia; desde?: string | null; hasta?: string | null; ahora?: Date },
): Promise<LecturaPorPaso> {
  const ahora = pedido.ahora ?? new Date();
  const hasta = pedido.hasta || bogotaHoy(ahora);
  const desde = pedido.desde || sumarDiasBogota(hasta, -(DIAS_POR_DEFECTO_POR_PASO - 1));
  const vacio = armarEmbudoPorPaso([], ahora);
  if (!(await embudoActivo(workspaceId))) {
    return { activo: false, desde, hasta, familia: pedido.familia, embudo: vacio };
  }
  const inicio = new Date(`${desde}T00:00:00.000-05:00`);
  const fin = new Date(`${sumarDiasBogota(hasta, 1)}T00:00:00.000-05:00`);
  const filas = await prisma.$queryRaw<FilaPorPaso[]>(Prisma.sql`
    SELECT el."conversationId" AS "id", w."name" AS "canal", el."entradaEn", el."anuncioTitulo",
           el."productoEntrada", el."productoActual", el."productoInteres",
           el."pasoActual", el."pasoMaximo", el."pasoDesde", el."pasoHistorial",
           el."ultimoClienteEn", el."transferencia",
           cv."automationPaused" AS "iaPausada", (cv."assignedToUserId" IS NOT NULL) AS "asignada"
    FROM "EmbudoLead" el
    JOIN "Contact" ct ON ct."id" = el."contactId"
    LEFT JOIN "Conversation" cv ON cv."id" = el."conversationId"
    LEFT JOIN "WhatsAppChannel" w ON w."id" = el."channelId"
    WHERE el."workspaceId" = ${workspaceId}
      AND el."entradaEn" >= ${inicio} AND el."entradaEn" < ${fin}
      AND el."exterior" = false
      AND ct."excludedFromCrm" = false
  `);

  const leads: LeadPorPaso[] = [];
  for (const fila of filas) {
    const familia = familiaDelLead({
      esMarketplace: PATRON_LINEA_MARKETPLACE.test(fila.canal ?? ""),
      productoInteres: fila.productoInteres,
      productoActual: fila.productoActual,
      primerMensaje: fila.productoEntrada,
      anuncioTitulo: fila.anuncioTitulo,
    });
    if (familia !== pedido.familia) continue;
    leads.push({
      conversationId: fila.id,
      pasoActual: fila.pasoActual,
      pasoMaximo: fila.pasoMaximo,
      pasoDesde: fila.pasoDesde,
      entradaEn: fila.entradaEn,
      ultimoClienteEn: fila.ultimoClienteEn,
      historial: Array.isArray(fila.pasoHistorial) ? (fila.pasoHistorial as CambioDePaso[]) : null,
      conAsesora: Boolean(fila.iaPausada) || Boolean(fila.asignada) || fila.transferencia === "ASIGNADA",
    });
  }
  return { activo: true, desde, hasta, familia: pedido.familia, embudo: armarEmbudoPorPaso(leads, ahora) };
}
