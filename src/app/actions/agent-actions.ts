"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { generateUniqueAgentSlug } from "@/lib/agent";
import { prisma } from "@/lib/prisma";
import { generateUniqueWorkspaceSlug, getPrimaryWorkspaceForUser } from "@/lib/workspace";

const createAgentSchema = z.object({
  businessType: z.enum(["productos", "servicios", "citas", "mixto"]),
  ownerName: z.string().trim().min(2, "Nombre invalido").max(80, "Nombre demasiado largo"),
  assistantGreetingName: z.string().trim().min(2, "Nombre invalido").max(80, "Nombre demasiado largo"),
  ownerIdentity: z.enum(["hombre", "mujer", "prefiero-no-decir"]),
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

const businessTypeLabelMap = {
  productos: "venta de productos",
  servicios: "venta de servicios",
  citas: "negocio basado en reservas o citas",
  mixto: "modelo mixto de productos y servicios",
} as const;

const ownerIdentityLabelMap = {
  hombre: "hombre",
  mujer: "mujer",
  "prefiero-no-decir": "sin definir genero",
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
    ownerIdentity: formData.get("ownerIdentity"),
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
        { key: `workspace:${workspace.id}:ownerIdentity`, value: parsed.data.ownerIdentity },
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
    `El negocio opera principalmente en ${parsed.data.country} y la referencia de identidad es ${ownerIdentityLabelMap[parsed.data.ownerIdentity]}.`,
    `El negocio ofrece: ${parsed.data.businessOffering}.`,
    `El modelo de cobro principal es: ${parsed.data.chargeModel}.`,
    `El volumen diario estimado es: ${parsed.data.salesVolume}.`,
    `Tu principal canal de seguimiento sera: ${parsed.data.contactChannel}.`,
    `Link principal del negocio: ${parsed.data.productLink || "no definido"}.`,
    `Redes sociales: ${parsed.data.socialLinks || "no definidas"}.`,
    "Si te falta informacion, pide datos concretos y sugiere continuar por WhatsApp con un humano cuando sea necesario.",
  ].join(" ");

  await prisma.agent.create({
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

  revalidatePath("/cliente");
  revalidatePath("/cliente/agentes");
  redirect(
    parsed.data.connectWhatsappNow === "si"
      ? "/cliente/agentes?ok=Agente+creado.+Siguiente:+conectar+WhatsApp"
      : "/cliente/agentes?ok=Agente+creado",
  );
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
      _count: {
        select: {
          channels: true,
          conversations: true,
          messages: true,
        },
      },
    },
  });

  if (!agent) {
    redirect("/cliente/agentes?error=Agente+no+encontrado");
  }

  if (agent._count.channels > 0 || agent._count.conversations > 0 || agent._count.messages > 0) {
    redirect("/cliente/agentes?error=Este+agente+ya+tiene+actividad.+Por+ahora+no+se+puede+eliminar");
  }

  await prisma.agent.delete({
    where: { id: agent.id },
  });

  revalidatePath("/cliente");
  revalidatePath("/cliente/agentes");
  redirect("/cliente/agentes?ok=Agente+eliminado");
}
