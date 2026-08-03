import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getContactTags } from "@/lib/chat-conversation-summary";
import { groupCrmRecordsByStage, sortCrmRecords } from "../domain/crm-config";
import type { CrmData, CrmRecord } from "../types";

type GetCrmDataInput = {
  // El workspace ya resuelto y autorizado por la capa de acceso (filtra isActive).
  // Antes esto re-resolvia el workspace por su cuenta y podia diferir del resto de la app.
  workspaceId: string;
  workspaceName: string;
  /**
   * Cuando viene, el informe deja de ser el del NEGOCIO y pasa a ser el de esa persona: solo
   * sus leads. Una asesora abriendo el informe veia los numeros de toda la empresa, que no le
   * dicen nada sobre su propio trabajo (y de paso le mostraban las ventas de las demas).
   */
  assignedToUserId?: string | null;
};

function getContactDisplayName(contact: { name: string | null; phoneNumber: string }) {
  return contact.name?.trim() || contact.phoneNumber;
}

function getContactLastActivity(contact: {
  updatedAt: Date;
  conversations: Array<{ lastMessageAt: Date | null; updatedAt: Date }>;
}) {
  const latestConversation = contact.conversations[0] ?? null;

  return latestConversation?.lastMessageAt ?? latestConversation?.updatedAt ?? contact.updatedAt;
}

const CRM_DETAIL_MAX_LENGTH = 300;

function truncateDetail(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= CRM_DETAIL_MAX_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, CRM_DETAIL_MAX_LENGTH - 1).trimEnd()}…`;
}

// Cantidad de mensajes del transcript de respaldo. Antes se pedian 40 POR contacto DENTRO de la
// consulta principal (cargaba ~4000 mensajes para usarlos en un puñado de casos y estresaba la
// base). Ahora el transcript se trae aparte, solo para los contactos que lo necesitan.
const TRANSCRIPT_MESSAGE_COUNT = 6;

function resolveContactDetail(input: { aiSummary: string | null; notes: string | null; transcript?: string }) {
  // Prioridad: resumen IA del historial (generado en el webhook) -> nota manual -> transcript -> fallback.
  const aiSummary = input.aiSummary?.trim();
  if (aiSummary) {
    return truncateDetail(aiSummary);
  }

  const note = input.notes?.trim();
  if (note) {
    return truncateDetail(note);
  }

  if (input.transcript) {
    return truncateDetail(input.transcript);
  }

  return "Sin detalle registrado";
}

/**
 * Transcript de respaldo SOLO para los contactos sin resumen IA ni nota (el unico caso donde se
 * usa). Antes la consulta principal cargaba 40 mensajes de CADA contacto aunque casi ninguno los
 * usara; con 382 contactos eran ~4000 mensajes por carga del CRM, y eso pesaba sobre la base cada
 * vez que las asesoras la abrian. Medido: baja la consulta del CRM de ~3.1s a ~1.2s y de ~4000
 * mensajes a ~130. Devuelve un mapa conversationId -> texto del transcript.
 */
async function buildContactTranscripts(
  contacts: Array<{
    aiSummary: string | null;
    notes: string | null;
    conversations: Array<{ id: string }>;
  }>,
) {
  const conversationIds = contacts
    .filter((contact) => !(contact.aiSummary?.trim() || contact.notes?.trim()))
    .map((contact) => contact.conversations[0]?.id)
    .filter((id): id is string => Boolean(id));

  if (conversationIds.length === 0) {
    return new Map<string, string>();
  }

  const messages = await prisma.message.findMany({
    where: { conversationId: { in: conversationIds }, type: { not: "SYSTEM" }, content: { not: null } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { conversationId: true, content: true, direction: true },
  });

  // Los mensajes vienen del mas reciente al mas viejo: tomamos los primeros N por conversacion.
  const byConversation = new Map<string, Array<{ content: string | null; direction: "INBOUND" | "OUTBOUND" }>>();
  for (const message of messages) {
    const list = byConversation.get(message.conversationId) ?? [];
    if (list.length < TRANSCRIPT_MESSAGE_COUNT) {
      list.push(message);
      byConversation.set(message.conversationId, list);
    }
  }

  const transcripts = new Map<string, string>();
  for (const [conversationId, list] of byConversation) {
    const text = list
      .slice()
      .reverse() // a orden cronologico
      .map((message) => `${message.direction === "INBOUND" ? "Cliente" : "Bot"}: ${message.content!.trim()}`)
      .join(" · ");
    if (text) {
      transcripts.set(conversationId, text);
    }
  }

  return transcripts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeOriginLabel(value: string): CrmRecord["origin"] {
  const normalized = value.trim().toLowerCase();

  if (/(marketplace|market place|market-place)/i.test(normalized)) {
    return "MARKETPLACE";
  }

  if (/(recomendad|referid|referenc|sugerid)/i.test(normalized)) {
    return "RECOMENDADO";
  }

  if (/(facebook|meta ads|meta|ads)/i.test(normalized)) {
    return "FACEBOOK";
  }

  return "GENERICO";
}

function getContactOriginFromMetadata(metadata: unknown): CrmRecord["origin"] {
  if (!isRecord(metadata)) {
    return "GENERICO";
  }

  const explicitOrigin =
    readString(metadata.crmOrigin) ||
    readString(metadata.origin) ||
    readString(metadata.leadOrigin) ||
    readString(metadata.source) ||
    readString(metadata.sourceType) ||
    readString(metadata.campaign) ||
    readString(metadata.campaignSource) ||
    readString(metadata.marketingSource) ||
    readString(metadata.sourceApp);

  return explicitOrigin ? normalizeOriginLabel(explicitOrigin) : "GENERICO";
}

function getContactCollapsedState(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }

  const value = (metadata as { crmKanbanCollapsed?: unknown }).crmKanbanCollapsed;
  return value === true;
}

/**
 * Chat del canal de API OFICIAL de cada contacto, para los que NO tienen chat del canal viejo.
 *
 * Un cliente que escribio al numero nuevo no tiene fila en Conversation: su chat vive en
 * OfficialApiConversation. Sin esto, su ficha en el Kanban salia sin boton "Abrir chat" -- la
 * asesora veia el lead pero no tenia como escribirle sin ir a buscarlo a mano a la bandeja.
 */
async function getOfficialChatKeysByCrmContact(workspaceId: string, contactIds: string[]) {
  const mapa = new Map<string, string>();
  if (contactIds.length === 0) {
    return mapa;
  }

  try {
    const filas = await prisma.$queryRaw<Array<{ crmContactId: string; conversationId: string }>>`
      SELECT DISTINCT ON (ct."crmContactId")
        ct."crmContactId" AS "crmContactId",
        c."id" AS "conversationId"
      FROM "OfficialApiContact" ct
      INNER JOIN "OfficialApiConversation" c ON c."contactId" = ct."id"
      INNER JOIN "OfficialApiClientConfig" cfg ON cfg."id" = ct."configId"
      WHERE cfg."workspaceId" = ${workspaceId}
        AND ct."crmContactId" IN (${Prisma.join(contactIds)})
      ORDER BY ct."crmContactId", c."lastMessageAt" DESC NULLS LAST, c."updatedAt" DESC
    `;

    for (const fila of filas) {
      mapa.set(fila.crmContactId, fila.conversationId);
    }
  } catch (error) {
    // Nunca puede tumbar el CRM: sin esto solo falta el boton de abrir chat.
    console.error("[crm] no se pudieron resolver los chats del canal oficial", error);
  }

  return mapa;
}

export async function getCrmData({
  workspaceId,
  workspaceName,
  assignedToUserId = null,
}: GetCrmDataInput): Promise<CrmData | null> {
  const rawContacts = await prisma.contact.findMany({
    where: {
      workspaceId,
      // Los contactos marcados como ocultos (proveedores, personales, etc.) no entran al CRM.
      excludedFromCrm: false,
      ...(assignedToUserId
        ? { conversations: { some: { assignedToUserId } } }
        : {}),
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      avatarUrl: true,
      notes: true,
      aiSummary: true,
      metadata: true,
      crmStage: true,
      lostReason: true,
      wonAt: true,
      createdAt: true,
      updatedAt: true,
      ContactTag: {
        select: {
          Tag: {
            select: {
              name: true,
              color: true,
            },
          },
        },
      },
      conversations: {
        orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
        take: 1,
        select: {
          id: true,
          lastMessageAt: true,
          updatedAt: true,
        },
      },
    },
  });

  const transcripts = await buildContactTranscripts(rawContacts);
  // Solo para los que NO tienen chat del canal viejo: son los unicos que pueden necesitarlo.
  const chatsOficiales = await getOfficialChatKeysByCrmContact(
    workspaceId,
    rawContacts.filter((contact) => !contact.conversations[0]?.id).map((contact) => contact.id),
  );

  const records: CrmRecord[] = rawContacts.map((contact) => ({
    id: contact.id,
    number: contact.phoneNumber,
    avatarUrl: contact.avatarUrl,
    name: getContactDisplayName(contact),
    // En GANADO la fecha mostrada es la de la VENTA (wonAt), no la última actividad. En el resto
    // de etapas sigue siendo la última actividad (cuándo se movió/habló por última vez).
    date: (contact.crmStage === "GANADO" && contact.wonAt ? contact.wonAt : getContactLastActivity(contact)).toISOString(),
    enteredAt: contact.createdAt.toISOString(),
    tags: getContactTags(contact.ContactTag.map((item) => item.Tag)),
    detail: resolveContactDetail({
      aiSummary: contact.aiSummary,
      notes: contact.notes,
      transcript: transcripts.get(contact.conversations[0]?.id ?? ""),
    }),
    status: (contact.crmStage as CrmRecord["status"]) ?? "NUEVO",
    lostReason: contact.lostReason ?? null,
    conversationId: contact.conversations[0]?.id ?? null,
    chatKey: contact.conversations[0]?.id
      ? `agent:${contact.conversations[0].id}`
      : chatsOficiales.get(contact.id)
        ? `official:${chatsOficiales.get(contact.id)}`
        : null,
    isCollapsed: getContactCollapsedState(contact.metadata),
    origin: getContactOriginFromMetadata(contact.metadata),
  }));

  const sortedRecords = sortCrmRecords(records);
  const columns = groupCrmRecordsByStage(sortedRecords);
  const active = sortedRecords.filter((record) => record.status !== "GANADO" && record.status !== "PERDIDO").length;
  const won = sortedRecords.filter((record) => record.status === "GANADO").length;
  const lost = sortedRecords.filter((record) => record.status === "PERDIDO").length;

  return {
    workspaceName,
    records: sortedRecords,
    columns,
    stats: {
      total: sortedRecords.length,
      active,
      won,
      lost,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function getCrmKanbanData({
  workspaceId,
  workspaceName,
  assignedToUserId = null,
}: GetCrmDataInput): Promise<CrmData | null> {
  const rawContacts = await prisma.contact.findMany({
    where: {
      workspaceId,
      // Los contactos marcados como ocultos (proveedores, personales, etc.) no entran al CRM.
      excludedFromCrm: false,
      // Para una asesora, el kanban es SU embudo. Ver los 1146 del negocio no le sirve para
      // trabajar y ademas le muestra los leads de las companeras.
      ...(assignedToUserId ? { conversations: { some: { assignedToUserId } } } : {}),
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      avatarUrl: true,
      notes: true,
      aiSummary: true,
      metadata: true,
      crmStage: true,
      lostReason: true,
      wonAt: true,
      createdAt: true,
      updatedAt: true,
      ContactTag: {
        select: {
          Tag: {
            select: {
              name: true,
              color: true,
            },
          },
        },
      },
      conversations: {
        orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
        take: 1,
        select: {
          id: true,
          lastMessageAt: true,
          updatedAt: true,
        },
      },
    },
  });

  const transcripts = await buildContactTranscripts(rawContacts);
  // Solo para los que NO tienen chat del canal viejo: son los unicos que pueden necesitarlo.
  const chatsOficiales = await getOfficialChatKeysByCrmContact(
    workspaceId,
    rawContacts.filter((contact) => !contact.conversations[0]?.id).map((contact) => contact.id),
  );

  const records: CrmRecord[] = rawContacts.map((contact) => ({
    id: contact.id,
    number: contact.phoneNumber,
    avatarUrl: contact.avatarUrl,
    name: getContactDisplayName(contact),
    // En GANADO la fecha mostrada es la de la VENTA (wonAt), no la última actividad. En el resto
    // de etapas sigue siendo la última actividad (cuándo se movió/habló por última vez).
    date: (contact.crmStage === "GANADO" && contact.wonAt ? contact.wonAt : getContactLastActivity(contact)).toISOString(),
    enteredAt: contact.createdAt.toISOString(),
    tags: getContactTags(contact.ContactTag.map((item) => item.Tag)),
    detail: resolveContactDetail({
      aiSummary: contact.aiSummary,
      notes: contact.notes,
      transcript: transcripts.get(contact.conversations[0]?.id ?? ""),
    }),
    status: (contact.crmStage as CrmRecord["status"]) ?? "NUEVO",
    lostReason: contact.lostReason ?? null,
    conversationId: contact.conversations[0]?.id ?? null,
    chatKey: contact.conversations[0]?.id
      ? `agent:${contact.conversations[0].id}`
      : chatsOficiales.get(contact.id)
        ? `official:${chatsOficiales.get(contact.id)}`
        : null,
    isCollapsed: getContactCollapsedState(contact.metadata),
    origin: getContactOriginFromMetadata(contact.metadata),
  }));

  const sortedRecords = sortCrmRecords(records);
  const columns = groupCrmRecordsByStage(sortedRecords);
  const active = sortedRecords.filter((record) => record.status !== "GANADO" && record.status !== "PERDIDO").length;
  const won = sortedRecords.filter((record) => record.status === "GANADO").length;
  const lost = sortedRecords.filter((record) => record.status === "PERDIDO").length;

  return {
    workspaceName,
    records: sortedRecords,
    columns,
    stats: {
      total: sortedRecords.length,
      active,
      won,
      lost,
    },
    generatedAt: new Date().toISOString(),
  };
}
