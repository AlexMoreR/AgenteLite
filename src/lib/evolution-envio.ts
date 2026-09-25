import { Prisma } from "@prisma/client";

import type { FlowStep } from "@/lib/agent-product-flow";
import {
  ensureEvolutionInstanceReady,
  sendEvolutionAudioMessage,
  sendEvolutionDocumentMessage,
  sendEvolutionImageMessage,
  sendEvolutionTextMessageWithReconnect,
  sendEvolutionVideoMessage,
} from "@/lib/evolution";
import { prisma } from "@/lib/prisma";

/**
 * ENVIAR un paso de flujo por WhatsApp y dejarlo guardado en el chat.
 *
 * Vivia dentro del webhook, que era su unico usuario. Se mudo cuando el CRM tambien necesito
 * enviar -al volver a encender el agente en un chat, este retoma la conversacion-: tener dos
 * caminos de envio distintos es como estos sistemas se pudren, porque con el tiempo uno manda
 * las cosas de una forma y el otro de otra y nadie sabe cual es el bueno (25-09-2026).
 *
 * El contenido no se toco al mudarlo: es el mismo codigo que venia enviando en produccion.
 */

export async function persistEvolutionMessage(args: { data: Prisma.MessageUncheckedCreateInput }) {
  const { data } = args;
  const externalId = typeof data.externalId === "string" ? data.externalId.trim() : "";

  if (externalId && typeof data.channelId === "string" && data.channelId.trim()) {
    await prisma.message.upsert({
      where: {
        channelId_externalId: {
          channelId: data.channelId,
          externalId,
        },
      },
      create: {
        ...data,
        externalId,
      },
      update: {
        ...data,
        externalId,
      },
    });
    return;
  }

  await prisma.message.create({
    data: {
      ...data,
      externalId: externalId || null,
    },
  });
}

export async function sendAndPersistEvolutionFlowStep(input: {
  step: FlowStep;
  workspaceId: string;
  conversationId: string;
  channelId: string;
  contactId: string;
  /** Puede faltar: la linea de pruebas del V3 no tiene agente V2 asignado. */
  agentId?: string;
  instanceName: string;
  phoneNumber: string;
}) {
  const {
    step,
    workspaceId,
    conversationId,
    channelId,
    contactId,
    agentId,
    instanceName,
    phoneNumber,
  } = input;

  if (step.kind === "text") {
    const outbound = await sendEvolutionTextMessageWithReconnect({
      instanceName,
      phoneNumber,
      text: step.content,
      delayMs: 0,
    });
    await persistEvolutionMessage({
      data: {
        workspaceId,
        conversationId,
        channelId,
        contactId,
        agentId,
        externalId: outbound.externalId,
        direction: "OUTBOUND",
        type: "TEXT",
        status: "SENT",
        content: step.content,
        sentAt: new Date(),
        rawPayload: outbound.raw as never,
      },
    });
  } else if (step.kind === "image") {
    const outbound = await sendEvolutionImageMessage({
      instanceName,
      phoneNumber,
      imageUrl: step.url,
      caption: step.caption,
      delayMs: 0,
    });
    await persistEvolutionMessage({
      data: {
        workspaceId,
        conversationId,
        channelId,
        contactId,
        agentId,
        externalId: outbound.externalId,
        direction: "OUTBOUND",
        type: "IMAGE",
        status: "SENT",
        content: step.caption,
        mediaUrl: step.url,
        sentAt: new Date(),
        rawPayload: outbound.raw as never,
      },
    });
  } else if (step.kind === "audio") {
    const outbound = await sendEvolutionAudioMessage({
      instanceName,
      phoneNumber,
      audioUrl: step.url,
      caption: step.caption,
      delayMs: 0,
    });
    await persistEvolutionMessage({
      data: {
        workspaceId,
        conversationId,
        channelId,
        contactId,
        agentId,
        externalId: outbound.externalId,
        direction: "OUTBOUND",
        type: "AUDIO",
        status: "SENT",
        content: step.caption,
        mediaUrl: step.url,
        sentAt: new Date(),
        rawPayload: outbound.raw as never,
      },
    });
  } else if (step.kind === "video") {
    const outbound = await sendEvolutionVideoMessage({
      instanceName,
      phoneNumber,
      videoUrl: step.url,
      caption: step.caption,
      delayMs: 0,
    });
    await persistEvolutionMessage({
      data: {
        workspaceId,
        conversationId,
        channelId,
        contactId,
        agentId,
        externalId: outbound.externalId,
        direction: "OUTBOUND",
        type: "VIDEO",
        status: "SENT",
        content: step.caption,
        mediaUrl: step.url,
        sentAt: new Date(),
        rawPayload: outbound.raw as never,
      },
    });
  } else if (step.kind === "document") {
    const outbound = await sendEvolutionDocumentMessage({
      instanceName,
      phoneNumber,
      documentUrl: step.url,
      caption: step.caption,
      fileName: step.fileName,
      delayMs: 0,
    });
    await persistEvolutionMessage({
      data: {
        workspaceId,
        conversationId,
        channelId,
        contactId,
        agentId,
        externalId: outbound.externalId,
        direction: "OUTBOUND",
        type: "DOCUMENT",
        status: "SENT",
        content: step.caption,
        mediaUrl: step.url,
        sentAt: new Date(),
        rawPayload: outbound.raw as never,
      },
    });
  }
}

// Envía un paso del flujo con resiliencia: si evogo cierra la WS a mitad de un medio pesado
// (p.ej. un PDF de 14MB), reconecta y reintenta ESE paso una vez; si aun asi falla, lo marca
// FAILED y devuelve false — pero NUNCA lanza, para que un paso caido no aborte el flujo entero.
export async function sendAndPersistEvolutionFlowStepResilient(input: {
  step: FlowStep;
  workspaceId: string;
  conversationId: string;
  channelId: string;
  contactId: string;
  /** Puede faltar: la linea de pruebas del V3 no tiene agente V2 asignado. */
  agentId?: string;
  instanceName: string;
  phoneNumber: string;
}): Promise<boolean> {
  try {
    await sendAndPersistEvolutionFlowStep(input);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(
      `[EVOLUTION] flow_step_failed kind=${input.step.kind} conversationId=${input.conversationId} error=${message}`,
    );
    if (message.toLowerCase().includes("connection closed")) {
      try {
        await ensureEvolutionInstanceReady(input.instanceName);
        await sendAndPersistEvolutionFlowStep(input);
        return true;
      } catch {
        // el reintento tras reconectar tambien fallo: cae al registro FAILED
      }
    }
    const failedType =
      input.step.kind === "text"
        ? "TEXT"
        : input.step.kind === "image"
          ? "IMAGE"
          : input.step.kind === "audio"
            ? "AUDIO"
            : input.step.kind === "video"
              ? "VIDEO"
              : "DOCUMENT";
    await persistEvolutionMessage({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        channelId: input.channelId,
        contactId: input.contactId,
        agentId: input.agentId,
        direction: "OUTBOUND",
        type: failedType,
        status: "FAILED",
        content: input.step.kind === "text" ? input.step.content : input.step.caption ?? null,
        mediaUrl: input.step.kind === "text" ? null : input.step.url,
        failedAt: new Date(),
      },
    }).catch(() => {});
    return false;
  }
}
