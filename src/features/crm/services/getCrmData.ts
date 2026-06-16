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

function getContactDetail(contact: {
  aiSummary: string | null;
  notes: string | null;
  conversations: Array<{
    messages: Array<{
      content: string | null;
      direction: "INBOUND" | "OUTBOUND";
      type: string;
    }>;
  }>;
}) {
  // Prioridad: resumen IA del historial (generado en el webhook) -> nota manual -> transcript -> fallback.
  const aiSummary = contact.aiSummary?.trim();
  if (aiSummary) {
    return truncateDetail(aiSummary);
  }

  const note = contact.notes?.trim();
  if (note) {
    return truncateDetail(note);
  }

  // Respaldo para contactos sin resumen IA todavia: transcript de los ultimos mensajes.
  // Vienen en orden descendente (mas reciente primero); se invierten a orden cronologico.
  const summary = (contact.conversations[0]?.messages ?? [])
    .filter((message) => message.type !== "SYSTEM" && message.content?.trim())
    .reverse()
    .map((message) => `${message.direction === "INBOUND" ? "Cliente" : "Bot"}: ${message.content!.trim()}`)
    .join(" · ");

  if (summary) {
    return truncateDetail(summary);
  }

  return "Sin detalle registrado";
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
      notes: true,
      aiSummary: true,
      metadata: true,
      crmStage: true,
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
          lastMessageAt: true,
          updatedAt: true,
          messages: {
            orderBy: { createdAt: "desc" },
            take: 40,
            select: {
              content: true,
              direction: true,
              type: true,
            },
          },
        },
      },
    },
  });

  const records: CrmRecord[] = rawContacts.map((contact) => ({
    id: contact.id,
    number: contact.phoneNumber,
    name: getContactDisplayName(contact),
    date: getContactLastActivity(contact).toISOString(),
    tags: getContactTags(contact.ContactTag.map((item) => item.Tag)),
    detail: getContactDetail(contact),
    status: (contact.crmStage as CrmRecord["status"]) ?? "NUEVO",
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
      notes: true,
      aiSummary: true,
      metadata: true,
      crmStage: true,
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
          lastMessageAt: true,
          updatedAt: true,
          messages: {
            orderBy: { createdAt: "desc" },
            take: 40,
            select: {
              content: true,
              direction: true,
              type: true,
            },
          },
        },
      },
    },
  });

  const records: CrmRecord[] = rawContacts.map((contact) => ({
    id: contact.id,
    number: contact.phoneNumber,
    name: getContactDisplayName(contact),
    date: getContactLastActivity(contact).toISOString(),
    tags: getContactTags(contact.ContactTag.map((item) => item.Tag)),
    detail: getContactDetail(contact),
    status: (contact.crmStage as CrmRecord["status"]) ?? "NUEVO",
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
