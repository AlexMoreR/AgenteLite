"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { generateUniqueAgentSlug } from "@/lib/agent";
import { createEvolutionChannelForAgent, deleteEvolutionInstance } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";
import { generateUniqueWorkspaceSlug, getPrimaryWorkspaceForUser } from "@/lib/workspace";

const createAgentSchema = z.object({
  businessType: z.enum(["productos", "servicios", "citas", "mixto"]),
  ownerName: z.string().trim().min(2, "Nombre invalido").max(80, "Nombre demasiado largo"),
  assistantGreetingName: z.string().trim().min(2, "Nombre invalido").max(80, "Nombre demasiado largo"),
  country: z.string().trim().min(2, "Pais invalido").max(80, "Pais invalido"),
  businessName: z.string().trim().min(2, "Nombre del negocio invalido").max(120, "Nombre demasiado largo"),
  industry: z.string().trim().min(2, "Rubro invalido").max(120, "Rubro invalido"),
  agentName: z.string().trim().max(80, "Nombre demasiado largo").optional(),
  businessOffering: z.string().trim().min(8, "Describe mejor lo que ofrece tu negocio").max(280, "Descripcion demasiado larga"),
  productLink: z.string().trim().optional(),
  socialLinks: z.string().trim().optional(),
  salesVolume: z.enum(["bajo", "medio", "alto"]),
  chargeModel: z.enum(["por-producto", "por-servicio", "mixto", "cotizacion"]),
  contactChannel: z.enum(["whatsapp", "api-oficial"]),
  connectWhatsappNow: z.enum(["si", "despues"]),
});

const deleteAgentSchema = z.object({
  agentId: z.string().trim().min(1, "Agente invalido"),
});

const toggleAgentStatusSchema = z.object({
  agentId: z.string().trim().min(1, "Agente invalido"),
});

const businessTypeLabelMap = {
  productos: "venta de productos",
  servicios: "venta de servicios",
  citas: "negocio basado en reservas o citas",
  mixto: "modelo mixto de productos y servicios",
} as const;

export async function createAgentAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const parsed = createAgentSchema.safeParse({
    businessType: formData.get("businessType"),
    ownerName: formData.get("ownerName"),
    assistantGreetingName: formData.get("assistantGreetingName"),
    country: formData.get("country"),
    businessName: formData.get("businessName"),
    industry: formData.get("industry"),
    agentName: formData.get("agentName"),
    businessOffering: formData.get("businessOffering"),
    productLink: formData.get("productLink"),
    socialLinks: formData.get("socialLinks"),
    salesVolume: formData.get("salesVolume"),
    chargeModel: formData.get("chargeModel"),
    contactChannel: formData.get("contactChannel"),
    connectWhatsappNow: formData.get("connectWhatsappNow"),
  });

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

    await prisma.appSetting.createMany({
      data: [
        { key: `workspace:${workspace.id}:businessType`, value: parsed.data.businessType },
        { key: `workspace:${workspace.id}:country`, value: parsed.data.country },
        { key: `workspace:${workspace.id}:industry`, value: parsed.data.industry },
        { key: `workspace:${workspace.id}:ownerName`, value: parsed.data.ownerName },
        { key: `workspace:${workspace.id}:productLink`, value: parsed.data.productLink || "" },
        { key: `workspace:${workspace.id}:socialLinks`, value: parsed.data.socialLinks || "" },
      ],
      skipDuplicates: true,
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

  const agentName = parsed.data.agentName?.trim() || `Asistente ${parsed.data.businessName}`;
  const slug = await generateUniqueAgentSlug(membership.workspace.id, agentName);

  const systemPrompt = [
    `Eres ${agentName}, el asistente virtual del negocio ${membership.workspace.name}.`,
    `El negocio es de ${businessTypeLabelMap[parsed.data.businessType]} y pertenece al rubro ${parsed.data.industry}.`,
    `Tu dueno se llama ${parsed.data.ownerName} y prefieres referirte a el o ella como ${parsed.data.assistantGreetingName}.`,
    `El negocio opera principalmente en ${parsed.data.country}.`,
    `El negocio ofrece: ${parsed.data.businessOffering}.`,
    `El modelo de cobro principal es: ${parsed.data.chargeModel}.`,
    `El volumen diario estimado es: ${parsed.data.salesVolume}.`,
    `Tu principal canal de seguimiento sera: ${parsed.data.contactChannel}.`,
    `Link principal del negocio: ${parsed.data.productLink || "no definido"}.`,
    `Redes sociales: ${parsed.data.socialLinks || "no definidas"}.`,
    "Si te falta informacion, pide datos concretos y sugiere continuar por WhatsApp con un humano cuando sea necesario.",
  ].join(" ");

  const agent = await prisma.agent.create({
    data: {
      workspaceId: membership.workspace.id,
      name: agentName,
      slug,
      description: parsed.data.businessOffering,
      systemPrompt,
      welcomeMessage: `Hola, soy ${agentName}. Estoy aqui para ayudarte con ${membership.workspace.name}.`,
      fallbackMessage: "Puedo ayudarte mejor si me cuentas un poco mas sobre lo que necesitas.",
      handoffMessage: "Si quieres, puedo dejar tu solicitud lista para que un asesor humano continue contigo por WhatsApp.",
      status: "DRAFT",
      model: "gpt-4.1-mini",
      maxTokens: 350,
    },
  });

  if (parsed.data.connectWhatsappNow === "si" && parsed.data.contactChannel === "whatsapp") {
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
  redirect(
    `/cliente/agentes?ok=${nextStatus === "ACTIVE" ? "Agente+encendido" : "Agente+apagado"}`,
  );
}
