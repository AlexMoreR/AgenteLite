import { prisma } from "@/lib/prisma";
import type { ContactosContact, ContactosData } from "../types";

type ContactosQuery = {
  userId: string;
  searchQuery?: string;
  selectedContactId?: string;
  agentFilterId?: string;
};

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function getContactLastActivity(contact: Pick<ContactosContact, "lastActivityAt" | "updatedAt">) {
  return contact.lastActivityAt ? new Date(contact.lastActivityAt).getTime() : new Date(contact.updatedAt).getTime();
}

export async function getContactosData({
  userId,
  searchQuery = "",
  selectedContactId = "",
  agentFilterId = "",
}: ContactosQuery): Promise<ContactosData | null> {
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

  const query = normalize(searchQuery);
  const agentId = agentFilterId.trim();

  const rawContacts = await prisma.contact.findMany({
    where: {
      workspaceId: membership.workspace.id,
      ...(agentId
        ? {
            conversations: {
              some: {
                agentId,
              },
            },
          }
        : {}),
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 250,
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      email: true,
      notes: true,
      avatarUrl: true,
      createdAt: true,
      updatedAt: true,
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
    },
  });

  const contacts: ContactosContact[] = rawContacts
    .map((contact) => ({
      id: contact.id,
      name: contact.name,
      phoneNumber: contact.phoneNumber,
      email: contact.email,
      notes: contact.notes,
      avatarUrl: contact.avatarUrl,
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
      totalConversations: contact._count.conversations,
      totalMessages: contact._count.messages,
      lastActivityAt: contact.conversations[0]?.lastMessageAt?.toISOString() ?? null,
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

  const stats = {
    total: contacts.length,
    withConversations: contacts.filter((contact) => contact.totalConversations > 0).length,
    withoutConversations: contacts.filter((contact) => contact.totalConversations === 0).length,
    withEmail: contacts.filter((contact) => Boolean(contact.email?.trim())).length,
  };

  const selectedContact =
    contacts.find((contact) => contact.id === selectedContactId) ||
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
    stats,
    contacts,
    selectedContactId: selectedContact?.id ?? null,
    selectedContact,
  };
}
