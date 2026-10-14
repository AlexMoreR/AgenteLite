import { prisma } from "@/lib/prisma";

import type { ConversacionDelLead, DatosDelLead, NotaDelChat } from "../dominio/mapa";

/**
 * Lectura del MAPA DEL LEAD: todo acotado por UN contacto y con tope en cada consulta.
 *
 * Costo esperado (todas por índice, ninguna recorre el negocio):
 *  - Contact por id (PK).
 *  - Conversation por contactId (índice [contactId, lastMessageAt]), hasta 10.
 *  - Por chat, el último entrante (índice Message[workspaceId, conversationId, direction, createdAt]).
 *  - EmbudoLead por conversationId (PK), los mismos ≤ 10.
 *  - Follow por [workspaceId, contactId, …] (índice), hasta 150 de los últimos 30 días + pendientes.
 *  - Mensajes SYSTEM de etapa / automatización y recordatorios V3 de esos chats (índice
 *    Message[conversationId, createdAt] y filtro por rawPayload sobre ese rango), con LIMIT.
 *  - CallAttempt por [workspaceId, contactId, calledAt], hasta 30.
 *  - Chats del canal oficial enlazados por crmContactId, hasta 5.
 * Unas 8 a 12 consultas pequeñas, en paralelo donde se puede. No se guarda nada.
 */

const MAX_CHATS = 10;
const MAX_SEGUIMIENTOS = 150;
const MAX_NOTAS = 80;
const MAX_RECORDATORIOS = 60;
const MAX_LLAMADAS = 30;
const DIAS = 30;

export type ResultadoDeLectura = { datos: DatosDelLead } | { error: string };

/** "agent:<id>" / "official:<id>" → ficha del CRM del cliente. */
export async function contactoDelChat(workspaceId: string, chatKey: string): Promise<string | null> {
  if (chatKey.startsWith("agent:")) {
    const c = await prisma.conversation.findFirst({
      where: { id: chatKey.slice("agent:".length), workspaceId },
      select: { contactId: true },
    });
    return c?.contactId ?? null;
  }
  if (chatKey.startsWith("official:")) {
    const c = await prisma.officialApiConversation.findFirst({
      where: { id: chatKey.slice("official:".length), config: { workspaceId } },
      select: { contact: { select: { crmContactId: true } } },
    });
    return c?.contact.crmContactId ?? null;
  }
  return null;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function textoDelJson(valor: unknown, clave: string): string | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const v = (valor as Record<string, unknown>)[clave];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function primerNombre(nombre: string | null | undefined): string | null {
  const t = (nombre ?? "").trim();
  return t ? t.split(/\s+/)[0] : null;
}

export async function leerDatosDelLead(workspaceId: string, contactId: string): Promise<ResultadoDeLectura> {
  const desde = new Date(Date.now() - DIAS * 86_400_000);

  const [contacto, chats, oficiales, seguimientos, llamadas] = await Promise.all([
    prisma.contact.findFirst({
      where: { id: contactId, workspaceId },
      select: { id: true, name: true, phoneNumber: true, crmStage: true, lostReason: true, wonAt: true, wonQuoteRef: true, createdAt: true },
    }),
    prisma.conversation.findMany({
      where: { workspaceId, contactId },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
      take: MAX_CHATS,
      select: {
        id: true,
        channelId: true,
        status: true,
        lastMessageAt: true,
        activeProductContext: true,
        channel: { select: { name: true } },
        assignedTo: { select: { name: true, email: true } },
      },
    }),
    prisma.officialApiConversation.findMany({
      where: { contact: { crmContactId: contactId }, config: { workspaceId } },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
      take: 5,
      select: { id: true, status: true, lastMessageAt: true, activeProductContext: true, assignedToUserId: true },
    }),
    prisma.follow.findMany({
      where: {
        workspaceId,
        contactId,
        OR: [{ status: "PENDING" }, { executeAt: { gte: desde } }, { executedAt: { gte: desde } }, { cancelledAt: { gte: desde } }],
      },
      orderBy: { executeAt: "desc" },
      take: MAX_SEGUIMIENTOS,
      select: {
        id: true,
        name: true,
        status: true,
        channelId: true,
        executeAt: true,
        executedAt: true,
        cancelledAt: true,
        executionError: true,
        content: true,
      },
    }),
    prisma.callAttempt.findMany({
      where: { workspaceId, contactId },
      orderBy: { calledAt: "desc" },
      take: MAX_LLAMADAS,
      select: {
        id: true,
        attemptNumber: true,
        calledAt: true,
        result: true,
        summary: true,
        nextContactAt: true,
        calledBy: { select: { name: true } },
      },
    }),
  ]);

  if (!contacto) return { error: "Contacto no encontrado" };

  const idsDeChats = chats.map((c) => c.id);
  const asesorasOficiales = [...new Set(oficiales.map((o) => o.assignedToUserId).filter((v): v is string => Boolean(v)))];

  const [embudos, ultimosEntrantes, ultimosOficiales, notasDeSistema, recordatorios, usuarios] = await Promise.all([
    idsDeChats.length
      ? prisma.embudoLead.findMany({
          where: { conversationId: { in: idsDeChats }, workspaceId },
          select: {
            conversationId: true,
            pasoActual: true,
            pasoMaximo: true,
            productoActual: true,
            productoInteres: true,
            temperatura: true,
            accion: true,
            accionDatos: true,
            tareaVence: true,
            tareaPrioridad: true,
            cotizacionRef: true,
            cotizacionEn: true,
            ventaEn: true,
            ultimoClienteEn: true,
          },
        })
      : [],
    Promise.all(
      idsDeChats.map((conversationId) =>
        prisma.message.findFirst({
          where: { workspaceId, conversationId, direction: "INBOUND" },
          orderBy: { createdAt: "desc" },
          select: { conversationId: true, createdAt: true },
        }),
      ),
    ),
    Promise.all(
      oficiales.map((o) =>
        prisma.officialApiMessage.findFirst({
          where: { conversationId: o.id, direction: "INBOUND" },
          orderBy: { createdAt: "desc" },
          select: { conversationId: true, createdAt: true },
        }),
      ),
    ),
    idsDeChats.length
      ? prisma.message.findMany({
          where: {
            conversationId: { in: idsDeChats },
            type: "SYSTEM",
            OR: [
              { rawPayload: { path: ["kind"], equals: "stage_changed" } },
              { rawPayload: { path: ["origen"], equals: "automatizacion" } },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: MAX_NOTAS,
          select: { conversationId: true, createdAt: true, content: true, rawPayload: true },
        })
      : [],
    idsDeChats.length
      ? prisma.message.findMany({
          where: {
            conversationId: { in: idsDeChats },
            createdAt: { gte: desde },
            direction: "OUTBOUND",
            rawPayload: { path: ["source"], equals: "agente-v3-seguimiento" },
          },
          orderBy: { createdAt: "desc" },
          take: MAX_RECORDATORIOS,
          select: { conversationId: true, createdAt: true, content: true },
        })
      : [],
    asesorasOficiales.length
      ? prisma.user.findMany({ where: { id: { in: asesorasOficiales } }, select: { id: true, name: true } })
      : [],
  ]);

  const embudoPorChat = new Map(embudos.map((e) => [e.conversationId, e]));
  const entrantePorChat = new Map(
    [...ultimosEntrantes, ...ultimosOficiales].filter((m): m is { conversationId: string; createdAt: Date } => Boolean(m)).map((m) => [m.conversationId, m.createdAt]),
  );
  const nombrePorUsuario = new Map(usuarios.map((u) => [u.id, u.name]));

  const conversaciones: ConversacionDelLead[] = [
    ...chats.map((c): ConversacionDelLead => {
      const e = embudoPorChat.get(c.id);
      const ultimoCliente = entrantePorChat.get(c.id) ?? e?.ultimoClienteEn ?? null;
      return {
        id: c.id,
        chatKey: `agent:${c.id}`,
        canal: "agent",
        canalId: c.channelId,
        linea: c.channel?.name ?? null,
        estado: c.status,
        ultimoMensajeEn: iso(c.lastMessageAt),
        ultimoClienteEn: iso(ultimoCliente),
        asesora: primerNombre(c.assignedTo?.name) ?? (c.assignedTo?.email ? c.assignedTo.email.split("@")[0] : null),
        productoActivo: textoDelJson(c.activeProductContext, "productName"),
        embudo: e
          ? {
              pasoActual: e.pasoActual,
              pasoMaximo: e.pasoMaximo,
              producto: e.productoActual ?? e.productoInteres,
              temperatura: e.temperatura,
              accion: e.accion,
              motivo: textoDelJson(e.accionDatos, "motivo"),
              tareaVence: iso(e.tareaVence),
              tareaPrioridad: e.tareaPrioridad,
              cotizacionRef: e.cotizacionRef,
              cotizacionEn: iso(e.cotizacionEn),
              ventaEn: iso(e.ventaEn),
            }
          : null,
      };
    }),
    ...oficiales.map(
      (o): ConversacionDelLead => ({
        id: o.id,
        chatKey: `official:${o.id}`,
        canal: "official",
        canalId: null,
        linea: "API oficial",
        estado: o.status,
        ultimoMensajeEn: iso(o.lastMessageAt),
        ultimoClienteEn: iso(entrantePorChat.get(o.id) ?? null),
        asesora: primerNombre(o.assignedToUserId ? nombrePorUsuario.get(o.assignedToUserId) : null),
        productoActivo: textoDelJson(o.activeProductContext, "productName"),
        embudo: null,
      }),
    ),
  ].sort((a, b) => (b.ultimoMensajeEn ?? "").localeCompare(a.ultimoMensajeEn ?? ""));

  const cambiosDeEtapa: NotaDelChat[] = [];
  const notasDeAutomatizacion: NotaDelChat[] = [];
  for (const m of notasDeSistema) {
    const nota = { conversationId: m.conversationId, en: m.createdAt.toISOString(), texto: m.content };
    if (textoDelJson(m.rawPayload, "kind") === "stage_changed") cambiosDeEtapa.push(nota);
    if (textoDelJson(m.rawPayload, "origen") === "automatizacion") notasDeAutomatizacion.push(nota);
  }

  return {
    datos: {
      contacto: {
        id: contacto.id,
        nombre: contacto.name,
        telefono4: contacto.phoneNumber ? contacto.phoneNumber.replace(/\D/g, "").slice(-4) : null,
        etapa: contacto.crmStage,
        motivoDescarte: contacto.lostReason,
        ganadoEn: iso(contacto.wonAt),
        cotizacionGanada: contacto.wonQuoteRef,
        creadoEn: contacto.createdAt.toISOString(),
      },
      conversaciones,
      cambiosDeEtapa,
      notasDeAutomatizacion,
      seguimientos: seguimientos.map((s) => ({
        id: s.id,
        nombre: s.name,
        estado: s.status,
        canalId: s.channelId,
        programadoPara: s.executeAt.toISOString(),
        ejecutadoEn: iso(s.executedAt),
        canceladoEn: iso(s.cancelledAt),
        error: s.executionError,
        contenido: s.content,
      })),
      recordatoriosBot: recordatorios.map((m) => ({ conversationId: m.conversationId, en: m.createdAt.toISOString(), texto: m.content })),
      llamadas: llamadas.map((l) => ({
        id: l.id,
        intento: l.attemptNumber,
        en: l.calledAt.toISOString(),
        resultado: l.result,
        resumen: l.summary,
        quien: primerNombre(l.calledBy?.name),
        proximoContactoEn: iso(l.nextContactAt),
      })),
    },
  };
}
