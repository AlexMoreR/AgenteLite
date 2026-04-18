"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { createEvolutionChannel, deleteEvolutionInstance } from "@/lib/evolution";
import { getOfficialApiConfigByWorkspaceId } from "@/lib/official-api-config";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

const createConnectionChannelSchema = z.object({
  provider: z.enum(["EVOLUTION", "OFFICIAL_API"]),
  name: z
    .string()
    .trim()
    .min(2, "Escribe un nombre de canal valido")
    .max(100, "El nombre del canal es demasiado largo"),
  agentId: z.string().trim().optional(),
});

function getRequiredFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getOptionalFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string") {
    return undefined;
  }

  return value.trim().length ? value : undefined;
}

export async function createConnectionChannelAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/conexion?error=Debes+crear+tu+negocio+primero");
  }

  const parsed = createConnectionChannelSchema.safeParse({
    provider: getRequiredFormValue(formData, "provider"),
    name: getRequiredFormValue(formData, "name"),
    agentId: getOptionalFormValue(formData, "agentId"),
  });

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || "No se pudo crear el canal";
    redirect(`/cliente/conexion?error=${encodeURIComponent(message)}`);
  }

  let agentId: string | null = null;

  if (parsed.data.agentId) {
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
      redirect("/cliente/conexion?error=No+se+encontro+el+agente+para+vincular");
    }

    agentId = agent.id;
  }

  if (parsed.data.provider === "EVOLUTION") {
    const created = await createEvolutionChannel({
      workspaceId: membership.workspace.id,
      name: parsed.data.name,
      agentId,
    });

    revalidatePath("/cliente/conexion");
    revalidatePath("/cliente/conexion/whatsapp-business");
    const okMessage = agentId ? "Canal+creado+y+vinculado" : "Canal+creado";
    redirect(`/cliente/conexion/whatsapp-business/${created.channelId}?ok=${okMessage}`);
  }

  const officialApiConfig = await getOfficialApiConfigByWorkspaceId(membership.workspace.id);
  if (officialApiConfig?.status !== "CONNECTED") {
    redirect("/cliente/conexion?error=La+API+oficial+no+esta+activa+para+este+workspace");
  }

  await prisma.whatsAppChannel.create({
    data: {
      workspaceId: membership.workspace.id,
      agentId,
      provider: "OFFICIAL_API",
      name: parsed.data.name,
      evolutionInstanceName: `official-${officialApiConfig.phoneNumberId}-${randomUUID()}`,
      status: "CONNECTED",
      metadata: {
        officialApiConfigId: officialApiConfig.id,
        phoneNumberId: officialApiConfig.phoneNumberId,
        wabaId: officialApiConfig.wabaId,
      },
    },
  });

  revalidatePath("/cliente/conexion");
  revalidatePath("/cliente/conexion/whatsapp-business");
  revalidatePath("/cliente/api-oficial");
  const okMessage = agentId ? "Canal+oficial+creado+y+vinculado" : "Canal+oficial+creado";
  redirect(`/cliente/conexion?${agentId ? `agentId=${agentId}&` : ""}ok=${okMessage}`);
}

const deleteConnectionChannelSchema = z.object({
  channelId: z.string().trim().min(1, "Canal invalido"),
});

const assignConnectionChannelSchema = z.object({
  channelId: z.string().trim().min(1, "Canal invalido"),
  agentId: z.string().trim().min(1, "Agente invalido"),
});

const toggleConnectionChannelStatusSchema = z.object({
  channelId: z.string().trim().min(1, "Canal invalido"),
  returnTo: z.string().trim().optional(),
});

export async function deleteConnectionChannelAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/conexion?error=Debes+crear+tu+negocio+primero");
  }

  const parsed = deleteConnectionChannelSchema.safeParse({
    channelId: getRequiredFormValue(formData, "channelId"),
  });

  if (!parsed.success) {
    redirect("/cliente/conexion?error=Canal+invalido");
  }

  const channel = await prisma.whatsAppChannel.findFirst({
    where: {
      id: parsed.data.channelId,
      workspaceId: membership.workspace.id,
    },
    select: {
      id: true,
      provider: true,
      evolutionInstanceName: true,
    },
  });

  if (!channel) {
    redirect("/cliente/conexion?error=Canal+no+encontrado");
  }

  if (channel.provider === "EVOLUTION" && channel.evolutionInstanceName) {
    try {
      await deleteEvolutionInstance(channel.evolutionInstanceName);
    } catch {
      // Si Evolution no responde, igual permitimos la limpieza local del canal.
    }
  }

  await prisma.whatsAppChannel.delete({
    where: { id: channel.id },
  });

  revalidatePath("/cliente/conexion");
  revalidatePath("/cliente/conexion/whatsapp-business");
  redirect("/cliente/conexion?ok=Canal+eliminado");
}

export async function assignConnectionChannelAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/conexion?error=Debes+crear+tu+negocio+primero");
  }

  const parsed = assignConnectionChannelSchema.safeParse({
    channelId: getRequiredFormValue(formData, "channelId"),
    agentId: getRequiredFormValue(formData, "agentId"),
  });

  if (!parsed.success) {
    redirect("/cliente/conexion?error=No+se+pudo+vincular+el+canal");
  }

  const [agent, channel] = await Promise.all([
    prisma.agent.findFirst({
      where: {
        id: parsed.data.agentId,
        workspaceId: membership.workspace.id,
      },
      select: {
        id: true,
      },
    }),
    prisma.whatsAppChannel.findFirst({
      where: {
        id: parsed.data.channelId,
        workspaceId: membership.workspace.id,
      },
      select: {
        id: true,
      },
    }),
  ]);

  if (!agent || !channel) {
    redirect("/cliente/conexion?error=No+se+encontro+el+agente+o+el+canal");
  }

  await prisma.whatsAppChannel.update({
    where: { id: channel.id },
    data: {
      agentId: agent.id,
    },
  });

  revalidatePath("/cliente/conexion");
  revalidatePath("/cliente/conexion/whatsapp-business");
  revalidatePath(`/cliente/agentes/${agent.id}`);
  redirect(`/cliente/conexion?agentId=${agent.id}&ok=Canal+vinculado+al+agente`);
}

export async function toggleConnectionChannelStatusAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    redirect("/unauthorized");
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/conexion?error=Debes+crear+tu+negocio+primero");
  }

  const parsed = toggleConnectionChannelStatusSchema.safeParse({
    channelId: getRequiredFormValue(formData, "channelId"),
    returnTo: getOptionalFormValue(formData, "returnTo"),
  });

  if (!parsed.success) {
    redirect("/cliente/conexion?error=Canal+invalido");
  }

  const channel = await prisma.whatsAppChannel.findFirst({
    where: {
      id: parsed.data.channelId,
      workspaceId: membership.workspace.id,
    },
    select: {
      id: true,
      name: true,
      isActive: true,
      agentId: true,
    },
  });

  if (!channel) {
    redirect("/cliente/conexion?error=Canal+no+encontrado");
  }

  const nextIsActive = !channel.isActive;

  await prisma.whatsAppChannel.update({
    where: { id: channel.id },
    data: {
      isActive: nextIsActive,
    },
  });

  revalidatePath("/cliente/conexion");
  revalidatePath("/cliente/conexion/whatsapp-business");
  revalidatePath(`/cliente/conexion/whatsapp-business/${channel.id}`);

  if (channel.agentId) {
    revalidatePath(`/cliente/agentes/${channel.agentId}`);
  }

  const okMessage = nextIsActive ? "Canal+encendido" : "Canal+apagado";
  const returnTo = parsed.data.returnTo?.trim() || `/cliente/conexion/whatsapp-business/${channel.id}`;
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}ok=${okMessage}`);
}
