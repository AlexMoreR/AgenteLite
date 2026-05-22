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
    messages: Array<{ content: string | null }>;
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
