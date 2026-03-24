"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { generateUniqueAgentSlug } from "@/lib/agent";
import {
  buildAgentSystemPrompt,
  buildAgentTrainingConfig,
  buildFallbackMessage,
  buildHandoffMessage,
  buildWelcomeMessage,
  forbiddenRuleOptions,
  getResponseLengthFromValue,
  targetAudienceOptions,
  toneOptions,
} from "@/lib/agent-training";
import {
  createEvolutionChannelForAgent,
  deleteEvolutionInstance,
  sendEvolutionPresence,
  sendEvolutionTextMessage,
} from "@/lib/evolution";
import { prisma } from "@/lib/prisma";
import { generateUniqueWorkspaceSlug, getPrimaryWorkspaceForUser } from "@/lib/workspace";

const createAgentSchema = z.object({
  businessName: z.string().trim().min(2, "Nombre del negocio invalido").max(120, "Nombre demasiado largo"),
  businessDescription: z
    .string()
    .trim()
    .min(12, "Cuenta un poco mas sobre lo que vendes")
    .max(500, "Descripcion demasiado larga"),
  targetAudiences: z
    .array(z.enum(targetAudienceOptions))
    .min(1, "Selecciona al menos un tipo de cliente")
    .max(5, "Selecciona hasta cinco tipos de cliente"),
  priceRangeMin: z.string().trim().max(40, "Valor demasiado largo"),
  priceRangeMax: z.string().trim().max(40, "Valor demasiado largo"),
  salesTone: z.enum(toneOptions.map((item) => item.value) as [string, ...string[]]),
  responseLengthValue: z.coerce.number().int().min(0).max(100),
  useEmojis: z.boolean(),
  useExpressivePunctuation: z.boolean(),
  useTuteo: z.boolean(),
  useCustomerName: z.boolean(),
  askNameFirst: z.boolean(),
  offerBestSeller: z.boolean(),
  handlePriceObjections: z.boolean(),
  askForOrder: z.boolean(),
  sendPaymentLink: z.boolean(),
  handoffToHuman: z.boolean(),
  forbiddenRules: z.array(z.string()).max(10, "Demasiadas reglas"),
  customRules: z.string().trim().max(600, "Las reglas personalizadas son demasiado largas"),
  connectWhatsappNow: z.enum(["si", "despues"]),
});

const deleteAgentSchema = z.object({
  agentId: z.string().trim().min(1, "Agente invalido"),
});

const toggleAgentStatusSchema = z.object({
  agentId: z.string().trim().min(1, "Agente invalido"),
});

const sendManualAgentReplySchema = z.object({
  agentId: z.string().trim().min(1, "Agente invalido"),
  conversationId: z.string().trim().min(1, "Conversacion invalida"),
  message: z.string().trim().min(1, "Escribe un mensaje").max(2000, "Mensaje demasiado largo"),
});

const updateAgentTrainingSchema = createAgentSchema.extend({
  agentId: z.string().trim().min(1, "Agente invalido"),
});

function collectTrainingFormInput(formData: FormData) {
  const rawForbiddenRules = formData
    .getAll("forbiddenRules")
    .filter((value): value is string => typeof value === "string" && forbiddenRuleOptions.includes(value as never));

  return {
    businessName: formData.get("businessName"),
    businessDescription: formData.get("businessDescription"),
    targetAudiences: formData.getAll("targetAudiences"),
    priceRangeMin: formData.get("priceRangeMin"),
    priceRangeMax: formData.get("priceRangeMax"),
    salesTone: formData.get("salesTone"),
    responseLengthValue: formData.get("responseLengthValue"),
    useEmojis: formData.get("useEmojis") === "on",
    useExpressivePunctuation: formData.get("useExpressivePunctuation") === "on",
    useTuteo: formData.get("useTuteo") === "on",
    useCustomerName: formData.get("useCustomerName") === "on",
    askNameFirst: formData.get("askNameFirst") === "on",
    offerBestSeller: formData.get("offerBestSeller") === "on",
    handlePriceObjections: formData.get("handlePriceObjections") === "on",
    askForOrder: formData.get("askForOrder") === "on",
    sendPaymentLink: formData.get("sendPaymentLink") === "on",
    handoffToHuman: formData.get("handoffToHuman") === "on",
    forbiddenRules: rawForbiddenRules,
    customRules: formData.get("customRules"),
    connectWhatsappNow: formData.get("connectWhatsappNow") || "despues",
  };
}

export async function createAgentAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const parsed = createAgentSchema.safeParse(collectTrainingFormInput(formData));

  if (!parsed.success) {
    redirect("/cliente/agentes?error=No+se+pudo+crear+el+agente");
  }

  let membership = await getPrimaryWorkspaceForUser(session.user.id);

  if (!membership) {
    const slug = await generateUniqueWorkspaceSlug(parsed.data.businessName);
    const workspace = await prisma.workspace.create({
      data: {
        name: parsed.data.businessName,
        slug,
        ownerId: session.user.id,
        memberships: {
          create: {
            userId: session.user.id,
            role: "OWNER",
          },
        },
      },
      select: { id: true, name: true },
    });

    membership = {
      role: "OWNER",
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug,
        isActive: true,
        createdAt: new Date(),
        ownerId: session.user.id,
        _count: {
          agents: 0,
          channels: 0,
          conversations: 0,
        },
      },
    };
  }

  const agentName = `Asistente ${parsed.data.businessName}`;
  const slug = await generateUniqueAgentSlug(membership.workspace.id, agentName);
  const training = buildAgentTrainingConfig({
    businessDescription: parsed.data.businessDescription,
    targetAudiences: parsed.data.targetAudiences,
    priceRangeMin: parsed.data.priceRangeMin,
    priceRangeMax: parsed.data.priceRangeMax,
    salesTone: parsed.data.salesTone,
    responseLength: getResponseLengthFromValue(parsed.data.responseLengthValue),
    useEmojis: parsed.data.useEmojis,
    useExpressivePunctuation: parsed.data.useExpressivePunctuation,
    useTuteo: parsed.data.useTuteo,
    useCustomerName: parsed.data.useCustomerName,
    askNameFirst: parsed.data.askNameFirst,
    offerBestSeller: parsed.data.offerBestSeller,
    handlePriceObjections: parsed.data.handlePriceObjections,
    askForOrder: parsed.data.askForOrder,
    sendPaymentLink: parsed.data.sendPaymentLink,
    handoffToHuman: parsed.data.handoffToHuman,
    forbiddenRules: parsed.data.forbiddenRules,
    customRules: parsed.data.customRules,
  });

  const systemPrompt = buildAgentSystemPrompt({
    agentName,
    businessName: membership.workspace.name,
    training,
  });

  const agent = await prisma.agent.create({
    data: {
      workspaceId: membership.workspace.id,
      name: agentName,
      slug,
      description: parsed.data.businessDescription,
      trainingConfig: training,
      systemPrompt,
      welcomeMessage: buildWelcomeMessage({
        agentName,
        businessName: membership.workspace.name,
        training,
      }),
      fallbackMessage: buildFallbackMessage(training),
      handoffMessage: buildHandoffMessage(),
      status: "DRAFT",
      model: "gpt-4.1-mini",
      maxTokens: 350,
    },
  });

  if (parsed.data.connectWhatsappNow === "si") {
    try {
      await createEvolutionChannelForAgent({
        workspaceId: membership.workspace.id,
        workspaceName: membership.workspace.name,
        agentId: agent.id,
        agentName: agent.name,
      });

      revalidatePath("/cliente");
      revalidatePath("/cliente/agentes");
      redirect(`/cliente/agentes/${agent.id}/whatsapp?ok=Canal+preparado`);
    } catch {
      const existingChannel = await prisma.whatsAppChannel.findFirst({
        where: {
          agentId: agent.id,
          workspaceId: membership.workspace.id,
        },
        select: {
          id: true,
        },
      });

      revalidatePath("/cliente");
      revalidatePath("/cliente/agentes");
      if (existingChannel) {
        redirect(`/cliente/agentes/${agent.id}/whatsapp?ok=Canal+preparado`);
      }

      redirect(`/cliente/agentes/${agent.id}/whatsapp?error=No+pudimos+preparar+la+conexion+automatica`);
    }
  }

  revalidatePath("/cliente");
  revalidatePath("/cliente/agentes");
  redirect("/cliente/agentes?ok=Agente+creado");
}

export async function updateAgentTrainingAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const parsed = updateAgentTrainingSchema.safeParse({
    agentId: formData.get("agentId"),
    ...collectTrainingFormInput(formData),
  });

  if (!parsed.success) {
    const fallbackAgentId = String(formData.get("agentId") || "");
    redirect(`/cliente/agentes/${fallbackAgentId}/entrenamiento?error=No+se+pudo+guardar+el+entrenamiento`);
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/agentes?error=Debes+configurar+tu+negocio+primero");
  }

  const agent = await prisma.agent.findFirst({
    where: {
      id: parsed.data.agentId,
      workspaceId: membership.workspace.id,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!agent) {
    redirect("/cliente/agentes?error=Agente+no+encontrado");
  }

  const training = buildAgentTrainingConfig({
    businessDescription: parsed.data.businessDescription,
    targetAudiences: parsed.data.targetAudiences,
    priceRangeMin: parsed.data.priceRangeMin,
    priceRangeMax: parsed.data.priceRangeMax,
    salesTone: parsed.data.salesTone,
    responseLength: getResponseLengthFromValue(parsed.data.responseLengthValue),
    useEmojis: parsed.data.useEmojis,
    useExpressivePunctuation: parsed.data.useExpressivePunctuation,
    useTuteo: parsed.data.useTuteo,
    useCustomerName: parsed.data.useCustomerName,
    askNameFirst: parsed.data.askNameFirst,
    offerBestSeller: parsed.data.offerBestSeller,
    handlePriceObjections: parsed.data.handlePriceObjections,
    askForOrder: parsed.data.askForOrder,
    sendPaymentLink: parsed.data.sendPaymentLink,
    handoffToHuman: parsed.data.handoffToHuman,
    forbiddenRules: parsed.data.forbiddenRules,
    customRules: parsed.data.customRules,
  });

  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      description: parsed.data.businessDescription,
      trainingConfig: training,
      systemPrompt: buildAgentSystemPrompt({
        agentName: agent.name,
        businessName: parsed.data.businessName,
        training,
      }),
      welcomeMessage: buildWelcomeMessage({
        agentName: agent.name,
        businessName: parsed.data.businessName,
        training,
      }),
      fallbackMessage: buildFallbackMessage(training),
      handoffMessage: buildHandoffMessage(),
    },
  });

  revalidatePath("/cliente");
  revalidatePath("/cliente/agentes");
  revalidatePath(`/cliente/agentes/${agent.id}`);
  revalidatePath(`/cliente/agentes/${agent.id}/entrenamiento`);
  redirect(`/cliente/agentes/${agent.id}/entrenamiento?ok=Entrenamiento+actualizado`);
}

export async function deleteAgentAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const parsed = deleteAgentSchema.safeParse({
    agentId: formData.get("agentId"),
  });

  if (!parsed.success) {
    redirect("/cliente/agentes?error=Agente+invalido");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/agentes?error=Debes+configurar+tu+negocio+primero");
  }

  const agent = await prisma.agent.findFirst({
    where: {
      id: parsed.data.agentId,
      workspaceId: membership.workspace.id,
    },
    select: {
      id: true,
      channels: {
        select: {
          id: true,
          evolutionInstanceName: true,
        },
      },
      _count: {
        select: {
          conversations: true,
          messages: true,
        },
      },
    },
  });

  if (!agent) {
    redirect("/cliente/agentes?error=Agente+no+encontrado");
  }

  if (agent._count.conversations > 0 || agent._count.messages > 0) {
    redirect("/cliente/agentes?error=Este+agente+ya+tiene+actividad.+Por+ahora+no+se+puede+eliminar");
  }

  for (const channel of agent.channels) {
    try {
      await deleteEvolutionInstance(channel.evolutionInstanceName);
    } catch {
      // Si Evolution no responde o la instancia ya no existe, seguimos con la limpieza local.
    }
  }

  if (agent.channels.length > 0) {
    await prisma.whatsAppChannel.deleteMany({
      where: {
        agentId: agent.id,
      },
    });
  }

  await prisma.agent.delete({
    where: { id: agent.id },
  });

  revalidatePath("/cliente");
  revalidatePath("/cliente/agentes");
  redirect("/cliente/agentes?ok=Agente+eliminado");
}

export async function toggleAgentStatusAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const parsed = toggleAgentStatusSchema.safeParse({
    agentId: formData.get("agentId"),
  });

  if (!parsed.success) {
    redirect("/cliente/agentes?error=Agente+invalido");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/agentes?error=Debes+configurar+tu+negocio+primero");
  }

  const agent = await prisma.agent.findFirst({
    where: {
      id: parsed.data.agentId,
      workspaceId: membership.workspace.id,
    },
    select: {
      id: true,
      status: true,
      isActive: true,
    },
  });

  if (!agent) {
    redirect("/cliente/agentes?error=Agente+no+encontrado");
  }

  const nextStatus = agent.status === "ACTIVE" ? "PAUSED" : "ACTIVE";

  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      status: nextStatus,
      isActive: nextStatus === "ACTIVE",
    },
  });

  revalidatePath("/cliente");
  revalidatePath("/cliente/agentes");
  redirect(`/cliente/agentes?ok=${nextStatus === "ACTIVE" ? "Agente+encendido" : "Agente+apagado"}`);
}

export async function sendManualAgentReplyAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const parsed = sendManualAgentReplySchema.safeParse({
    agentId: formData.get("agentId"),
    conversationId: formData.get("conversationId"),
    message: formData.get("message"),
  });

  const fallbackAgentId = String(formData.get("agentId") || "");

  if (!parsed.success) {
    redirect(`/cliente/agentes/${fallbackAgentId}/chats?error=No+se+pudo+enviar+el+mensaje`);
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/agentes?error=Debes+configurar+tu+negocio+primero");
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: parsed.data.conversationId,
      workspaceId: membership.workspace.id,
      agentId: parsed.data.agentId,
    },
    include: {
      contact: {
        select: {
          id: true,
          phoneNumber: true,
        },
      },
      channel: {
        select: {
          id: true,
          evolutionInstanceName: true,
        },
      },
    },
  });

  if (!conversation || !conversation.channel?.evolutionInstanceName || !conversation.contact?.phoneNumber) {
    redirect(`/cliente/agentes/${parsed.data.agentId}/chats?error=No+se+encontro+el+canal+o+contacto`);
  }

  try {
    await sendEvolutionPresence({
      instanceName: conversation.channel.evolutionInstanceName,
      phoneNumber: conversation.contact.phoneNumber,
      presence: "composing",
      delay: 900,
    });
  } catch {
    // Si falla el indicador de escritura, igual enviamos el mensaje manual.
  }

  const outbound = await sendEvolutionTextMessage({
    instanceName: conversation.channel.evolutionInstanceName,
    phoneNumber: conversation.contact.phoneNumber,
    text: parsed.data.message,
  });

  await prisma.message.create({
    data: {
      workspaceId: membership.workspace.id,
      conversationId: conversation.id,
      channelId: conversation.channel.id,
      contactId: conversation.contact.id,
      agentId: parsed.data.agentId,
      externalId: outbound.externalId,
      direction: "OUTBOUND",
      type: "TEXT",
      status: "SENT",
      content: parsed.data.message,
      sentAt: new Date(),
      rawPayload: {
        source: "manual",
        evolution: outbound.raw,
      } as never,
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: new Date(),
      status: "OPEN",
    },
  });

  revalidatePath(`/cliente/agentes/${parsed.data.agentId}/chats`);
  redirect(`/cliente/agentes/${parsed.data.agentId}/chats?conversationId=${conversation.id}&ok=Mensaje+enviado`);
}
