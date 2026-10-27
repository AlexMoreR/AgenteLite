import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { calcularEmbudoPorPaso, type EmbudoPorPaso, type LeadPorPaso } from "../dominio/por-paso";
import type { CambioDePaso } from "../dominio/eventos";
import { familiaDelLead, type ClaveDeFamilia } from "../dominio/semanal";
import { embudoActivo } from "./config";
import { bogotaHoy, sumarDiasBogota } from "./leer-comparacion";
import { PATRON_LINEA_MARKETPLACE } from "./leer-embudo-semanal";

/**
 * Lo que lee "Embudo por paso" (pantalla y MCP). SOLO LEE. Una consulta por rango de fechas
 * (índice EmbudoLead[workspaceId, entradaEn]); la familia de producto se filtra en memoria con la
 * misma regla del embudo semanal. Las cuentas están en dominio/por-paso.ts.
 */

/** Sin fechas, los últimos 30 días. */
export const DIAS_POR_DEFECTO_POR_PASO = 30;

type FilaPorPaso = {
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
  ventaEn: Date | null;
  crmStage: string | null;
  automationPaused: boolean | null;
  asignada: string | null;
};

export type LecturaPorPaso = {
  activo: boolean;
  desde: string;
  hasta: string;
  familia: ClaveDeFamilia;
  embudo: EmbudoPorPaso | null;
};

export async function leerEmbudoPorPaso(
  workspaceId: string,
  pedido: { familia: ClaveDeFamilia; desde?: string | null; hasta?: string | null },
  ahora: Date = new Date(),
): Promise<LecturaPorPaso> {
  const hasta = pedido.hasta || bogotaHoy(ahora);
  const desde = pedido.desde || sumarDiasBogota(hasta, -(DIAS_POR_DEFECTO_POR_PASO - 1));
  const base = { desde, hasta, familia: pedido.familia };
  if (!(await embudoActivo(workspaceId))) return { ...base, activo: false, embudo: null };

  const inicio = new Date(`${desde}T00:00:00.000-05:00`);
  const fin = new Date(`${sumarDiasBogota(hasta, 1)}T00:00:00.000-05:00`);
  const filas = await prisma.$queryRaw<FilaPorPaso[]>(Prisma.sql`
    SELECT w."name" AS "canal", el."entradaEn", el."anuncioTitulo", el."productoEntrada", el."productoActual",
           el."productoInteres", el."pasoActual", el."pasoMaximo", el."pasoDesde", el."pasoHistorial",
           el."ultimoClienteEn", el."transferencia", el."ventaEn", ct."crmStage"::text AS "crmStage",
           cv."automationPaused", cv."assignedToUserId" AS "asignada"
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
      pasoActual: fila.pasoActual,
      pasoMaximo: fila.pasoMaximo,
      pasoDesde: fila.pasoDesde,
      ultimoClienteEn: fila.ultimoClienteEn,
      entradaEn: fila.entradaEn,
      pasoHistorial: Array.isArray(fila.pasoHistorial) ? (fila.pasoHistorial as CambioDePaso[]) : null,
      conAsesora: Boolean(fila.automationPaused || fila.asignada || fila.transferencia === "ASIGNADA"),
      compro: fila.crmStage === "GANADO" || Boolean(fila.ventaEn),
    });
  }
  return { ...base, activo: true, embudo: calcularEmbudoPorPaso(leads, ahora) };
}
