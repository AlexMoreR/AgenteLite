import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildActiveProductContextNote, type ActiveProductContext } from "@/lib/agent-product-flow";
import { buildFlowExecutionContextNote } from "@/lib/flow-execution-history";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

function normalizeFileNamePart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getContactLabel(contact: { name: string | null; phoneNumber: string }) {
  return contact.name?.trim() || contact.phoneNumber;
}

function buildExportFileName(contact: { name: string | null; phoneNumber: string }) {
  const label = normalizeFileNamePart(getContactLabel(contact)) || "contacto";
  const day = new Date().toISOString().slice(0, 10);
  return `ejecucion-${label}-${day}.json`;
}

function getExportMode(request: Request) {
  const mode = new URL(request.url).searchParams.get("mode")?.trim().toLowerCase();
  return mode === "simple" ? "simple" : "full";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ contactId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { contactId } = await context.params;
  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return NextResponse.json({ error: "Workspace no encontrado" }, { status: 404 });
  }

  const contact = await prisma.contact.findFirst({
    where: {
      id: contactId,
      workspaceId: membership.workspace.id,
    },
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      email: true,
      notes: true,
      avatarUrl: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
      ContactTag: {
        select: {
          Tag: {
            select: {
              id: true,
              name: true,
              color: true,
            },
          },
        },
      },
      contactMatches: {
        orderBy: { detectedAt: "asc" },
        select: {
          id: true,
          matchType: true,
          sourceType: true,
          targetId: true,
          targetName: true,
          targetSlug: true,
          confidence: true,
          detectedAt: true,
          createdAt: true,
          updatedAt: true,
          conversationId: true,
          tag: {
            select: {
              id: true,
              name: true,
              color: true,
            },
          },
        },
      },
      conversations: {
        orderBy: [{ createdAt: "asc" }, { updatedAt: "asc" }],
        select: {
          id: true,
          status: true,
          lastMessageAt: true,
          startedAt: true,
          closedAt: true,
          createdAt: true,
          updatedAt: true,
          automationPaused: true,
          automationPausedAt: true,
          activeProductContext: true,
          agent: {
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              systemPrompt: true,
              welcomeMessage: true,
              fallbackMessage: true,
              handoffMessage: true,
              model: true,
              temperature: true,
              maxTokens: true,
              trainingConfig: true,
              reactivationMessage: true,
            },
          },
          channel: {
            select: {
              id: true,
              name: true,
              provider: true,
              phoneNumber: true,
              evolutionInstanceName: true,
            },
          },
          messages: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              externalId: true,
              direction: true,
              type: true,
              status: true,
              content: true,
              mediaUrl: true,
              rawPayload: true,
              sentAt: true,
              deliveredAt: true,
              readAt: true,
              failedAt: true,
              createdAt: true,
              updatedAt: true,
              editedAt: true,
              deletedAt: true,
              agentId: true,
              channelId: true,
              contactId: true,
            },
          },
        },
      },
    },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  }

  const exportMode = getExportMode(request);

  const advancedExportData = {
    exportType: "contact_execution_history",
    exportMode,
    exportedAt: new Date().toISOString(),
    workspace: {
      id: membership.workspace.id,
      name: membership.workspace.name,
    },
    contact: {
      id: contact.id,
      name: contact.name,
      phoneNumber: contact.phoneNumber,
      email: contact.email,
      notes: contact.notes,
      avatarUrl: contact.avatarUrl,
      metadata: contact.metadata ?? null,
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
      tags: contact.ContactTag.map((item) => item.Tag),
    },
    contactMatches: contact.contactMatches.map((match) => ({
      id: match.id,
      matchType: match.matchType,
      sourceType: match.sourceType,
      targetId: match.targetId,
      targetName: match.targetName,
      targetSlug: match.targetSlug,
      confidence: match.confidence,
      detectedAt: match.detectedAt.toISOString(),
      createdAt: match.createdAt.toISOString(),
      updatedAt: match.updatedAt.toISOString(),
      conversationId: match.conversationId,
      tag: match.tag,
    })),
    conversations: contact.conversations.map((conversation) => {
      const flowMatches = contact.contactMatches.filter(
        (match) => match.conversationId === conversation.id && match.matchType === "FLOW",
      );
      const productMatches = contact.contactMatches.filter(
        (match) => match.conversationId === conversation.id && match.matchType === "PRODUCT",
      );
      const activeProductContext = conversation.activeProductContext as ActiveProductContext | null;

      return {
        id: conversation.id,
        status: conversation.status,
        lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
        startedAt: conversation.startedAt.toISOString(),
        closedAt: conversation.closedAt?.toISOString() ?? null,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
        automationPaused: conversation.automationPaused,
        automationPausedAt: conversation.automationPausedAt?.toISOString() ?? null,
        activeProductContext,
        contextNotes: [
          buildActiveProductContextNote(activeProductContext),
          ...flowMatches
            .map((match) => buildFlowExecutionContextNote({ flowTitle: match.targetName, modeLabel: "flujo" }))
            .filter(Boolean),
        ],
        agent: conversation.agent
          ? {
              id: conversation.agent.id,
              name: conversation.agent.name,
              slug: conversation.agent.slug,
              description: conversation.agent.description,
              systemPrompt: conversation.agent.systemPrompt,
              welcomeMessage: conversation.agent.welcomeMessage,
              fallbackMessage: conversation.agent.fallbackMessage,
              handoffMessage: conversation.agent.handoffMessage,
              model: conversation.agent.model,
              temperature: conversation.agent.temperature,
              maxTokens: conversation.agent.maxTokens,
              trainingConfig: conversation.agent.trainingConfig ?? null,
              reactivationMessage: conversation.agent.reactivationMessage,
            }
          : null,
        channel: conversation.channel
          ? {
              id: conversation.channel.id,
              name: conversation.channel.name,
              provider: conversation.channel.provider,
              phoneNumber: conversation.channel.phoneNumber,
              evolutionInstanceName: conversation.channel.evolutionInstanceName,
            }
          : null,
        productMatches: productMatches.map((match) => ({
          id: match.id,
          targetId: match.targetId,
          targetName: match.targetName,
          targetSlug: match.targetSlug,
          confidence: match.confidence,
          detectedAt: match.detectedAt.toISOString(),
          sourceType: match.sourceType,
        })),
        flowMatches: flowMatches.map((match) => ({
          id: match.id,
          targetId: match.targetId,
          targetName: match.targetName,
          targetSlug: match.targetSlug,
          confidence: match.confidence,
          detectedAt: match.detectedAt.toISOString(),
          sourceType: match.sourceType,
        })),
        messages: conversation.messages.map((message) => ({
          id: message.id,
          externalId: message.externalId,
          direction: message.direction,
          type: message.type,
          status: message.status,
          content: message.content,
          mediaUrl: message.mediaUrl,
          rawPayload: message.rawPayload,
          sentAt: message.sentAt?.toISOString() ?? null,
          deliveredAt: message.deliveredAt?.toISOString() ?? null,
          readAt: message.readAt?.toISOString() ?? null,
          failedAt: message.failedAt?.toISOString() ?? null,
          createdAt: message.createdAt.toISOString(),
          updatedAt: message.updatedAt.toISOString(),
          editedAt: message.editedAt?.toISOString() ?? null,
          deletedAt: message.deletedAt?.toISOString() ?? null,
          agentId: message.agentId,
          channelId: message.channelId,
          contactId: message.contactId,
        })),
      };
    }),
  };

  const simpleExportData = {
    exportType: "contact_execution_history",
    exportMode,
    exportedAt: new Date().toISOString(),
    workspace: {
      id: membership.workspace.id,
      name: membership.workspace.name,
    },
    contact: {
      id: contact.id,
      name: contact.name,
      phoneNumber: contact.phoneNumber,
    },
    conversations: contact.conversations.map((conversation) => {
      const flowMatches = contact.contactMatches.filter(
        (match) => match.conversationId === conversation.id && match.matchType === "FLOW",
      );
      const productMatches = contact.contactMatches.filter(
        (match) => match.conversationId === conversation.id && match.matchType === "PRODUCT",
      );
      const activeProductContext = conversation.activeProductContext as ActiveProductContext | null;

      return {
        id: conversation.id,
        status: conversation.status,
        lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
        startedAt: conversation.startedAt.toISOString(),
        automationPaused: conversation.automationPaused,
        activeProductContext: activeProductContext
          ? {
              productName: activeProductContext.productName,
              followUpFlowId: activeProductContext.followUpFlowId,
            }
          : null,
        prompt: conversation.agent?.systemPrompt ?? null,
        messages: conversation.messages.map((message) => ({
          direction: message.direction,
          type: message.type,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
        })),
        productMatches: productMatches.map((match) => ({
          targetName: match.targetName,
          targetSlug: match.targetSlug,
          detectedAt: match.detectedAt.toISOString(),
        })),
        flowMatches: flowMatches.map((match) => ({
          targetName: match.targetName,
          targetSlug: match.targetSlug,
          detectedAt: match.detectedAt.toISOString(),
        })),
      };
    }),
  };

  const timeline = contact.conversations.flatMap((conversation) => {
    const flowMatches = contact.contactMatches.filter(
      (match) => match.conversationId === conversation.id && match.matchType === "FLOW",
    );
    const productMatches = contact.contactMatches.filter(
      (match) => match.conversationId === conversation.id && match.matchType === "PRODUCT",
    );

    return [
      ...conversation.messages.map((message) => ({
        kind: "message" as const,
        conversationId: conversation.id,
        at: message.createdAt.toISOString(),
        payload: {
          id: message.id,
          direction: message.direction,
          type: message.type,
          status: message.status,
          content: message.content,
          mediaUrl: message.mediaUrl,
          rawPayload: message.rawPayload,
        },
      })),
      ...productMatches.map((match) => ({
        kind: "match" as const,
        matchType: match.matchType,
        conversationId: conversation.id,
        at: match.detectedAt.toISOString(),
        payload: {
          id: match.id,
          sourceType: match.sourceType,
          targetId: match.targetId,
          targetName: match.targetName,
          targetSlug: match.targetSlug,
          confidence: match.confidence,
          tag: match.tag,
        },
      })),
      ...flowMatches.map((match) => ({
        kind: "match" as const,
        matchType: match.matchType,
        conversationId: conversation.id,
        at: match.detectedAt.toISOString(),
        payload: {
          id: match.id,
          sourceType: match.sourceType,
          targetId: match.targetId,
          targetName: match.targetName,
          targetSlug: match.targetSlug,
          confidence: match.confidence,
          tag: match.tag,
        },
      })),
    ];
  }).sort((left, right) => {
    const diff = new Date(left.at).getTime() - new Date(right.at).getTime();
    if (diff !== 0) return diff;
    return left.kind.localeCompare(right.kind);
  });

  const fileName = buildExportFileName(contact);
  const payload = exportMode === "simple"
    ? simpleExportData
    : {
        ...advancedExportData,
        timeline,
      };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
