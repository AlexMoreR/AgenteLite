import { prisma } from "@/lib/prisma";
import { getContactTags } from "@/lib/chat-conversation-summary";
import { groupCrmRecordsByStage, sortCrmRecords } from "../domain/crm-config";
import type { CrmData, CrmRecord } from "../types";

type GetCrmDataInput = {
  // El workspace ya resuelto y autorizado por la capa de acceso (filtra isActive).
  // Antes esto re-resolvia el workspace por su cuenta y podia diferir del resto de la app.
  workspaceId: string;
  workspaceName: string;
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

export async function getCrmData({ workspaceId, workspaceName }: GetCrmDataInput): Promise<CrmData | null> {
  const rawContacts = await prisma.contact.findMany({
    where: {
      workspaceId,
      // Los contactos marcados como ocultos (proveedores, personales, etc.) no entran al CRM.
      excludedFromCrm: false,
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

  const records: CrmRecord[] = rawContacts.map((contact) => ({
    id: contact.id,
    number: contact.phoneNumber,
    avatarUrl: contact.avatarUrl,
    name: getContactDisplayName(contact),
    date: getContactLastActivity(contact).toISOString(),
    tags: getContactTags(contact.ContactTag.map((item) => item.Tag)),
    detail: resolveContactDetail({
      aiSummary: contact.aiSummary,
      notes: contact.notes,
      transcript: transcripts.get(contact.conversations[0]?.id ?? ""),
    }),
    status: (contact.crmStage as CrmRecord["status"]) ?? "NUEVO",
    lostReason: contact.lostReason ?? null,
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

export async function getCrmKanbanData({ workspaceId, workspaceName }: GetCrmDataInput): Promise<CrmData | null> {
  const rawContacts = await prisma.contact.findMany({
    where: {
      workspaceId,
      // Los contactos marcados como ocultos (proveedores, personales, etc.) no entran al CRM.
      excludedFromCrm: false,
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

  const records: CrmRecord[] = rawContacts.map((contact) => ({
    id: contact.id,
    number: contact.phoneNumber,
    avatarUrl: contact.avatarUrl,
    name: getContactDisplayName(contact),
    date: getContactLastActivity(contact).toISOString(),
    tags: getContactTags(contact.ContactTag.map((item) => item.Tag)),
    detail: resolveContactDetail({
      aiSummary: contact.aiSummary,
      notes: contact.notes,
      transcript: transcripts.get(contact.conversations[0]?.id ?? ""),
    }),
    status: (contact.crmStage as CrmRecord["status"]) ?? "NUEVO",
    lostReason: contact.lostReason ?? null,
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
