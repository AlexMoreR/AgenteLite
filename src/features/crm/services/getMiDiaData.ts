import { prisma } from "@/lib/prisma";
import { extractEvolutionMessageText } from "@/lib/evolution-webhook";
import type { CrmStage } from "../types";

/**
 * "Mi día" — la lista de a QUIÉN contactar HOY para la vendedora.
 *
 * No sale de tareas de seguimiento programadas (no hay ninguna agendada) ni de asignacion (nadie
 * asigna leads): sale de lo unico que si tenemos poblado ahora que el agente mueve las etapas —
 * la ETAPA + hace cuanto no se le escribe. Ataca el problema #1 del negocio: los leads se enfrian
 * justo despues de mandar fotos y precio y nadie los retoma.
 *
 * Entran los del embudo activo (Calificado / Cotizado / Negociacion). Se dejan afuera:
 *  - NUEVO: todavia no enganchan, no hay nada que retomar.
 *  - GANADO / PERDIDO: cerrados.
 * Y solo los que necesitan un empujon: sin actividad hace mas de MIN_HORAS (no molestar a los que
 * estan chateando ahora) y no mas de MAX_DIAS (mas viejo = probablemente muerto).
 */

const PIPELINE_STAGES: CrmStage[] = ["CALIFICADO", "PROPUESTA", "NEGOCIACION"];

// Prioridad por etapa: cuanto mas avanzado, mas plata en juego, primero en la lista.
const STAGE_PRIORITY: Record<string, number> = {
  NEGOCIACION: 3,
  PROPUESTA: 2,
  CALIFICADO: 1,
};

const MIN_HOURS_SINCE_CONTACT = 2; // no mostrar leads con los que se esta hablando ahora mismo
const MAX_DAYS_SINCE_CONTACT = 30; // mas viejo que esto: probablemente perdido, no ensucia la lista
const MAX_ITEMS = 60;

export type MiDiaLead = {
  contactId: string;
  conversationId: string;
  chatKey: string;
  name: string;
  phoneNumber: string;
  avatarUrl: string | null;
  stage: CrmStage;
  lastMessageAt: string; // ISO
  hoursSinceContact: number;
  lastMessagePreview: string;
  // Quien hablo ultimo: si fue el cliente, es MAS urgente (esta esperando respuesta).
  waitingOnUs: boolean;
};

export type MiDiaData = {
  generatedAt: string;
  leads: MiDiaLead[];
};

function previewFromMessage(content: string | null, rawPayload: unknown, type: string | null) {
  const text = content?.trim() || extractEvolutionMessageText(rawPayload) || "";
  if (text) {
    return text.length > 90 ? `${text.slice(0, 89).trimEnd()}…` : text;
  }
  if (type === "AUDIO") return "🎤 Audio";
  if (type === "IMAGE") return "📷 Foto";
  if (type === "VIDEO") return "🎥 Video";
  if (type === "DOCUMENT") return "📄 Documento";
  return "Sin mensajes visibles.";
}

export async function getMiDiaData(input: { workspaceId: string }): Promise<MiDiaData> {
  const now = Date.now();
  const maxAge = new Date(now - MAX_DAYS_SINCE_CONTACT * 24 * 60 * 60 * 1000);
  const minAge = new Date(now - MIN_HOURS_SINCE_CONTACT * 60 * 60 * 1000);

  const conversations = await prisma.conversation.findMany({
    where: {
      workspaceId: input.workspaceId,
      contact: { crmStage: { in: PIPELINE_STAGES } },
      lastMessageAt: { lte: minAge, gte: maxAge },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 300,
    select: {
      id: true,
      lastMessageAt: true,
      contact: {
        select: { id: true, name: true, phoneNumber: true, avatarUrl: true, crmStage: true },
      },
    },
  });

  if (conversations.length === 0) {
    return { generatedAt: new Date(now).toISOString(), leads: [] };
  }

  // Ultimo mensaje real de cada conversacion (para el preview y saber quien hablo ultimo). Se pide
  // en una sola consulta por conversacion pero en paralelo; el volumen aca es chico (embudo activo).
  const latestByConversation = new Map(
    (
      await Promise.all(
        conversations.map(async (conversation) => {
          const message = await prisma.message.findFirst({
            where: { conversationId: conversation.id, isStatusBroadcast: false },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { content: true, direction: true, type: true, rawPayload: true },
          });
          return [conversation.id, message] as const;
        }),
      )
    ).filter(([, message]) => message !== null),
  );

  const leads: MiDiaLead[] = conversations.map((conversation) => {
    const lastMessageAt = conversation.lastMessageAt ?? new Date(now);
    const hoursSinceContact = Math.floor((now - lastMessageAt.getTime()) / (60 * 60 * 1000));
    const message = latestByConversation.get(conversation.id) ?? null;
    return {
      contactId: conversation.contact.id,
      conversationId: conversation.id,
      chatKey: `agent:${conversation.id}`,
      name: conversation.contact.name?.trim() || conversation.contact.phoneNumber,
      phoneNumber: conversation.contact.phoneNumber,
      avatarUrl: conversation.contact.avatarUrl ?? null,
      stage: conversation.contact.crmStage as CrmStage,
      lastMessageAt: lastMessageAt.toISOString(),
      hoursSinceContact,
      lastMessagePreview: previewFromMessage(message?.content ?? null, message?.rawPayload, message?.type ?? null),
      waitingOnUs: message?.direction === "INBOUND",
    };
  });

  // Orden: primero los que ESPERAN respuesta (el cliente escribio ultimo), luego por etapa mas
  // caliente, y dentro de eso el mas abandonado primero. Es el orden en que un vendedor atacaria.
  leads.sort((a, b) => {
    if (a.waitingOnUs !== b.waitingOnUs) {
      return a.waitingOnUs ? -1 : 1;
    }
    const stageDiff = (STAGE_PRIORITY[b.stage] ?? 0) - (STAGE_PRIORITY[a.stage] ?? 0);
    if (stageDiff !== 0) {
      return stageDiff;
    }
    return b.hoursSinceContact - a.hoursSinceContact;
  });

  return { generatedAt: new Date(now).toISOString(), leads: leads.slice(0, MAX_ITEMS) };
}
