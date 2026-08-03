import { prisma } from "@/lib/prisma";
import { extractEvolutionMessageText } from "@/lib/evolution-webhook";
import type { CrmStage } from "../types";
import { getCallResultLabel } from "../domain/crm-config";

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
  /**
   * Hay una llamada AGENDADA para hoy o ya vencida.
   *
   * Es lo mas urgente de la lista: la asesora se comprometio a volver a llamar ese dia. Antes
   * eso vivia solo en el modulo de Llamadas, asi que tenia que mirar en dos pantallas para
   * saber que le tocaba — y lo que estaba en la otra se pasaba.
   */
  callDue: boolean;
  nextContactAt: string | null;
  // Como termino la ultima llamada, para que sepa con que retomar.
  lastCallResultLabel: string | null;
  // Este lead es MIO (me lo asignaron) o esta sin dueno. No entran los de otra persona.
  esMio: boolean;
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

export async function getMiDiaData(input: { workspaceId: string; userId: string }): Promise<MiDiaData> {
  try {
    return await computeMiDiaData(input);
  } catch (error) {
    // Una vista de trabajo no debe tumbar la pantalla si la consulta falla (timeout, etc.):
    // preferimos mostrar el estado vacio antes que un 500 en toda la seccion CRM.
    console.error("[mi-dia] fallo al calcular la lista de prioridad:", error);
    return { generatedAt: new Date().toISOString(), leads: [] };
  }
}

async function computeMiDiaData(input: { workspaceId: string; userId: string }): Promise<MiDiaData> {
  const now = Date.now();
  const maxAge = new Date(now - MAX_DAYS_SINCE_CONTACT * 24 * 60 * 60 * 1000);
  const minAge = new Date(now - MIN_HOURS_SINCE_CONTACT * 60 * 60 * 1000);

  const conversations = await prisma.conversation.findMany({
    where: {
      workspaceId: input.workspaceId,
      contact: { crmStage: { in: PIPELINE_STAGES } },
      lastMessageAt: { lte: minAge, gte: maxAge },
      /**
       * SU dia, no el de la empresa.
       *
       * Antes la lista era la misma para todas: con tres personas ya se pisaban (dos le
       * escribian al mismo cliente) y ninguna se hacia cargo del resto -- "pense que lo hacias
       * vos". Con vendedores nuevos entrando eso se rompe del todo, y ademas hace imposible
       * medir a nadie: si la lista es de todos, el resultado no es de nadie.
       *
       * Entran los MIOS y los que no tienen dueno. Los de otra persona NO: para eso esta el
       * Kanban, que sigue mostrando el embudo completo.
       *
       * El filtro es por ASIGNACION, no por rol: hoy las tres figuran como "Administrador",
       * asi que separar por rol no separaria nada.
       */
      OR: [{ assignedToUserId: input.userId }, { assignedToUserId: null }],
    },
    orderBy: { lastMessageAt: "desc" },
    take: 300,
    select: {
      id: true,
      lastMessageAt: true,
      assignedToUserId: true,
      contact: {
        select: { id: true, name: true, phoneNumber: true, avatarUrl: true, crmStage: true },
      },
    },
  });

  /**
   * Las llamadas AGENDADAS entran igual, aunque el lead no pase los filtros de arriba.
   *
   * Los filtros de la lista (etapa del embudo, no mas de 30 dias, no menos de 2 horas) tienen
   * sentido para "a quien retomar", pero una llamada agendada es OTRA cosa: la asesora se
   * comprometio a llamar ese dia. Si el lead quedo fuera del corte por viejo o por etapa, el
   * compromiso desaparecia de la vista — y estaba solo en el modulo de Llamadas, que es la otra
   * pantalla que tenia que mirar.
   */
  const finDeHoyBogota = (() => {
    const OFFSET = 5 * 60 * 60 * 1000;
    const enBogota = new Date(now - OFFSET);
    const medianoche = Date.UTC(enBogota.getUTCFullYear(), enBogota.getUTCMonth(), enBogota.getUTCDate());
    return new Date(medianoche + OFFSET + 24 * 60 * 60 * 1000);
  })();

  const llamadasPendientes = await prisma.$queryRaw<
    Array<{ contactId: string; nextContactAt: Date; result: string }>
  >`
    SELECT DISTINCT ON (ca."contactId")
      ca."contactId" AS "contactId",
      ca."nextContactAt" AS "nextContactAt",
      ca."result" AS "result"
    FROM "CallAttempt" ca
    WHERE ca."workspaceId" = ${input.workspaceId}
      AND ca."nextContactAt" IS NOT NULL
      AND ca."nextContactAt" < ${finDeHoyBogota}
    ORDER BY ca."contactId", ca."calledAt" DESC
  `;

  const pendientePorContacto = new Map(llamadasPendientes.map((fila) => [fila.contactId, fila]));

  // Los agendados que NO estaban en la lista se traen aparte, con las mismas reglas de dueño.
  const yaEnLista = new Set(conversations.map((conversation) => conversation.contact.id));
  const faltantes = llamadasPendientes
    .map((fila) => fila.contactId)
    .filter((contactId) => !yaEnLista.has(contactId));

  if (faltantes.length > 0) {
    const extra = await prisma.conversation.findMany({
      where: {
        workspaceId: input.workspaceId,
        contactId: { in: faltantes },
        contact: { excludedFromCrm: false },
        OR: [{ assignedToUserId: input.userId }, { assignedToUserId: null }],
      },
      orderBy: { lastMessageAt: "desc" },
      select: {
        id: true,
        lastMessageAt: true,
        assignedToUserId: true,
        contact: {
          select: { id: true, name: true, phoneNumber: true, avatarUrl: true, crmStage: true },
        },
      },
    });
    conversations.push(...extra.filter((fila) => !conversations.some((c) => c.id === fila.id)));
  }

  if (conversations.length === 0) {
    return { generatedAt: new Date(now).toISOString(), leads: [] };
  }

  // Ultimo mensaje real de cada conversacion (preview + quien hablo ultimo), en UNA sola consulta
  // con DISTINCT ON. Antes era una findFirst por conversacion en paralelo (N+1): con ~40 leads
  // saturaba el pool de conexiones y la pagina daba 500 intermitente. type SYSTEM se excluye: son
  // notas internas ("el agente movió la etapa a Caliente") que se guardan como mensaje y se colaban
  // como ultimo mensaje, ademas de contaminar la senal de "te escribio" (van como OUTBOUND).
  type LastMessageRow = {
    conversationId: string;
    content: string | null;
    direction: "INBOUND" | "OUTBOUND";
    type: string | null;
    rawPayload: unknown;
  };
  const conversationIds = conversations.map((conversation) => conversation.id);
  const lastMessageRows = await prisma.$queryRawUnsafe<LastMessageRow[]>(
    // OJO con rawPayload: el webhook guarda el ARCHIVO en base64 adentro (foto, audio, video).
    // Traerlo entero para el ultimo mensaje de hasta 300 conversaciones hacia que esta pantalla
    // tardara ~4s -- y es la primera que ve todo el mundo al entrar. Se borra esa clave en la
    // consulta misma, asi el archivo no viaja de la base a la app: del payload solo se necesita
    // el texto de respaldo cuando el mensaje no trae `content`.
    // Se limpian las dos rutas conocidas (evogo usa "Message", Evolution API "message"); borrar
    // una ruta que no existe no hace nada.
    `SELECT DISTINCT ON (m."conversationId")
        m."conversationId", m."content", m."direction"::text AS "direction", m."type"::text AS "type",
        CASE WHEN COALESCE(m."content", '') = ''
             THEN (m."rawPayload" #- '{evolution,data,Message,base64}') #- '{evolution,data,message,base64}'
             ELSE NULL END AS "rawPayload"
     FROM "Message" m
     WHERE m."conversationId" = ANY($1::text[])
       AND m."isStatusBroadcast" = false
       AND (m."type" IS NULL OR m."type"::text <> 'SYSTEM')
     ORDER BY m."conversationId", m."createdAt" DESC, m."id" DESC`,
    conversationIds,
  );
  const latestByConversation = new Map(lastMessageRows.map((row) => [row.conversationId, row] as const));

  const leads: MiDiaLead[] = conversations.map((conversation) => {
    const pendiente = pendientePorContacto.get(conversation.contact.id) ?? null;
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
      esMio: conversation.assignedToUserId === input.userId,
      hoursSinceContact,
      lastMessagePreview: previewFromMessage(message?.content ?? null, message?.rawPayload, message?.type ?? null),
      waitingOnUs: message?.direction === "INBOUND",
      callDue: Boolean(pendiente),
      nextContactAt: pendiente ? pendiente.nextContactAt.toISOString() : null,
      lastCallResultLabel: pendiente ? getCallResultLabel(pendiente.result) ?? pendiente.result : null,
    };
  });

  // Orden: primero los que ESPERAN respuesta (el cliente escribio ultimo), luego por etapa mas
  // caliente, y dentro de eso el mas abandonado primero. Es el orden en que un vendedor atacaria.
  leads.sort((a, b) => {
    // Lo MIO primero: es "mi dia", no la bolsa comun. Los sin dueno quedan abajo, disponibles
    // para quien tenga hueco, pero sin empujar hacia el fondo el trabajo que ya es de uno.
    if (a.esMio !== b.esMio) {
      return a.esMio ? -1 : 1;
    }
    // Una llamada agendada gana: es un compromiso con fecha, no una corazonada de prioridad.
    if (a.callDue !== b.callDue) {
      return a.callDue ? -1 : 1;
    }
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
