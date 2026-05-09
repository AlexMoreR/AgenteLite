import { prisma } from "@/lib/prisma";

type EvolutionGhostChatCandidate = {
  conversationId: string;
  contactId: string;
  phoneNumber: string;
  messagesCount: number;
  createdAt: Date;
  lastMessageAt: Date | null;
  workspaceId: string;
  channelId: string | null;
};

type EvolutionGhostChatCleanupResult = {
  candidates: EvolutionGhostChatCandidate[];
  deletedConversationIds: string[];
  deletedContactIds: string[];
};

function normalizePhoneNumber(phoneNumber: string): string {
  return phoneNumber.replace(/\D/g, "");
}

function isLikelyGhostEvolutionPhone(phoneNumber: string): boolean {
  const digits = normalizePhoneNumber(phoneNumber);
  if (!digits) {
    return false;
  }

  if (digits.startsWith("120363")) {
    return false;
  }

  return digits.length > 13;
}

export async function findEvolutionGhostChatCandidates(workspaceId: string): Promise<EvolutionGhostChatCandidate[]> {
  const conversations = await prisma.conversation.findMany({
    where: {
      workspaceId,
      channel: {
        provider: "EVOLUTION",
      },
    },
    select: {
      id: true,
      contactId: true,
      channelId: true,
      workspaceId: true,
      createdAt: true,
      lastMessageAt: true,
      contact: {
        select: {
          phoneNumber: true,
        },
      },
      _count: {
        select: {
          messages: true,
        },
      },
    },
  });

  return conversations
    .filter((conversation) => {
      const phoneNumber = conversation.contact.phoneNumber;
      const messagesCount = conversation._count.messages;

      return messagesCount === 0 || (messagesCount <= 1 && isLikelyGhostEvolutionPhone(phoneNumber));
    })
    .map((conversation) => ({
      conversationId: conversation.id,
      contactId: conversation.contactId,
      phoneNumber: conversation.contact.phoneNumber,
      messagesCount: conversation._count.messages,
      createdAt: conversation.createdAt,
      lastMessageAt: conversation.lastMessageAt,
      workspaceId: conversation.workspaceId,
      channelId: conversation.channelId,
    }));
}

export async function clearEvolutionGhostChats(workspaceId: string): Promise<EvolutionGhostChatCleanupResult> {
  const candidates = await findEvolutionGhostChatCandidates(workspaceId);

  if (candidates.length === 0) {
    return {
      candidates,
      deletedConversationIds: [],
      deletedContactIds: [],
    };
  }

  const candidateConversationIds = candidates.map((candidate) => candidate.conversationId);
  const candidateContactIds = [...new Set(candidates.map((candidate) => candidate.contactId))];

  const result = await prisma.$transaction(async (tx) => {
    await tx.conversation.deleteMany({
      where: {
        id: {
          in: candidateConversationIds,
        },
      },
    });

    const remainingContacts = await tx.contact.findMany({
      where: {
        id: {
          in: candidateContactIds,
        },
        conversations: {
          none: {},
        },
        messages: {
          none: {},
        },
      },
      select: {
        id: true,
      },
    });

    const deletedContactIds = remainingContacts.map((contact) => contact.id);

    if (deletedContactIds.length > 0) {
      await tx.contact.deleteMany({
        where: {
          id: {
            in: deletedContactIds,
          },
        },
      });
    }

    return {
      candidates,
      deletedConversationIds: candidateConversationIds,
      deletedContactIds,
    };
  });

  return result;
}
