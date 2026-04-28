import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { generateAgentReply } from "@/lib/agent-ai";
import { resolveAgentProductFlowReply } from "@/lib/agent-product-flow";
import { composeAgentWelcomeReply } from "@/lib/agent-reply-composer";
import { getConversationAutomationPaused, setConversationAutomationPaused } from "@/lib/conversation-automation";
import { prisma } from "@/lib/prisma";
import { resolveEvolutionQuickResponseFlow } from "@/features/flows/services/resolveEvolutionQuickResponseFlow";
import {
  extractEvolutionConnectionState,
  extractEvolutionEventName,
  extractEvolutionFromMe,
  extractEvolutionInstanceName,
  extractEvolutionMessageId,
  extractEvolutionMessageText,
  extractEvolutionMessageType,
  extractEvolutionMediaUrl,
  extractEvolutionPairingCode,
  extractEvolutionPhoneNumber,
  extractEvolutionQrCode,
  extractEvolutionRemoteJid,
  isInboundMessageEvent,
  normalizePhoneFromJid,
} from "@/lib/evolution-webhook";
import {
  ensureEvolutionInstanceReady,
  sendEvolutionImageMessage,
  sendEvolutionPresence,
  sendEvolutionTextMessageWithReconnect,
} from "@/lib/evolution";
import { resolveAgentKnowledgeBaseReply } from "@/lib/agent-knowledge-media";
import { enforceWorkspacePlanAccess } from "@/lib/workspace-plan-access";
import { getEvolutionSettings } from "@/lib/system-settings";
import { buildHandoffMessage } from "@/lib/agent-training";
import { resolveNotifyHumanAction } from "@/features/agent-actions";

function mapChannelStatus(eventName: string | null, rawState: string | null) {
  const state = rawState?.toLowerCase() ?? "";

  if (eventName === "QRCODE_UPDATED") {
    return "QRCODE" as const;
  }

  if (["open", "connected", "connection_open", "online"].includes(state)) {
    return "CONNECTED" as const;
  }

  if (["close", "closed", "disconnected", "connection_close", "offline"].includes(state)) {
    return "DISCONNECTED" as const;
  }

  if (["connecting", "starting", "syncing"].includes(state)) {
    return "CONNECTING" as const;
  }

  return null;
}

function buildInboundExternalId(input: {
  messageExternalId: string | null;
  eventName: string | null;
  instanceName: string | null;
  remoteJid: string | null;
  messageText: string | null;
  payload: unknown;
}) {
  if (input.messageExternalId) {
    return input.messageExternalId;
  }

  // Keep retries idempotent even when the provider omits a message id.
  return createHash("sha256")
    .update(
      JSON.stringify({
        eventName: input.eventName,
        instanceName: input.instanceName,
        remoteJid: input.remoteJid,
        messageText: input.messageText,
        payload: input.payload,
      }),
    )
    .digest("hex");
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);

  if (!payload) {
    return NextResponse.json({ ok: false, message: "Invalid JSON payload" }, { status: 400 });
  }

  const settings = await getEvolutionSettings();
  const providedSecret =
    request.headers.get("x-webhook-secret") ||
    request.headers.get("x-evolution-secret") ||
    request.headers.get("authorization");

  if (settings.webhookSecret) {
    const normalizedSecret = providedSecret?.replace(/^Bearer\s+/i, "").trim();
    if (normalizedSecret !== settings.webhookSecret) {
      return NextResponse.json({ ok: false, message: "Unauthorized webhook" }, { status: 401 });
    }
  }

  const eventName = extractEvolutionEventName(payload);
  const instanceName = extractEvolutionInstanceName(payload);
  const channelPhoneNumber = normalizePhoneFromJid(extractEvolutionPhoneNumber(payload));
  const isConnectionEvent = eventName === "QRCODE_UPDATED" || eventName === "CONNECTION_UPDATE";

  let channel = instanceName
    ? await prisma.whatsAppChannel.findUnique({
        where: { evolutionInstanceName: instanceName },
        select: {
          id: true,
          workspaceId: true,
          agentId: true,
          name: true,
          isActive: true,
          evolutionInstanceName: true,
          status: true,
          phoneNumber: true,
          qrCode: true,
        },
      })
    : null;

  if (!channel && channelPhoneNumber) {
    channel = await prisma.whatsAppChannel.findFirst({
      where: {
        provider: "EVOLUTION",
        phoneNumber: channelPhoneNumber,
      },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        workspaceId: true,
        agentId: true,
        name: true,
        isActive: true,
        evolutionInstanceName: true,
        status: true,
        phoneNumber: true,
        qrCode: true,
      },
    });
  }

  await prisma.webhookEventLog.create({
    data: {
      provider: "EVOLUTION",
      event: eventName,
      instanceName,
      channelId: channel?.id ?? null,
      workspaceId: channel?.workspaceId ?? null,
      status: channel ? "matched" : "unmatched",
      payload: payload as never,
    },
  });

  if (!channel) {
    console.warn("[EVOLUTION] channel_not_found", {
      eventName,
      instanceName,
      channelPhoneNumber,
    });
    return NextResponse.json({
      ok: true,
      message: "Webhook received but no matching channel was found",
      instanceName,
      event: eventName,
    });
  }

  if (isConnectionEvent) {
    const qrCode = extractEvolutionQrCode(payload);
    const pairingCode = extractEvolutionPairingCode(payload);
    const phoneNumber = normalizePhoneFromJid(extractEvolutionPhoneNumber(payload));
    const nextStatus = mapChannelStatus(eventName, extractEvolutionConnectionState(payload));

    await prisma.whatsAppChannel.update({
      where: { id: channel.id },
      data: {
        ...(qrCode ? { qrCode, status: "QRCODE" } : {}),
        ...(phoneNumber ? { phoneNumber } : {}),
        ...(pairingCode ? { metadata: { pairingCode } } : {}),
        ...(nextStatus ? { status: nextStatus } : {}),
        ...(nextStatus === "CONNECTED"
          ? {
              lastConnectionAt: new Date(),
              qrCode: null,
            }
          : {}),
        ...(nextStatus === "DISCONNECTED"
          ? {
              lastDisconnectionAt: new Date(),
            }
          : {}),
      },
    });

    return NextResponse.json({
      ok: true,
      message: "Channel state updated",
      instanceName,
      event: eventName,
    });
  }

  if (!isInboundMessageEvent(eventName)) {
    return NextResponse.json({
      ok: true,
      message: "Event logged",
      instanceName,
      event: eventName,
    });
  }

  const remoteJid = extractEvolutionRemoteJid(payload);
  const phoneNumber = normalizePhoneFromJid(remoteJid);
  const messageText = extractEvolutionMessageText(payload);
  const messageType = extractEvolutionMessageType(payload);
  const mediaUrl = extractEvolutionMediaUrl(payload);
  const messageExternalId = extractEvolutionMessageId(payload);
  const inboundExternalId = buildInboundExternalId({
    messageExternalId,
    eventName,
    instanceName,
    remoteJid,
    messageText,
    payload,
  });
  const fromMe = extractEvolutionFromMe(payload);

  console.log("[EVOLUTION] inbound_candidate", {
    eventName,
    instanceName,
    channelId: channel.id,
    fromMe,
    phoneNumber,
    hasMessageText: Boolean(messageText?.trim()),
    messageType,
    hasMediaUrl: Boolean(mediaUrl),
    messageExternalId: inboundExternalId,
  });

  if (!phoneNumber) {
    console.log("[EVOLUTION] inbound_skipped", {
      reason: "missing_phone",
      eventName,
      instanceName,
    });
    return NextResponse.json({
      ok: true,
      message: "Inbound event logged without identifiable phone number",
      instanceName,
      event: eventName,
    });
  }

  const contact = await prisma.contact.upsert({
    where: {
      workspaceId_phoneNumber: {
        workspaceId: channel.workspaceId,
        phoneNumber,
      },
    },
    update: {},
    create: {
      workspaceId: channel.workspaceId,
      phoneNumber,
    },
    select: { id: true, name: true, phoneNumber: true },
  });

  const existingConversation = await prisma.conversation.findFirst({
    where: {
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      contactId: contact.id,
    },
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      id: true,
      status: true,
    },
  });

  const conversation = existingConversation
    ? { id: existingConversation.id }
    : await prisma.conversation.create({
        data: {
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          agentId: channel.agentId ?? null,
          contactId: contact.id,
          status: "OPEN",
          lastMessageAt: new Date(),
        },
        select: { id: true },
      });

  if (existingConversation && !["OPEN", "PENDING"].includes(existingConversation.status)) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: "OPEN",
        lastMessageAt: new Date(),
      },
    });
  }
  const conversationAutomationPaused = await getConversationAutomationPaused({
    conversationId: conversation.id,
    workspaceId: channel.workspaceId,
  });

  try {
    await prisma.message.create({
      data: {
        workspaceId: channel.workspaceId,
        conversationId: conversation.id,
        channelId: channel.id,
        contactId: contact.id,
        agentId: channel.agentId ?? null,
        externalId: inboundExternalId,
        direction: fromMe ? "OUTBOUND" : "INBOUND",
        type: messageType,
        status: fromMe ? "SENT" : "RECEIVED",
        content: messageText,
        mediaUrl,
        rawPayload: {
          source: fromMe ? "instance" : "webhook",
          evolution: payload,
        } as never,
        ...(fromMe ? { sentAt: new Date() } : {}),
      },
    });
  } catch (error) {
    const isDuplicateMessage =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002";

    if (isDuplicateMessage) {
      console.log("[EVOLUTION] inbound_duplicate_ignored", {
        eventName,
        instanceName,
        channelId: channel.id,
        conversationId: conversation.id,
        externalId: inboundExternalId,
      });

      return NextResponse.json({
        ok: true,
        message: fromMe ? "Duplicate outbound/self event ignored" : "Duplicate inbound event ignored",
        instanceName,
        event: eventName,
      });
    }

    throw error;
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: new Date(),
      status: "OPEN",
    },
  });

  const inboundMessageCountRows = await prisma.$queryRaw<Array<{ total: bigint | number }>>`
    SELECT COUNT(*)::bigint AS "total"
    FROM "Message"
    WHERE "conversationId" = ${conversation.id}
      AND "direction" = 'INBOUND'::"MessageDirection"
  `;
  const inboundMessageCount = Number(inboundMessageCountRows[0]?.total ?? 0);

  console.log("[EVOLUTION] inbound_saved", {
    conversationId: conversation.id,
    contactId: contact.id,
    agentId: channel.agentId,
    phoneNumber,
    direction: fromMe ? "OUTBOUND" : "INBOUND",
  });

  if (fromMe && channel.agentId && channel.isActive && channel.evolutionInstanceName && messageText) {
    const ownerTriggeredFlow = await resolveEvolutionQuickResponseFlow({
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      manualMessage: messageText,
    });

    if (ownerTriggeredFlow) {
      console.log("[EVOLUTION] owner_triggered_flow", {
        conversationId: conversation.id,
        agentId: channel.agentId,
        keyword: ownerTriggeredFlow.keyword,
        scenarioTitle: ownerTriggeredFlow.scenarioTitle,
        phoneNumber,
      });

      try {
        await sendEvolutionPresence({
          instanceName: channel.evolutionInstanceName,
          phoneNumber,
          presence: "composing",
          delay: 800,
        }).catch(() => null);

        if (ownerTriggeredFlow.reply.image) {
          const imageOutbound = await sendEvolutionImageMessage({
            instanceName: channel.evolutionInstanceName,
            phoneNumber,
            imageUrl: ownerTriggeredFlow.reply.image.url,
            caption: ownerTriggeredFlow.reply.image.caption,
            delayMs: 0,
          });
          await prisma.message.create({
            data: {
              workspaceId: channel.workspaceId,
              conversationId: conversation.id,
              channelId: channel.id,
              contactId: contact.id,
              agentId: channel.agentId,
              externalId: imageOutbound.externalId,
              direction: "OUTBOUND",
              type: "IMAGE",
              status: "SENT",
              content: ownerTriggeredFlow.reply.image.caption,
              mediaUrl: ownerTriggeredFlow.reply.image.url,
              sentAt: new Date(),
              rawPayload: imageOutbound.raw as never,
            },
          });
        }

        if (ownerTriggeredFlow.reply.text) {
          const textOutbound = await sendEvolutionTextMessageWithReconnect({
            instanceName: channel.evolutionInstanceName,
            phoneNumber,
            text: ownerTriggeredFlow.reply.text,
            delayMs: 0,
          });
          await prisma.message.create({
            data: {
              workspaceId: channel.workspaceId,
              conversationId: conversation.id,
              channelId: channel.id,
              contactId: contact.id,
              agentId: channel.agentId,
              externalId: textOutbound.externalId,
              direction: "OUTBOUND",
              type: "TEXT",
              status: "SENT",
              content: ownerTriggeredFlow.reply.text,
              sentAt: new Date(),
              rawPayload: textOutbound.raw as never,
            },
          });
        }
      } catch (error) {
        console.error("[EVOLUTION] owner_triggered_flow_failed", {
          conversationId: conversation.id,
          keyword: ownerTriggeredFlow.keyword,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return NextResponse.json({
        ok: true,
        message: "Owner-triggered flow executed",
        instanceName,
        event: eventName,
      });
    }
  }

  if (fromMe && channel.agentId) {
    await setConversationAutomationPaused({ conversationId: conversation.id, paused: true });
    console.log("[EVOLUTION] automation_paused_by_owner", {
      conversationId: conversation.id,
      agentId: channel.agentId,
      phoneNumber,
    });
  }

  if (!fromMe && channel.agentId) {
    const workspaceAccess = await enforceWorkspacePlanAccess(channel.workspaceId);

    if (workspaceAccess.planState.blockClientArea) {
      console.log("[EVOLUTION] auto_reply_skipped", {
        reason: "workspace_plan_expired",
        conversationId: conversation.id,
        agentId: channel.agentId,
        pausedAgents: workspaceAccess.pausedAgents,
      });

      return NextResponse.json({
        ok: true,
        message: "Inbound message logged but auto reply blocked by expired plan",
        instanceName,
        event: eventName,
      });
    }

    const agent = await prisma.agent.findUnique({
      where: { id: channel.agentId },
      select: {
        id: true,
        name: true,
        status: true,
        isActive: true,
        model: true,
        systemPrompt: true,
        welcomeMessage: true,
        fallbackMessage: true,
        trainingConfig: true,
      },
    });

    if (!agent) {
      console.warn("[EVOLUTION] agent_not_found", {
        channelId: channel.id,
        agentId: channel.agentId,
      });
      return NextResponse.json({
        ok: true,
        message: "Inbound message logged but no matching agent was found",
        instanceName,
        event: eventName,
      });
    }

    const responseDelaySeconds =
      agent.trainingConfig &&
      typeof agent.trainingConfig === "object" &&
      !Array.isArray(agent.trainingConfig) &&
      typeof (agent.trainingConfig as { responseDelaySeconds?: unknown }).responseDelaySeconds === "number" &&
      Number.isFinite((agent.trainingConfig as { responseDelaySeconds?: number }).responseDelaySeconds)
        ? Math.max(
            0,
            Math.min(120, Math.round((agent.trainingConfig as { responseDelaySeconds?: number }).responseDelaySeconds ?? 10)),
          )
        : 10;
    const responseDelayMs = responseDelaySeconds * 1000;

    console.log("[EVOLUTION] agent_loaded", {
      agentId: channel.agentId,
      exists: true,
      status: agent?.status,
      isActive: agent?.isActive,
      hasWelcomeMessage: Boolean(agent?.welcomeMessage),
      hasFallbackMessage: Boolean(agent?.fallbackMessage),
      hasSystemPrompt: Boolean(agent?.systemPrompt),
      model: agent?.model ?? null,
      responseDelaySeconds,
    });

      const quickResponseFlow = channel.isActive && !conversationAutomationPaused && channel.evolutionInstanceName && messageText
        ? await resolveEvolutionQuickResponseFlow({
            workspaceId: channel.workspaceId,
            channelId: channel.id,
            manualMessage: messageText,
          })
        : null;

      if (
        channel.isActive &&
        !conversationAutomationPaused &&
        channel.evolutionInstanceName &&
        messageText &&
        (quickResponseFlow || (agent?.isActive && agent.status === "ACTIVE"))
      ) {
      const existingOutbound = await prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          direction: "OUTBOUND",
        },
        select: { id: true },
      });

        let replyText: string | null = null;

      const recentMessages = await prisma.message.findMany({
        where: {
          conversationId: conversation.id,
        },
        orderBy: {
          createdAt: "asc",
        },
        take: 8,
        select: {
          direction: true,
          content: true,
        },
      });

      const notifyHumanAction = resolveNotifyHumanAction({
        trainingConfig: agent.trainingConfig,
        agentName: agent.name,
        customerPhoneNumber: phoneNumber,
        customerName: contact.name,
        latestUserMessage: messageText,
        history: recentMessages,
      });
      const notifyHumanPromise = notifyHumanAction && channel.evolutionInstanceName
        ? sendEvolutionTextMessageWithReconnect({
            instanceName: channel.evolutionInstanceName,
            phoneNumber: notifyHumanAction.destinationPhoneNumber,
            text: notifyHumanAction.message,
            delayMs: 0,
          }).catch((error) => {
            console.warn("[EVOLUTION] human_notification_failed", {
              conversationId: conversation.id,
              agentId: agent.id,
              phoneNumber,
              destinationPhoneNumber: notifyHumanAction.destinationPhoneNumber,
              error: error instanceof Error ? error.message : String(error),
            });
            return null;
          })
        : null;
      const shouldHandoffToHuman = Boolean(notifyHumanAction);

      if (shouldHandoffToHuman) {
        await setConversationAutomationPaused({ conversationId: conversation.id, paused: true });
      }

      const hardFlowReply = shouldHandoffToHuman || quickResponseFlow
        ? null
        : await resolveAgentProductFlowReply({
            agentId: agent.id,
            workspaceId: channel.workspaceId,
            latestUserMessage: messageText,
            history: recentMessages,
            includeOfficialApi: false,
          });

      const knowledgeBaseReply = hardFlowReply
        ? null
        : shouldHandoffToHuman
          ? null
          : await resolveAgentKnowledgeBaseReply({
              agentId: agent.id,
              latestUserMessage: messageText,
              history: recentMessages,
            });

      let shouldComposeWelcome = true;

      if (shouldHandoffToHuman) {
        replyText = buildHandoffMessage();
        shouldComposeWelcome = false;
      } else if (quickResponseFlow) {
        replyText = quickResponseFlow.reply.text ?? "";
        shouldComposeWelcome = Boolean(replyText);
      } else if (hardFlowReply) {
        replyText = hardFlowReply.reply ?? "";
      } else if (knowledgeBaseReply) {
        replyText = knowledgeBaseReply.text ?? null;
        shouldComposeWelcome = Boolean(replyText);
      } else {
        replyText = await generateAgentReply({
          model: agent.model,
          systemPrompt: agent.systemPrompt,
          fallbackMessage: agent.fallbackMessage,
          history: recentMessages,
          latestUserMessage: messageText,
        });
      }

      if (shouldComposeWelcome) {
        replyText = composeAgentWelcomeReply({
          welcomeMessage: agent.welcomeMessage,
          reply: replyText,
          // Usamos el historial saliente real como señal de primer contacto.
          // Eso evita volver a anteponer el saludo si la conversación ya tuvo una respuesta del bot.
          hasConversationHistory: inboundMessageCount > 1,
        });
      }

      console.log("[EVOLUTION] auto_reply_mode", {
        conversationId: conversation.id,
        agentId: agent.id,
        mode: shouldHandoffToHuman ? "handoff" : quickResponseFlow ? "quick_flow" : !existingOutbound ? "first_turn_ai" : "ai",
        hardFlow: shouldHandoffToHuman ? null : quickResponseFlow?.scenarioTitle ?? hardFlowReply?.flowTitle ?? null,
        usedFallback:
          replyText?.trim() === (agent.fallbackMessage?.trim() || "").trim(),
        historyCount: recentMessages.length,
      });

      const quickResponseImageReply = shouldHandoffToHuman ? null : quickResponseFlow?.reply.image ?? null;
      const hardFlowImageReply = shouldHandoffToHuman ? null : hardFlowReply?.image ?? null;
      const knowledgeImageReply = shouldHandoffToHuman ? null : knowledgeBaseReply?.image ?? null;
      const imageReply = quickResponseImageReply ?? hardFlowImageReply ?? knowledgeImageReply;
      const imageReplyProductName = quickResponseFlow?.scenarioTitle || hardFlowReply?.productName || knowledgeBaseReply?.productName || "";
      const imageReplyReason = shouldHandoffToHuman
        ? null
        : quickResponseFlow
          ? "flow"
          : hardFlowReply
            ? "flow"
            : knowledgeBaseReply
              ? "knowledge"
              : null;
      let followUpText: string | null = null;

      const generateContextualFollowUp = async (
        actionContext: string,
        history: Array<{
          direction: "INBOUND" | "OUTBOUND";
          content: string | null;
          type?: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "TEMPLATE" | "INTERACTIVE" | "SYSTEM";
          mediaUrl?: string | null;
        }>,
      ) =>
        generateAgentReply({
          model: agent.model,
          systemPrompt: `${agent.systemPrompt ?? ""}\n\nACCION: ${actionContext} Genera una sola pregunta comercial concreta que asuma que ya se ejecuto la accion y lleve al siguiente paso (compra, reserva, consulta de precio, etc). Sin repetir la informacion ya enviada. Maximo 1-2 lineas.`,
          rawSystemPrompt: true,
          fallbackMessage: null,
          history,
          latestUserMessage: messageText,
        })
          .then((t) => t?.trim() || null)
          .catch(() => null);

      const flowFollowUpContext = shouldHandoffToHuman
        ? null
        : quickResponseFlow
          ? `El flujo "${quickResponseFlow.scenarioTitle}" ya fue ejecutado para la palabra clave "${quickResponseFlow.keyword}".`
          : hardFlowReply
          ? `El flujo "${hardFlowReply.flowTitle}" ya fue ejecutado para "${hardFlowReply.productName || "el producto"}".`
          : null;

      if (replyText || quickResponseImageReply || knowledgeImageReply || hardFlowImageReply) {
        try {
          console.log("[EVOLUTION] auto_reply_sending", {
            conversationId: conversation.id,
            agentId: agent.id,
            phoneNumber,
            instanceName: channel.evolutionInstanceName,
            preview: replyText?.slice(0, 80) ?? "",
            withImage: Boolean(quickResponseImageReply || knowledgeImageReply || hardFlowImageReply),
          });

            try {
              await sendEvolutionPresence({
                instanceName: channel.evolutionInstanceName,
                phoneNumber,
                presence: "composing",
                delay: responseDelayMs,
              });
            } catch (presenceError) {
              console.warn("[EVOLUTION] presence_failed", {
                conversationId: conversation.id,
                agentId: agent.id,
                phoneNumber,
                instanceName: channel.evolutionInstanceName,
                error: presenceError instanceof Error ? presenceError.message : String(presenceError),
              });
            }

            const sendText = async () => {
              if (!replyText || !channel.evolutionInstanceName) return;
              const outbound = await sendEvolutionTextMessageWithReconnect({
                instanceName: channel.evolutionInstanceName,
                phoneNumber,
                text: replyText,
                delayMs: 0,
              });
              await prisma.message.create({
                data: {
                  workspaceId: channel.workspaceId,
                  conversationId: conversation.id,
                  channelId: channel.id,
                  contactId: contact.id,
                  agentId: agent.id,
                  externalId: outbound.externalId,
                  direction: "OUTBOUND",
                  type: "TEXT",
                  status: "SENT",
                  content: replyText,
                  sentAt: new Date(),
                  rawPayload: outbound.raw as never,
                },
              });
            };

            if (imageReply) {
              const imageOutbound = await sendEvolutionImageMessage({
                instanceName: channel.evolutionInstanceName,
                phoneNumber,
                imageUrl: imageReply.url,
                caption: imageReply.caption,
                delayMs: 0,
              });

              await prisma.message.create({
                data: {
                  workspaceId: channel.workspaceId,
                  conversationId: conversation.id,
                  channelId: channel.id,
                  contactId: contact.id,
                  agentId: agent.id,
                  externalId: imageOutbound.externalId,
                  direction: "OUTBOUND",
                  type: "IMAGE",
                  status: "SENT",
                  content: imageReply.caption,
                  mediaUrl: imageReply.url,
                  sentAt: new Date(),
                  rawPayload: imageOutbound.raw as never,
                },
              });
              if (imageReplyReason) {
                const imageContext =
                  imageReplyReason === "flow"
                    ? `La imagen del flujo ya fue enviada para "${imageReplyProductName || "el producto"}".`
                    : `La imagen del producto ya fue enviada para "${imageReplyProductName || "el producto"}".`;
                followUpText = await generateContextualFollowUp(imageContext, [
                  ...recentMessages,
                  {
                    direction: "OUTBOUND",
                    type: "IMAGE",
                    mediaUrl: imageReply.url,
                    content: imageReply.caption || `Imagen enviada de ${imageReplyProductName || "producto"}`,
                  },
                ]);
              }

              if (replyText) {
                await sendText();
              }
            } else {
              await sendText();
            }

            if (!followUpText && (quickResponseFlow || hardFlowReply) && flowFollowUpContext) {
              followUpText = await generateContextualFollowUp(flowFollowUpContext, [
                ...recentMessages,
                {
                  direction: "OUTBOUND",
                  type: "TEXT",
                  content:
                    replyText ||
                    quickResponseFlow?.reply.text ||
                    hardFlowReply?.reply ||
                    `Flujo ejecutado para ${quickResponseFlow?.scenarioTitle || hardFlowReply?.productName || "el producto"}`,
                },
              ]);
            }

            if (followUpText && channel.evolutionInstanceName) {
              const followOutbound = await sendEvolutionTextMessageWithReconnect({
                instanceName: channel.evolutionInstanceName,
                phoneNumber,
                text: followUpText,
                delayMs: 600,
              });
              await prisma.message.create({
                data: {
                  workspaceId: channel.workspaceId,
                  conversationId: conversation.id,
                  channelId: channel.id,
                  contactId: contact.id,
                  agentId: agent.id,
                  externalId: followOutbound.externalId,
                  direction: "OUTBOUND",
                  type: "TEXT",
                  status: "SENT",
                  content: followUpText,
                  sentAt: new Date(),
                  rawPayload: followOutbound.raw as never,
                },
              });
            }

            if (notifyHumanPromise) {
              await notifyHumanPromise;
            }

            await prisma.conversation.update({
              where: { id: conversation.id },
              data: {
                lastMessageAt: new Date(),
                status: "OPEN",
              },
            });

          console.log("[EVOLUTION] auto_reply_sent", {
            conversationId: conversation.id,
            agentId: agent.id,
            phoneNumber,
            sentText: Boolean(replyText),
            sentImage: Boolean(knowledgeImageReply || hardFlowImageReply || quickResponseImageReply),
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? (error.stack || error.message) : JSON.stringify(error);

          if (errorMessage.toLowerCase().includes("connection closed")) {
            const recovery = await ensureEvolutionInstanceReady(channel.evolutionInstanceName);

            console.warn("[EVOLUTION] auto_reply_connection_closed", {
              conversationId: conversation.id,
              agentId: agent.id,
              instanceName: channel.evolutionInstanceName,
              recovered: recovery.recovered,
              state: recovery.state,
              hasQrCode: Boolean(recovery.qrCode),
              hasPairingCode: Boolean(recovery.pairingCode),
            });
          }

          console.error(
            `[EVOLUTION] auto_reply_failed conversationId=${conversation.id} agentId=${agent.id} phone=${phoneNumber} instance=${channel.evolutionInstanceName} error=${errorMessage}`,
          );

          await prisma.message.create({
            data: {
              workspaceId: channel.workspaceId,
              conversationId: conversation.id,
              channelId: channel.id,
              contactId: contact.id,
              agentId: agent.id,
              direction: "OUTBOUND",
              type: knowledgeImageReply || hardFlowImageReply ? "IMAGE" : "TEXT",
              status: "FAILED",
              content:
                replyText ||
                knowledgeImageReply?.caption ||
                hardFlowImageReply?.caption ||
                null,
              mediaUrl: knowledgeImageReply?.url ?? hardFlowImageReply?.url ?? null,
              failedAt: new Date(),
            },
          });
        }
      } else {
        console.log("[EVOLUTION] auto_reply_skipped", {
          reason: "empty_reply",
          conversationId: conversation.id,
          agentId: agent.id,
        });
      }
    } else {
      console.log("[EVOLUTION] auto_reply_skipped", {
        reason: !agent
          ? "agent_not_found"
          : !channel.isActive
            ? "channel_inactive"
          : conversationAutomationPaused
            ? "conversation_paused_by_human"
          : !agent.isActive
            ? "agent_inactive"
            : agent.status !== "ACTIVE"
              ? `status_${agent.status}`
              : !channel.evolutionInstanceName
                ? "missing_instance"
                : !messageText
                  ? "missing_message_text"
                  : "unknown",
        conversationId: conversation.id,
        agentId: channel.agentId,
      });
    }
  } else {
    console.log("[EVOLUTION] auto_reply_skipped", {
      reason: "channel_without_agent",
      conversationId: conversation.id,
    });
  }

  return NextResponse.json({
    ok: true,
    message: "Inbound message processed",
    instanceName,
    event: eventName,
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Evolution webhook endpoint is ready",
  });
}
