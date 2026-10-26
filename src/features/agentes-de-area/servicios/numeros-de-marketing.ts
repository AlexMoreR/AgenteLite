import { prisma } from "@/lib/prisma";

import { agruparPorAnuncio, type LeadDeMarketing } from "../dominio/marketing";
import { inicioDelDiaBogota } from "../dominio/reglas";

/**
 * Los números de marketing por ANUNCIO de origen, ya calculados. Solo LEE contactos, conversaciones, mensajes y embudo:
 * no escribe nada. El costo y la campaña salen de Meta (el agente los une); las ventas se confirman en Gestión.
 */
const TOPE_LEADS = 5_000;

export async function numerosDeMarketing(workspaceId: string, fecha: string, dias: number) {
  const desde = inicioDelDiaBogota(fecha, -(dias - 1));
  const hasta = inicioDelDiaBogota(fecha, 1);
  const filas = await prisma.embudoLead.findMany({
    where: { workspaceId, entradaEn: { gte: desde, lt: hasta } },
    select: {
      conversationId: true,
      anuncioId: true,
      anuncioTitulo: true,
      temperatura: true,
      primeraRespuestaAsesoraEn: true,
      entradaEn: true,
    },
    orderBy: { entradaEn: "asc" },
    take: TOPE_LEADS,
  });
  const chats = filas.length
    ? await prisma.conversation.findMany({
        where: { workspaceId, id: { in: filas.map((f) => f.conversationId) }, contact: { excludedFromCrm: false } },
        select: { id: true, contact: { select: { crmStage: true, wonQuoteRef: true } } },
      })
    : [];
  const chatDe = new Map(chats.map((c) => [c.id, c.contact]));

  // Los mensajes del cliente solo se piden para un día (Calidad del Lead mira las conversaciones de ayer).
  const mensajes = new Map<string, string[]>();
  if (dias === 1 && chats.length) {
    const entrantes = await prisma.message.findMany({
      where: { workspaceId, conversationId: { in: chats.map((c) => c.id) }, direction: "INBOUND", type: "TEXT" },
      select: { conversationId: true, content: true },
      orderBy: { createdAt: "asc" },
      take: 20_000,
    });
    for (const m of entrantes) {
      if (!m.content) continue;
      const lista = mensajes.get(m.conversationId) ?? [];
      lista.push(m.content);
      mensajes.set(m.conversationId, lista);
    }
  }

  const leads: LeadDeMarketing[] = [];
  for (const f of filas) {
    const contacto = chatDe.get(f.conversationId);
    if (!contacto) continue;
    leads.push({
      conversacionId: f.conversationId,
      anuncioId: f.anuncioId,
      anuncioTitulo: f.anuncioTitulo,
      temperatura: f.temperatura,
      crmStage: contacto.crmStage,
      cotizacion: contacto.wonQuoteRef,
      primeraRespuestaAsesoraEn: f.primeraRespuestaAsesoraEn,
      entradaEn: f.entradaEn,
      mensajesDelCliente: mensajes.get(f.conversationId) ?? [],
    });
  }
  const resultado = agruparPorAnuncio(leads, dias === 1);
  return {
    hasta: fecha,
    dias,
    ...resultado,
    ...(filas.length >= TOPE_LEADS ? { aviso: `Se leyeron solo los primeros ${TOPE_LEADS} leads: los números pueden quedar cortos.` } : {}),
    nota:
      "Anuncio de origen = el que guardó el CRM al entrar el chat (la campaña se une leyendo Meta). Las que están en 'sin anuncio de origen' NO se pueden cruzar: no inventes su costo por venta. " +
      "Tibio/Caliente: la temperatura que calcula el sistema y la etapa de la asesora (Propuesta, Negociación o Ganado). Las ventas (GANADO) traen su cotización de Gestión: confírmalas con el MCP de Gestión.",
  };
}
