"use server";

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
});

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
    provider: formData.get("provider"),
    name: formData.get("name"),
  });

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || "No se pudo crear el canal";
    redirect(`/cliente/conexion?error=${encodeURIComponent(message)}`);
  }

  if (parsed.data.provider === "EVOLUTION") {
    const created = await createEvolutionChannel({
      workspaceId: membership.workspace.id,
      name: parsed.data.name,
    });

    revalidatePath("/cliente/conexion");
    revalidatePath("/cliente/conexion/whatsapp-business");
    redirect(`/cliente/conexion/whatsapp-business/${created.channelId}?ok=Canal+creado`);
  }

  const officialApiConfig = await getOfficialApiConfigByWorkspaceId(membership.workspace.id);
  if (officialApiConfig?.status !== "CONNECTED") {
    redirect("/cliente/conexion?error=La+API+oficial+no+esta+activa+para+este+workspace");
  }

  const channel = await prisma.whatsAppChannel.create({
    data: {
      workspaceId: membership.workspace.id,
      provider: "OFFICIAL_API",
      name: parsed.data.name,
      status: "CONNECTED",
      metadata: {
        officialApiConfigId: officialApiConfig.id,
        phoneNumberId: officialApiConfig.phoneNumberId,
        wabaId: officialApiConfig.wabaId,
      },
    },
    select: {
      id: true,
    },
  });

  revalidatePath("/cliente/conexion");
  revalidatePath("/cliente/conexion/whatsapp-business");
  revalidatePath("/cliente/api-oficial");
  redirect(`/cliente/conexion/whatsapp-business/${channel.id}?ok=Canal+oficial+creado`);
}

const deleteConnectionChannelSchema = z.object({
  channelId: z.string().trim().min(1, "Canal invalido"),
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
    channelId: formData.get("channelId"),
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
      evolutionInstanceName: true,
    },
  });

  if (!channel) {
    redirect("/cliente/conexion?error=Canal+no+encontrado");
  }

  if (channel.evolutionInstanceName) {
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
