import { Prisma } from "@prisma/client";

import { getCallResultLabel } from "@/features/crm/domain/crm-config";
import type { CrmStage } from "@/features/crm/types";
import { prisma } from "@/lib/prisma";
import { ETAPAS_VIVAS, diaDeHoyBogota, inicioDeLaFecha } from "./getMiTableroData";

/*
  Quienes son los numeros del tablero de una asesora (pedido de Alex, 15-sep-2026: "al dar click a
  cada opcion podamos ver cuales fueron los contactos").

  Cada lista usa EXACTAMENTE el mismo filtro con que getMiTableroData cuenta su tarjeta: si la
  tarjeta dice 6 movidos, la lista trae esos 6. Un filtro distinto aca haria que el numero y la lista
  no coincidan, y eso se lee como que la app miente.
*/

export type TipoDeDetalle = "leads" | "movidos" | "llamadas" | "ventas" | "enfriandose" | `etapa:${CrmStage}`;

export type FilaDeDetalle = {
  conversationId: string | null;
  nombre: string;
  telefono: string;
  etapa: CrmStage;
  /** ISO: ultimo mensaje del chat, o la hora de la llamada / la venta segun la lista. */
  cuando: string | null;
  /** Lo que agrega cada lista: el resultado de la llamada, "hace 12 dias", etc. */
  nota: string | null;
};

const POR_PAGINA = 50;

export async function getDetalleDelTablero(input: {
  workspaceId: string;
  userId: string;
  tipo: TipoDeDetalle;
  desde?: string | null;
  hasta?: string | null;
  pagina?: number;
}): Promise<{ filas: FilaDeDetalle[]; hayMas: boolean }> {
  const now = new Date();
  const esFecha = (valor?: string | null) => Boolean(valor?.match(/^\d{4}-\d{2}-\d{2}$/));
  let desde = esFecha(input.desde) ? input.desde! : diaDeHoyBogota(now);
  let hasta = esFecha(input.hasta) ? input.hasta! : desde;
  if (desde > hasta) {
    [desde, hasta] = [hasta, desde];
  }
  const inicioRango = inicioDeLaFecha(desde, now);
  const finRango = new Date(inicioDeLaFecha(hasta, now).getTime() + 24 * 60 * 60 * 1000);
  const hace5Dias = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  const saltar = Math.max(0, input.pagina ?? 0) * POR_PAGINA;
  const mias = { workspaceId: input.workspaceId, assignedToUserId: input.userId };

  // Las llamadas son intentos, no chats: una por fila, con su resultado.
  if (input.tipo === "llamadas") {
    const intentos = await prisma.callAttempt.findMany({
      where: { workspaceId: input.workspaceId, calledByUserId: input.userId, calledAt: { gte: inicioRango, lt: finRango } },
      orderBy: { calledAt: "desc" },
      skip: saltar,
      take: POR_PAGINA + 1,
      select: {
        calledAt: true,
        result: true,
        summary: true,
        contact: {
          select: {
            name: true,
            phoneNumber: true,
            crmStage: true,
            conversations: {
              where: { workspaceId: input.workspaceId },
              orderBy: { lastMessageAt: "desc" },
              take: 1,
              select: { id: true },
            },
          },
        },
      },
    });
    return {
      hayMas: intentos.length > POR_PAGINA,
      filas: intentos.slice(0, POR_PAGINA).map((intento) => ({
        conversationId: intento.contact.conversations[0]?.id ?? null,
        nombre: intento.contact.name?.trim() || intento.contact.phoneNumber,
        telefono: intento.contact.phoneNumber,
        etapa: intento.contact.crmStage,
        cuando: intento.calledAt.toISOString(),
        nota: [getCallResultLabel(intento.result), intento.summary?.trim()].filter(Boolean).join(" · ") || null,
      })),
    };
  }

  let where: Prisma.ConversationWhereInput;
  let orden: Prisma.ConversationOrderByWithRelationInput = { lastMessageAt: { sort: "desc", nulls: "last" } };

  if (input.tipo === "leads") {
    where = { ...mias, contact: { excludedFromCrm: false } };
  } else if (input.tipo === "movidos") {
    where = { ...mias, lastMessageAt: { gte: inicioRango, lt: finRango }, contact: { excludedFromCrm: false } };
  } else if (input.tipo === "ventas") {
    where = { ...mias, contact: { crmStage: "GANADO", wonAt: { gte: inicioRango, lt: finRango } } };
    orden = { contact: { wonAt: "desc" } };
  } else if (input.tipo === "enfriandose") {
    where = { ...mias, lastMessageAt: { lt: hace5Dias }, contact: { excludedFromCrm: false, crmStage: { in: ETAPAS_VIVAS } } };
    // Los mas frios primero: son los que mas urge retomar.
    orden = { lastMessageAt: { sort: "asc", nulls: "first" } };
  } else if (input.tipo.startsWith("etapa:")) {
    const etapa = input.tipo.slice("etapa:".length) as CrmStage;
    where = { ...mias, contact: { excludedFromCrm: false, crmStage: etapa } };
  } else {
    return { filas: [], hayMas: false };
  }

  const conversaciones = await prisma.conversation.findMany({
    where,
    orderBy: orden,
    skip: saltar,
    take: POR_PAGINA + 1,
    select: {
      id: true,
      lastMessageAt: true,
      contact: { select: { name: true, phoneNumber: true, crmStage: true, wonAt: true } },
    },
  });

  return {
    hayMas: conversaciones.length > POR_PAGINA,
    filas: conversaciones.slice(0, POR_PAGINA).map((fila) => {
      const cuando = input.tipo === "ventas" ? fila.contact.wonAt : fila.lastMessageAt;
      const dias = fila.lastMessageAt ? Math.floor((now.getTime() - fila.lastMessageAt.getTime()) / 86_400_000) : null;
      return {
        conversationId: fila.id,
        nombre: fila.contact.name?.trim() || fila.contact.phoneNumber,
        telefono: fila.contact.phoneNumber,
        etapa: fila.contact.crmStage,
        cuando: cuando ? cuando.toISOString() : null,
        nota: input.tipo === "enfriandose" && dias !== null ? `${dias} días sin movimiento` : null,
      };
    }),
  };
}
