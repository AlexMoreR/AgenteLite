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
  type SalesTone,
} from "@/lib/agent-training";
import { generateAgentReply } from "@/lib/agent-ai";
import {
  createEvolutionChannelForAgent,
  deleteEvolutionInstance,
  sendEvolutionPresence,
  sendEvolutionTextMessage,
} from "@/lib/evolution";
import { buildDefaultWorkspacePlan } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import {
  generateUniqueWorkspaceSlug,
  getPrimaryWorkspaceForUser,
  type PrimaryWorkspaceMembership,
} from "@/lib/workspace";

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
  postCreateAction: z.enum(["probar", "conectar"]),
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

const simulateAgentReplySchema = z.object({
  agentId: z.string().trim().min(1, "Agente invalido"),
  latestUserMessage: z.string().trim().min(1, "Escribe un mensaje").max(2000, "Mensaje demasiado largo"),
  history: z
    .array(
      z.object({
        direction: z.enum(["INBOUND", "OUTBOUND"]),
        content: z.string().trim().max(2000, "Mensaje demasiado largo"),
      }),
    )
    .max(30, "Demasiados mensajes en la prueba"),
});

const updateAgentTrainingSchema = createAgentSchema.extend({
  agentId: z.string().trim().min(1, "Agente invalido"),
});

function collectTrainingFormInput(formData: FormData) {
  const rawForbiddenRules = formData
    .getAll("forbiddenRules")
    .filter((value): value is string => typeof value === "string" && forbiddenRuleOptions.includes(value as never));
  const getStringValue = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };

  return {
    businessName: getStringValue("businessName"),
    businessDescription: getStringValue("businessDescription"),
    targetAudiences: formData.getAll("targetAudiences"),
    priceRangeMin: getStringValue("priceRangeMin"),
    priceRangeMax: getStringValue("priceRangeMax"),
    salesTone: getStringValue("salesTone"),
    responseLengthValue: getStringValue("responseLengthValue"),
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
    customRules: getStringValue("customRules"),
    postCreateAction: getStringValue("postCreateAction") || "probar",
  };
}

export async function createAgentAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const parsed = createAgentSchema.safeParse(collectTrainingFormInput(formData));

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || "No se pudo crear el agente";
    redirect(`/cliente/agentes?error=${encodeURIComponent(message)}`);
  }

  let membership: PrimaryWorkspaceMembership | null = await getPrimaryWorkspaceForUser(session.user.id);

  if (!membership) {
    const slug = await generateUniqueWorkspaceSlug(parsed.data.businessName);
    const defaultPlan = buildDefaultWorkspacePlan();
    const workspace = await prisma.workspace.create({
      data: {
        name: parsed.data.businessName,
        slug,
        ownerId: session.user.id,
        ...defaultPlan,
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
        planTier: defaultPlan.planTier,
        planStartedAt: defaultPlan.planStartedAt,
        planExpiresAt: defaultPlan.planExpiresAt,
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
    salesTone: parsed.data.salesTone as SalesTone,
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
      status: "ACTIVE",
      isActive: true,
      model: "gpt-4.1-mini",
      maxTokens: 350,
    },
  });

  if (parsed.data.postCreateAction === "conectar") {
    try {
      const created = await createEvolutionChannelForAgent({
        workspaceId: membership.workspace.id,
        workspaceName: membership.workspace.name,
        agentId: agent.id,
        agentName: agent.name,
      });

      revalidatePath("/cliente");
      revalidatePath("/cliente/agentes");
      revalidatePath("/cliente/conexion/whatsapp-business");
      redirect(`/cliente/conexion/whatsapp-business/${created.channelId}?ok=Canal+preparado`);
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
        redirect(`/cliente/conexion/whatsapp-business/${existingChannel.id}?ok=Canal+preparado`);
      }

      redirect("/cliente/conexion/whatsapp-business?error=No+pudimos+preparar+la+conexion+automatica");
    }
  }

  revalidatePath("/cliente");
  revalidatePath("/cliente/agentes");
  redirect(`/cliente/agentes/${agent.id}/probar?ok=Agente+creado`);
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
    salesTone: parsed.data.salesTone as SalesTone,
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
  const nextAgentName = `Asistente ${parsed.data.businessName}`;

  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      name: nextAgentName,
      description: parsed.data.businessDescription,
      trainingConfig: training,
      systemPrompt: buildAgentSystemPrompt({
        agentName: nextAgentName,
        businessName: parsed.data.businessName,
        training,
      }),
      welcomeMessage: buildWelcomeMessage({
        agentName: nextAgentName,
        businessName: parsed.data.businessName,
        training,
      }),
      fallbackMessage: buildFallbackMessage(training),
      handoffMessage: buildHandoffMessage(),
    },
  });

  if (membership.workspace.name !== parsed.data.businessName) {
    await prisma.workspace.update({
      where: { id: membership.workspace.id },
      data: {
        name: parsed.data.businessName,
      },
    });
  }

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
    },
  });

  if (!agent) {
    redirect("/cliente/agentes?error=Agente+no+encontrado");
  }

  for (const channel of agent.channels) {
    if (!channel.evolutionInstanceName) {
      continue;
    }

    try {
      await deleteEvolutionInstance(channel.evolutionInstanceName);
    } catch {
      // Si Evolution no responde o la instancia ya no existe, seguimos con la limpieza local.
    }
  }

  const channelIds = agent.channels.map((channel) => channel.id);

  await prisma.$transaction(async (tx) => {
    if (channelIds.length > 0) {
      await tx.message.deleteMany({
        where: {
          workspaceId: membership.workspace.id,
          OR: [
            { agentId: agent.id },
            { channelId: { in: channelIds } },
            { conversation: { agentId: agent.id } },
            { conversation: { channelId: { in: channelIds } } },
          ],
        },
      });

      await tx.conversation.deleteMany({
        where: {
          workspaceId: membership.workspace.id,
          OR: [{ agentId: agent.id }, { channelId: { in: channelIds } }],
        },
      });

      await tx.whatsAppChannel.deleteMany({
        where: {
          id: { in: channelIds },
          workspaceId: membership.workspace.id,
        },
      });
    } else {
      await tx.message.deleteMany({
        where: {
          workspaceId: membership.workspace.id,
          OR: [{ agentId: agent.id }, { conversation: { agentId: agent.id } }],
        },
      });

      await tx.conversation.deleteMany({
        where: {
          workspaceId: membership.workspace.id,
          agentId: agent.id,
        },
      });
    }

    await tx.agent.delete({
      where: { id: agent.id },
    });
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

export async function simulateAgentReplyAction(input: {
  agentId: string;
  latestUserMessage: string;
  history: Array<{ direction: "INBOUND" | "OUTBOUND"; content: string }>;
}): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    return { ok: false, error: "No autorizado" };
  }

  const parsed = simulateAgentReplySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "No se pudo probar el agente" };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { ok: false, error: "Debes configurar tu negocio primero" };
  }

  const agent = await prisma.agent.findFirst({
    where: {
      id: parsed.data.agentId,
      workspaceId: membership.workspace.id,
    },
    select: {
      id: true,
      model: true,
      systemPrompt: true,
      welcomeMessage: true,
      fallbackMessage: true,
    },
  });

  if (!agent) {
    return { ok: false, error: "Agente no encontrado" };
  }

  const trimmedHistory = parsed.data.history.filter((item) => item.content.trim());

  const reply = await generateAgentReply({
    model: agent.model,
    systemPrompt: agent.systemPrompt,
    fallbackMessage: agent.fallbackMessage,
    history: trimmedHistory,
    latestUserMessage: parsed.data.latestUserMessage,
  });

  return { ok: true, reply };
}
