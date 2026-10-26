import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { armarEmbudoPorPaso, type CambioDePaso, type EmbudoPorPaso, type LeadPorPaso } from "../dominio/por-paso";
import { familiaDelLead, type ClaveDeFamilia } from "../dominio/semanal";
import { embudoActivo } from "./config";
import { PATRON_LINEA_MARKETPLACE } from "./leer-embudo-semanal";
import { bogotaHoy, sumarDiasBogota } from "./leer-comparacion";

/**
 * Lo que lee el "Embudo por paso" (pantalla y MCP). SOLO LEE. Definiciones en dominio/por-paso.ts.
 *
 * UNA consulta por rango de fechas (índice EmbudoLead[workspaceId, entradaEn]): trae los leads del
 * negocio con su paso actual, el más alto, el último mensaje del cliente y si una asesora tomó el
 * chat. La familia de producto se decide con la misma regla del embudo semanal. No se guarda en
 * memoria: "se quedó aquí" depende de la hora de ahora.
 */

/** Sin fechas, los últimos 30 días. */
export const DIAS_POR_DEFECTO_POR_PASO = 30;

type FilaPorPaso = {
  id: string;
  canal: string | null;
  anuncioTitulo: string | null;
  productoEntrada: string | null;
  productoActual: string | null;
  productoInteres: string | null;
  pasoActual: string | null;
  pasoMaximo: string | null;
  pasoHistorial: unknown;
  ultimoClienteEn: Date | null;
  crmStage: string | null;
  ventaEn: Date | null;
  automationPaused: boolean | null;
  asignadaA: string | null;
  asignadaChat: string | null;
};

export type LecturaPorPaso = {
  activo: boolean;
  desde: string;
  hasta: string;
  familia: ClaveDeFamilia;
  /** Clientes del producto y rango (los dos grupos juntos). */
  clientes: number;
  embudo: EmbudoPorPaso | null;
};

function historialDe(valor: unknown): CambioDePaso[] | null {
  return Array.isArray(valor) ? (valor as CambioDePaso[]) : null;
}

export async function leerEmbudoPorPaso(
  workspaceId: string,
  pedido: { familia: ClaveDeFamilia; desde?: string | null; hasta?: string | null; ahora?: Date },
): Promise<LecturaPorPaso> {
  const ahora = pedido.ahora ?? new Date();
  const hasta = pedido.hasta || bogotaHoy(ahora);
  const desde = pedido.desde || sumarDiasBogota(hasta, -(DIAS_POR_DEFECTO_POR_PASO - 1));
  const base = { desde, hasta, familia: pedido.familia };
  // Con el registro apagado no hay datos nuevos: se avisa en vez de mostrar ceros.
  if (!(await embudoActivo(workspaceId))) return { ...base, activo: false, clientes: 0, embudo: null };

  const inicio = new Date(`${desde}T00:00:00.000-05:00`);
  const fin = new Date(`${sumarDiasBogota(hasta, 1)}T00:00:00.000-05:00`);
  const filas = await prisma.$queryRaw<FilaPorPaso[]>(Prisma.sql`
    SELECT el."conversationId" AS "id", w."name" AS "canal", el."anuncioTitulo", el."productoEntrada",
           el."productoActual", el."productoInteres", el."pasoActual", el."pasoMaximo", el."pasoHistorial",
           el."ultimoClienteEn", el."ventaEn", el."asignadaA",
           ct."crmStage"::text AS "crmStage", c."automationPaused", c."assignedToUserId" AS "asignadaChat"
    FROM "EmbudoLead" el
    JOIN "Contact" ct ON ct."id" = el."contactId"
    JOIN "Conversation" c ON c."id" = el."conversationId"
    LEFT JOIN "WhatsAppChannel" w ON w."id" = el."channelId"
    WHERE el."workspaceId" = ${workspaceId}
      AND el."entradaEn" >= ${inicio} AND el."entradaEn" < ${fin}
      AND el."exterior" = false
      AND ct."excludedFromCrm" = false
  `);

  const leads: LeadPorPaso[] = [];
  for (const fila of filas) {
    const esMarketplace = PATRON_LINEA_MARKETPLACE.test(fila.canal ?? "");
    const familia = familiaDelLead({
      esMarketplace,
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
      ultimoClienteEn: fila.ultimoClienteEn,
      compro: fila.crmStage === "GANADO" || Boolean(fila.ventaEn),
      tomadaPorAsesora: Boolean(fila.automationPaused) || Boolean(fila.asignadaA) || Boolean(fila.asignadaChat),
      pasoHistorial: historialDe(fila.pasoHistorial),
    });
  }
  return { ...base, activo: true, clientes: leads.length, embudo: armarEmbudoPorPaso(leads, ahora) };
}
