import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncLeadLifecycleForContact } from "@/lib/contact-default-tags";
import { getContactTags } from "@/lib/chat-conversation-summary";
import type { ContactosContact, ContactosData } from "../types";

const CONTACTS_PAGE_SIZE = 10;

type ContactosQuery = {
  userId: string;
  searchQuery?: string;
  selectedContactId?: string;
  agentFilterId?: string;
  reportRangeDays?: number;
  page?: number;
  includeReport?: boolean;
};

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function getContactLastActivity(contact: Pick<ContactosContact, "lastActivityAt" | "updatedAt">) {
  return contact.lastActivityAt ? new Date(contact.lastActivityAt).getTime() : new Date(contact.updatedAt).getTime();
}

function getBogotaDayKey(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function getBogotaDateLabel(value: Date) {
  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
    timeZone: "America/Bogota",
  }).format(value);
}

function getBogotaHourKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "0";
  return Number(hour);
}

function getBogotaShortWeekday(value: Date) {
  return new Intl.DateTimeFormat("es-CO", {
    weekday: "short",
    timeZone: "America/Bogota",
  })
    .format(value)
    .replace(/\.$/, "");
}

function buildBogotaHeatmapWindow(days = 7) {
  const now = new Date();
  const todayParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = Number(todayParts.find((part) => part.type === "year")?.value ?? "1970");
  const month = Number(todayParts.find((part) => part.type === "month")?.value ?? "1");
  const day = Number(todayParts.find((part) => part.type === "day")?.value ?? "1");

  return Array.from({ length: days }, (_, index) => {
    const offset = days - index - 1;
    return new Date(Date.UTC(year, month - 1, day - offset, 12, 0, 0));
  });
}

function normalizeReportRangeDays(value: number | undefined) {
  if (value === 14 || value === 30) {
    return value;
  }

  return 7;
}

function normalizeContactPage(value: number | undefined) {
  if (!value || !Number.isFinite(value) || value < 1) {
    return 1;
  }

  return Math.floor(value);
}

function buildContactWhere(input: { workspaceId: string; query: string; agentId: string }) {
  const where: Prisma.ContactWhereInput = {
    workspaceId: input.workspaceId,
  };

  if (input.agentId) {
    where.conversations = {
      some: {
        agentId: input.agentId,
      },
    };
  }

  if (input.query) {
    where.OR = [
      {
        name: {
          contains: input.query,
          mode: "insensitive",
        },
      },
      {
        phoneNumber: {
          contains: input.query,
          mode: "insensitive",
        },
      },
      {
        email: {
          contains: input.query,
          mode: "insensitive",
        },
      },
      {
        notes: {
          contains: input.query,
          mode: "insensitive",
        },
      },
    ];
  }

  return where;
}

function buildContactSelect(agentId: string) {
  return {
    id: true,
    name: true,
    phoneNumber: true,
    email: true,
    notes: true,
    avatarUrl: true,
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
    _count: {
      select: {
        conversations: true,
        messages: true,
      },
    },
    conversations: {
      where: agentId
        ? {
            agentId,
          }
        : undefined,
      orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
      take: 3,
      select: {
        id: true,
        status: true,
        automationPaused: true,
        lastMessageAt: true,
        startedAt: true,
        updatedAt: true,
        agent: {
          select: {
            id: true,
            name: true,
          },
        },
        channel: {
          select: {
            id: true,
            name: true,
            provider: true,
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            content: true,
            createdAt: true,
            direction: true,
            type: true,
          },
        },
      },
    },
    contactMatches: {
      orderBy: [{ detectedAt: "desc" }, { createdAt: "desc" }],
      take: 5,
      select: {
        id: true,
        matchType: true,
        sourceType: true,
        targetName: true,
        detectedAt: true,
        tag: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
      },
    },
  } satisfies Prisma.ContactSelect;
}

export async function getContactosData({
  userId,
  searchQuery = "",
  selectedContactId = "",
  agentFilterId = "",
  reportRangeDays,
  page,
  includeReport = false,
}: ContactosQuery): Promise<ContactosData | null> {
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      workspace: {
        select: {
          id: true,
          name: true,
          businessConfig: true,
        },
      },
    },
  });

  if (!membership) {
    return null;
  }

  const query = normalize(searchQuery);
  const agentId = agentFilterId.trim();
  const normalizedReportRangeDays = normalizeReportRangeDays(reportRangeDays);
  const requestedPage = normalizeContactPage(page);
  const contactWhere = buildContactWhere({
    workspaceId: membership.workspace.id,
    query,
    agentId,
  });
  const autoTagNewLeads =
    typeof membership.workspace.businessConfig === "object" &&
    membership.workspace.businessConfig !== null &&
    !Array.isArray(membership.workspace.businessConfig) &&
    (membership.workspace.businessConfig as { autoTagNewLeads?: unknown }).autoTagNewLeads !== false;
  const newLeadTagName =
    typeof membership.workspace.businessConfig === "object" &&
    membership.workspace.businessConfig !== null &&
    !Array.isArray(membership.workspace.businessConfig) &&
    typeof (membership.workspace.businessConfig as { newLeadTagName?: unknown }).newLeadTagName === "string"
      ? ((membership.workspace.businessConfig as { newLeadTagName?: string }).newLeadTagName ?? "").trim()
      : "";

  const [totalContacts, withConversations, withEmail, reportContacts] = await Promise.all([
    prisma.contact.count({
      where: contactWhere,
    }),
    prisma.contact.count({
      where: agentId
        ? contactWhere
        : {
            ...contactWhere,
            conversations: {
              some: {},
            },
          },
    }),
    prisma.contact.count({
      where: {
        ...contactWhere,
        AND: [
          {
            email: {
              not: null,
            },
          },
          {
            email: {
              not: "",
            },
          },
        ],
      },
    }),
    includeReport
      ? prisma.contact.findMany({
          where: contactWhere,
          select: {
            createdAt: true,
          },
        })
      : Promise.resolve([] as Array<{ createdAt: Date }>),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalContacts / CONTACTS_PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);

  const loadContacts = async () =>
    prisma.contact.findMany({
      where: contactWhere,
      orderBy: [{ updatedAt: "desc" }],
      skip: (currentPage - 1) * CONTACTS_PAGE_SIZE,
      take: CONTACTS_PAGE_SIZE,
      select: buildContactSelect(agentId),
    });

  let rawContacts = await loadContacts();

  const contactIds = rawContacts.map((contact) => contact.id);
  const outboundRows =
    contactIds.length > 0
      ? await prisma.$queryRaw<Array<{ contactId: string; outboundCount: number }>>`
          SELECT
            m."contactId" AS "contactId",
            COUNT(*)::int AS "outboundCount"
          FROM "Message" m
          WHERE m."workspaceId" = ${membership.workspace.id}
            AND m."contactId" IN (${Prisma.join(contactIds)})
            AND m."direction" = 'OUTBOUND'
          GROUP BY m."contactId"
        `
      : [];
  const outboundCountByContactId = new Map<string, number>();
  for (const row of outboundRows) {
    outboundCountByContactId.set(row.contactId, row.outboundCount);
  }

  if (autoTagNewLeads && rawContacts.length > 0) {
    await Promise.all(
      rawContacts.map((contact) =>
        syncLeadLifecycleForContact({
          workspaceId: membership.workspace.id,
          contactId: contact.id,
          newLeadTagName,
          hasHistory: (outboundCountByContactId.get(contact.id) ?? 0) > 0,
        }),
      ),
    );

    rawContacts = await loadContacts();
  }

  const contacts: ContactosContact[] = rawContacts
    .map((contact) => ({
      id: contact.id,
      name: contact.name,
      phoneNumber: contact.phoneNumber,
      email: contact.email,
      notes: contact.notes,
      avatarUrl: contact.avatarUrl,
      tags: getContactTags(contact.ContactTag.map((item) => item.Tag)),
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
      totalConversations: contact._count.conversations,
      totalMessages: contact._count.messages,
      lastActivityAt: contact.conversations[0]?.lastMessageAt?.toISOString() ?? null,
      latestMatch: contact.contactMatches[0]
        ? {
            id: contact.contactMatches[0].id,
            matchType: contact.contactMatches[0].matchType,
            sourceType: contact.contactMatches[0].sourceType,
            targetName: contact.contactMatches[0].targetName,
            detectedAt: contact.contactMatches[0].detectedAt.toISOString(),
            tag: contact.contactMatches[0].tag
              ? {
                  id: contact.contactMatches[0].tag.id,
                  name: contact.contactMatches[0].tag.name,
                  color: contact.contactMatches[0].tag.color,
                }
              : null,
          }
        : null,
      matchHistory: contact.contactMatches.map((match) => ({
        id: match.id,
        matchType: match.matchType,
        sourceType: match.sourceType,
        targetName: match.targetName,
        detectedAt: match.detectedAt.toISOString(),
        tag: match.tag
          ? {
              id: match.tag.id,
              name: match.tag.name,
              color: match.tag.color,
            }
          : null,
      })),
      recentConversations: contact.conversations.map((conversation) => ({
        id: conversation.id,
        status: conversation.status,
        automationPaused: conversation.automationPaused,
        lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
        startedAt: conversation.startedAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
        agent: conversation.agent,
        channel: conversation.channel,
        lastMessage: conversation.messages[0]
          ? {
              content: conversation.messages[0].content,
              createdAt: conversation.messages[0].createdAt.toISOString(),
              direction: conversation.messages[0].direction,
              type: conversation.messages[0].type,
            }
          : null,
      })),
    }))
    .filter((contact) => {
      if (!query) {
        return true;
      }

      const haystack = [contact.name, contact.phoneNumber, contact.email, contact.notes]
        .filter(Boolean)
        .map((value) => normalize(value))
        .join(" ");

      return haystack.includes(query);
    })
    .sort((left, right) => getContactLastActivity(right) - getContactLastActivity(left));

  const dailyCreationStats = includeReport
    ? Object.values(
        reportContacts.reduce<Record<string, { dayKey: string; label: string; count: number; firstCreatedAt: string; lastCreatedAt: string }>>(
          (acc, contact) => {
            const createdAt = new Date(contact.createdAt);
            const dayKey = getBogotaDayKey(createdAt);
            const current = acc[dayKey];

            if (!current) {
              acc[dayKey] = {
                dayKey,
                label: getBogotaDateLabel(createdAt),
                count: 1,
                firstCreatedAt: createdAt.toISOString(),
                lastCreatedAt: createdAt.toISOString(),
              };
              return acc;
            }

            const currentFirst = new Date(current.firstCreatedAt);
            const currentLast = new Date(current.lastCreatedAt);
            acc[dayKey] = {
              ...current,
              count: current.count + 1,
              firstCreatedAt: createdAt < currentFirst ? createdAt.toISOString() : current.firstCreatedAt,
              lastCreatedAt: createdAt > currentLast ? createdAt.toISOString() : current.lastCreatedAt,
            };
            return acc;
          },
          {},
        ),
      ).sort((left, right) => right.dayKey.localeCompare(left.dayKey))
    : [];

  const heatmapDays = includeReport ? buildBogotaHeatmapWindow(normalizedReportRangeDays) : [];
  const creationHeatmapRows = includeReport
    ? heatmapDays.map((dayValue) => {
        const dayKey = getBogotaDayKey(dayValue);
        const dayContacts = reportContacts.filter((contact) => getBogotaDayKey(new Date(contact.createdAt)) === dayKey);
        const hours = Array.from({ length: 24 }, (_, hour) => {
          const count = dayContacts.filter((contact) => getBogotaHourKey(new Date(contact.createdAt)) === hour).length;
          return {
            hour,
            count,
          };
        });

        return {
          dayKey,
          dayLabel: getBogotaShortWeekday(dayValue),
          dateLabel: getBogotaDateLabel(dayValue),
          total: dayContacts.length,
          hours,
        };
      })
    : [];
  const creationHeatmapMaxCount = includeReport
    ? Math.max(
        0,
        ...creationHeatmapRows.flatMap((row) => row.hours.map((hour) => hour.count)),
      )
    : 0;

  const stats = {
    total: totalContacts,
    withConversations,
    withoutConversations: totalContacts - withConversations,
    withEmail,
  };

  const selectedContactInPage =
    contacts.find((contact) => contact.id === selectedContactId) ||
    null;

  const selectedContactFromQuery =
    !selectedContactInPage && selectedContactId
      ? await prisma.contact.findFirst({
          where: {
            ...contactWhere,
            id: selectedContactId,
          },
          select: buildContactSelect(agentId),
        })
      : null;

  const selectedContact =
    selectedContactInPage ||
    selectedContactFromQuery ||
    contacts[0] ||
    null;

  let agentFilterName: string | null = null;
  if (agentId) {
    const agent = await prisma.agent.findFirst({
      where: {
        id: agentId,
        workspaceId: membership.workspace.id,
      },
      select: {
        name: true,
      },
    });

    agentFilterName = agent?.name ?? null;
  }

  return {
    workspaceId: membership.workspace.id,
    workspaceName: membership.workspace.name,
    searchQuery,
    agentFilterId: agentId || null,
    agentFilterName,
    reportRangeDays: normalizedReportRangeDays,
    pagination: {
      page: currentPage,
      pageSize: CONTACTS_PAGE_SIZE,
      total: totalContacts,
      totalPages,
      rangeStart: totalContacts === 0 ? 0 : (currentPage - 1) * CONTACTS_PAGE_SIZE + 1,
      rangeEnd: totalContacts === 0 ? 0 : (currentPage - 1) * CONTACTS_PAGE_SIZE + contacts.length,
      hasPreviousPage: currentPage > 1,
      hasNextPage: currentPage < totalPages,
    },
    stats,
    dailyCreationStats,
    creationHeatmap: {
      maxCount: creationHeatmapMaxCount,
      days: creationHeatmapRows,
    },
    contacts,
    selectedContactId: selectedContact?.id ?? null,
    selectedContact,
  };
}
