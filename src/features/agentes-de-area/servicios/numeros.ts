import { prisma } from "@/lib/prisma";

import {
  inicioDelDiaBogota,
  mediana,
  medirSugerido,
  tiemposDeRespuesta,
  type MensajeMinimo,
  type SugeridoDelAgente,
} from "../dominio/reglas";

/**
 * Los números de un día POR ASESORA para el Agente de Ventas, ya calculados (el agente no tiene que abrir
 * los chats uno por uno: gasta menos del plan de Claude y los números salen exactos). Solo lectura.
 *
 *  - chats_atendidos: chats donde una PERSONA (asesora desde el CRM o el celular) escribió ese día.
 *  - chats_con_cliente: chats donde el cliente escribió ese día.
 *  - llegaron_a_cotizacion_o_cierre: contactos que hoy están en Propuesta, Negociación o Ganado y se movieron ese día.
 *  - ventas: contactos en Ganado con fecha de venta (wonAt) ese día.
 *  - tiempo_respuesta_min: mediana de lo que tardó una persona en contestar (el bot no cuenta).
 *  - cierre_pct: ventas / chats_atendidos.
 */

const TOPE_MENSAJES = 40_000;
const SIN_ASESORA = "sin asesora";

function esHumano(mensaje: { type: string; direction: string; rawPayload: unknown }): boolean {
  if (mensaje.direction !== "OUTBOUND" || mensaje.type === "SYSTEM") return false;
  const payload = mensaje.rawPayload;
  const origen = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>).source : undefined;
  return origen === "manual" || origen === "instance";
}

type Acumulado = { atendidos: Set<string>; conCliente: Set<string>; tiempos: number[]; cotizacion: Set<string>; ventas: Set<string> };
const vacio = (): Acumulado => ({ atendidos: new Set(), conCliente: new Set(), tiempos: [], cotizacion: new Set(), ventas: new Set() });

export async function numerosDeVentas(workspaceId: string, fecha: string) {
  const desde = inicioDelDiaBogota(fecha);
  const hasta = inicioDelDiaBogota(fecha, 1);

  const [mensajes, contactos] = await Promise.all([
    prisma.message.findMany({
      where: { workspaceId, createdAt: { gte: desde, lt: hasta }, isStatusBroadcast: false },
      select: {
        conversationId: true,
        direction: true,
        type: true,
        createdAt: true,
        rawPayload: true,
        conversation: { select: { assignedToUserId: true, contact: { select: { excludedFromCrm: true } } } },
      },
      orderBy: { createdAt: "asc" },
      take: TOPE_MENSAJES,
    }),
    prisma.conversation.findMany({
      where: {
        workspaceId,
        contact: {
          excludedFromCrm: false,
          OR: [
            { crmStage: { in: ["PROPUESTA", "NEGOCIACION"] }, updatedAt: { gte: desde, lt: hasta } },
            { crmStage: "GANADO", wonAt: { gte: desde, lt: hasta } },
          ],
        },
      },
      select: { assignedToUserId: true, contactId: true, contact: { select: { crmStage: true } } },
    }),
  ]);

  const porAsesora = new Map<string, Acumulado>();
  const de = (id: string | null) => {
    const clave = id ?? SIN_ASESORA;
    if (!porAsesora.has(clave)) porAsesora.set(clave, vacio());
    return porAsesora.get(clave)!;
  };

  const porChat = new Map<string, { asesora: string | null; mensajes: MensajeMinimo[] }>();
  for (const m of mensajes) {
    if (m.conversation.contact.excludedFromCrm) continue;
    const chat = porChat.get(m.conversationId) ?? { asesora: m.conversation.assignedToUserId, mensajes: [] };
    chat.mensajes.push({ direction: m.direction, humano: esHumano(m), en: m.createdAt });
    porChat.set(m.conversationId, chat);
  }
  for (const [conversacionId, chat] of porChat) {
    const acumulado = de(chat.asesora);
    if (chat.mensajes.some((m) => m.humano)) acumulado.atendidos.add(conversacionId);
    if (chat.mensajes.some((m) => m.direction === "INBOUND")) acumulado.conCliente.add(conversacionId);
    acumulado.tiempos.push(...tiemposDeRespuesta(chat.mensajes));
  }
  for (const c of contactos) {
    const acumulado = de(c.assignedToUserId);
    acumulado.cotizacion.add(c.contactId);
    if (c.contact.crmStage === "GANADO") acumulado.ventas.add(c.contactId);
  }

  const ids = [...porAsesora.keys()].filter((id) => id !== SIN_ASESORA);
  const usuarios = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })
    : [];
  const nombreDe = (id: string) => {
    const u = usuarios.find((x) => x.id === id);
    return u?.name?.trim() || u?.email || id;
  };

  const asesoras = [...porAsesora.entries()]
    .map(([id, a]) => ({
      asesora_id: id === SIN_ASESORA ? null : id,
      asesora: id === SIN_ASESORA ? SIN_ASESORA : nombreDe(id),
      chats_atendidos: a.atendidos.size,
      chats_con_cliente: a.conCliente.size,
      llegaron_a_cotizacion_o_cierre: a.cotizacion.size,
      ventas: a.ventas.size,
      cierre_pct: a.atendidos.size ? Math.round((a.ventas.size / a.atendidos.size) * 1000) / 10 : null,
      tiempo_respuesta_min: mediana(a.tiempos),
      respuestas_medidas: a.tiempos.length,
    }))
    .sort((a, b) => b.chats_atendidos - a.chats_atendidos);

  const total = {
    chats_atendidos: asesoras.reduce((s, a) => s + a.chats_atendidos, 0),
    chats_con_cliente: asesoras.reduce((s, a) => s + a.chats_con_cliente, 0),
    llegaron_a_cotizacion_o_cierre: asesoras.reduce((s, a) => s + a.llegaron_a_cotizacion_o_cierre, 0),
    ventas: asesoras.reduce((s, a) => s + a.ventas, 0),
  };

  return {
    fecha,
    asesoras,
    total: { ...total, cierre_pct: total.chats_atendidos ? Math.round((total.ventas / total.chats_atendidos) * 1000) / 10 : null },
    ...(mensajes.length >= TOPE_MENSAJES ? { aviso: `Se leyeron solo los primeros ${TOPE_MENSAJES} mensajes del día: los números pueden quedar cortos.` } : {}),
    nota:
      "Atendido = una persona escribió ese día (el bot no cuenta). Los avisos y reasignaciones del Supervisor no vienen aquí: usar ver_supervisor. " +
      "Las ventas, abonos y saldos se leen del MCP de Gestión.",
  };
}

/**
 * Los sugeridos que el agente guardó el día `ayer`: ¿les escribieron?, ¿respondieron?, ¿compraron?
 * Se mide con los mensajes desde que empezó ese día (el agente corre a las 7:00 y los deja ese mismo día).
 */
export async function medirSugeridosDeAyer(workspaceId: string, area: string, ayer: string) {
  const dia = await prisma.agenteDeAreaDia.findUnique({
    where: { workspaceId_area_fecha: { workspaceId, area, fecha: ayer } },
    select: { sugeridos: true },
  });
  const sugeridos = Array.isArray(dia?.sugeridos) ? (dia!.sugeridos as unknown as SugeridoDelAgente[]) : [];
  if (!sugeridos.length) {
    return { fecha_de_los_sugeridos: ayer, hay_sugeridos: false, total: 0, porAsesora: [] as unknown[], detalle: [] as unknown[] };
  }
  const desde = inicioDelDiaBogota(ayer);
  const chats = await prisma.conversation.findMany({
    where: { workspaceId, id: { in: sugeridos.map((s) => s.conversacionId) } },
    select: {
      id: true,
      contact: { select: { crmStage: true, wonAt: true } },
      messages: { where: { createdAt: { gte: desde } }, select: { direction: true, type: true, rawPayload: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 500 },
    },
  });
  const detalle = sugeridos.map((s) => {
    const chat = chats.find((c) => c.id === s.conversacionId);
    const medido = chat
      ? medirSugerido(
          chat.messages.map((m) => ({ direction: m.direction, humano: esHumano(m), en: m.createdAt })),
          chat.contact.crmStage === "GANADO" && !!chat.contact.wonAt && chat.contact.wonAt >= desde,
        )
      : null;
    return { asesora: s.asesora, cliente: s.cliente, telefono: s.telefono, conversacion_id: s.conversacionId, ...(medido ?? { leEscribieron: null, respondio: null, compro: null }), chat_encontrado: !!chat };
  });
  const porAsesora = new Map<string, { asesora: string; sugeridos: number; leEscribieron: number; respondieron: number; compraron: number }>();
  for (const d of detalle) {
    const fila = porAsesora.get(d.asesora) ?? { asesora: d.asesora, sugeridos: 0, leEscribieron: 0, respondieron: 0, compraron: 0 };
    fila.sugeridos += 1;
    if (d.leEscribieron) fila.leEscribieron += 1;
    if (d.respondio) fila.respondieron += 1;
    if (d.compro) fila.compraron += 1;
    porAsesora.set(d.asesora, fila);
  }
  return { fecha_de_los_sugeridos: ayer, hay_sugeridos: true, total: detalle.length, porAsesora: [...porAsesora.values()], detalle };
}
