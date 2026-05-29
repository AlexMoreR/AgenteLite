import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getContactTags } from "@/lib/chat-conversation-summary";
import { groupCrmRecordsByStage, sortCrmRecords } from "../domain/crm-config";
import type { CrmData, CrmRecord } from "../types";

type GetCrmDataInput = {
  userId: string;
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

function getContactDetail(contact: {
  notes: string | null;
  conversations: Array<{
    messages: Array<{
      content: string | null;
      rawPayload?: Prisma.JsonValue | null;
    }>;
  }>;
}) {
  const note = contact.notes?.trim();
  if (note) {
    return note;
  }

  const lastMessage = contact.conversations[0]?.messages[0]?.content?.trim();
  if (lastMessage) {
    return lastMessage;
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

function getContactOrigin(metadata: unknown, rawPayload: Prisma.JsonValue | null | undefined): CrmRecord["origin"] {
  if (isRecord(metadata)) {
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

    if (explicitOrigin) {
      return normalizeOriginLabel(explicitOrigin);
    }
  }

  if (!isRecord(rawPayload)) {
    return "GENERICO";
  }

  const evolutionRoot = isRecord(rawPayload.evolution) ? rawPayload.evolution : rawPayload;
  const dataRoot = isRecord(evolutionRoot.data) ? evolutionRoot.data : evolutionRoot;
  const contextInfo = isRecord(dataRoot.contextInfo) ? dataRoot.contextInfo : null;
  const externalAdReply = contextInfo && isRecord(contextInfo.externalAdReply) ? contextInfo.externalAdReply : null;

  if (!externalAdReply) {
    return "GENERICO";
  }

  const combinedText = [
    readString(externalAdReply.sourceApp),
    readString(externalAdReply.sourceUrl),
    readString(externalAdReply.title),
    readString(externalAdReply.body),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!combinedText) {
    return "GENERICO";
  }

  if (combinedText.includes("marketplace")) {
    return "MARKETPLACE";
  }

  if (combinedText.includes("recomend") || combinedText.includes("referid") || combinedText.includes("referenc")) {
    return "RECOMENDADO";
  }

  if (combinedText.includes("facebook") || combinedText.includes("meta")) {
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

export async function getCrmData({ userId }: GetCrmDataInput): Promise<CrmData | null> {
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      workspace: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!membership) {
    return null;
  }

  const rawContacts = await prisma.contact.findMany({
    where: {
      workspaceId: membership.workspace.id,
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      notes: true,
      metadata: true,
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
            take: 1,
            select: {
              content: true,
              rawPayload: true,
            },
          },
        },
      },
    },
  });

  const crmStageRows =
    rawContacts.length > 0
      ? await prisma.$queryRaw<Array<{ contactId: string; crmStage: string }>>`
          SELECT
            c."id" AS "contactId",
            c."crmStage"::text AS "crmStage"
          FROM "Contact" c
          WHERE c."workspaceId" = ${membership.workspace.id}
            AND c."id" IN (${Prisma.join(rawContacts.map((contact) => contact.id))})
        `
      : [];

  const crmStageByContactId = new Map(crmStageRows.map((row) => [row.contactId, row.crmStage]));

  const records: CrmRecord[] = rawContacts.map((contact) => ({
    id: contact.id,
    number: contact.phoneNumber,
    name: getContactDisplayName(contact),
    date: getContactLastActivity(contact).toISOString(),
    tags: getContactTags(contact.ContactTag.map((item) => item.Tag)),
    detail: getContactDetail(contact),
    status: (crmStageByContactId.get(contact.id) as CrmRecord["status"]) ?? "NUEVO",
    isCollapsed: getContactCollapsedState(contact.metadata),
    origin: getContactOrigin(contact.metadata, contact.conversations[0]?.messages[0]?.rawPayload),
  }));

  const sortedRecords = sortCrmRecords(records);
  const columns = groupCrmRecordsByStage(sortedRecords);
  const active = sortedRecords.filter((record) => record.status !== "GANADO" && record.status !== "PERDIDO").length;
  const won = sortedRecords.filter((record) => record.status === "GANADO").length;
  const lost = sortedRecords.filter((record) => record.status === "PERDIDO").length;

  return {
    workspaceName: membership.workspace.name,
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

export async function getCrmKanbanData({ userId }: GetCrmDataInput): Promise<CrmData | null> {
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      workspace: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!membership) {
    return null;
  }

  const rawContacts = await prisma.contact.findMany({
    where: {
      workspaceId: membership.workspace.id,
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      notes: true,
      metadata: true,
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
            take: 1,
            select: {
              content: true,
            },
          },
        },
      },
    },
  });

  const crmStageRows =
    rawContacts.length > 0
      ? await prisma.$queryRaw<Array<{ contactId: string; crmStage: string }>>`
          SELECT
            c."id" AS "contactId",
            c."crmStage"::text AS "crmStage"
          FROM "Contact" c
          WHERE c."workspaceId" = ${membership.workspace.id}
            AND c."id" IN (${Prisma.join(rawContacts.map((contact) => contact.id))})
        `
      : [];

  const crmStageByContactId = new Map(crmStageRows.map((row) => [row.contactId, row.crmStage]));

  const records: CrmRecord[] = rawContacts.map((contact) => ({
    id: contact.id,
    number: contact.phoneNumber,
    name: getContactDisplayName(contact),
    date: getContactLastActivity(contact).toISOString(),
    tags: getContactTags(contact.ContactTag.map((item) => item.Tag)),
    detail: getContactDetail(contact),
    status: (crmStageByContactId.get(contact.id) as CrmRecord["status"]) ?? "NUEVO",
    isCollapsed: getContactCollapsedState(contact.metadata),
    origin: getContactOriginFromMetadata(contact.metadata),
  }));

  const sortedRecords = sortCrmRecords(records);
  const columns = groupCrmRecordsByStage(sortedRecords);
  const active = sortedRecords.filter((record) => record.status !== "GANADO" && record.status !== "PERDIDO").length;
  const won = sortedRecords.filter((record) => record.status === "GANADO").length;
  const lost = sortedRecords.filter((record) => record.status === "PERDIDO").length;

  return {
    workspaceName: membership.workspace.name,
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
