"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import {
  connectEvolutionApiToChannel,
  createEvolutionChannel,
  deleteEvolutionInstance,
  recreateEvolutionInstanceForChannel,
} from "@/lib/evolution";
import { getOfficialApiConfigByWorkspaceId } from "@/lib/official-api-config";
import { prisma } from "@/lib/prisma";
import { getEvolutionGateways } from "@/lib/system-settings";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

const createConnectionChannelSchema = z.object({
  provider: z.enum(["EVOLUTION", "OFFICIAL_API"]),
  name: z
    .string()
    .trim()
    .min(2, "Escribe un nombre de canal valido")
    .max(100, "El nombre del canal es demasiado largo"),
  agentId: z.string().trim().optional(),
  // Solo para provider EVOLUTION: id de la conexion del catalogo que configura el admin
  // (Admin > Configuracion WhatsApp). La URL/apikey se resuelven en el servidor.
  gatewayId: z.string().trim().optional(),
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
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    redirect("/unauthorized");
  }
  await requireClientWorkspaceAccess("connection");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/conexion?error=Debes+crear+tu+negocio+primero");
  }

  const parsed = createConnectionChannelSchema.safeParse({
    provider: getRequiredFormValue(formData, "provider"),
    name: getRequiredFormValue(formData, "name"),
    agentId: getOptionalFormValue(formData, "agentId"),
    gatewayId: getOptionalFormValue(formData, "gatewayId"),
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
    // Resuelve la conexion elegida desde el catalogo del admin (la apikey nunca viaja
    // por el formulario). Sin conexiones configuradas no se puede crear el canal.
    const gateways = await getEvolutionGateways();
    if (gateways.length === 0) {
      redirect("/cliente/conexion?error=Falta+configurar+la+conexion+de+WhatsApp+por+un+administrador");
    }

    const gateway = parsed.data.gatewayId
      ? gateways.find((item) => item.id === parsed.data.gatewayId)
      : gateways[0];
    if (!gateway) {
      redirect("/cliente/conexion?error=La+conexion+elegida+ya+no+existe");
    }

    const created = await createEvolutionChannel({
      workspaceId: membership.workspace.id,
      name: parsed.data.name,
      agentId,
      gateway: {
        kind: gateway.kind,
        baseUrl: gateway.baseUrl,
        apiKey: gateway.apiKey,
      },
    });

    revalidatePath("/cliente/conexion");
    revalidatePath("/cliente/conexion/whatsapp-business");
    const okMessage = agentId ? "Canal+creado+y+vinculado" : "Canal+creado";
    redirect(`/cliente/conexion/whatsapp-business/${created.channelId}?ok=${okMessage}`);
  }

  const officialApiConfig = await getOfficialApiConfigByWorkspaceId(membership.workspace.id);
  const createdChannel = await prisma.whatsAppChannel.create({
    data: {
      workspaceId: membership.workspace.id,
      agentId,
      provider: "OFFICIAL_API",
      name: parsed.data.name,
      evolutionInstanceName:
        officialApiConfig?.status === "CONNECTED" && officialApiConfig.phoneNumberId
          ? `official-${officialApiConfig.phoneNumberId}-${randomUUID()}`
          : null,
      status: officialApiConfig?.status === "CONNECTED" ? "CONNECTED" : "DISCONNECTED",
      metadata:
        officialApiConfig?.status === "CONNECTED"
          ? {
              officialApiConfigId: officialApiConfig.id,
              phoneNumberId: officialApiConfig.phoneNumberId,
              wabaId: officialApiConfig.wabaId,
            }
          : {
              source: "client-draft-setup",
            },
    },
    select: {
      id: true,
    },
  });

  revalidatePath("/cliente/conexion");
  revalidatePath("/cliente/conexion/whatsapp-business");
  revalidatePath("/cliente/api-oficial");
  const okMessage =
    officialApiConfig?.status === "CONNECTED"
      ? agentId
        ? "Canal+oficial+creado+y+vinculado"
        : "Canal+oficial+creado"
      : "Canal+oficial+creado.+Completa+ahora+la+configuracion+de+Meta";
  redirect(`/cliente/conexion/whatsapp-business/${createdChannel.id}?ok=${okMessage}`);
}

const regenerateConnectionInstanceSchema = z.object({
  channelId: z.string().trim().min(1, "Canal invalido"),
  returnTo: z.string().trim().optional(),
});

/**
 * Crea una instancia de Evolution NUEVA para un canal existente (nuevo QR) sin borrar el
 * canal: conserva conversaciones, contactos, CRM, etiquetas, agente y colaboradores.
 * Sirve cuando la instancia vieja quedo pegada y no genera QR.
 */
export async function regenerateConnectionInstanceAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    redirect("/unauthorized");
  }
  await requireClientWorkspaceAccess("connection");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/conexion?error=Debes+crear+tu+negocio+primero");
  }

  const parsed = regenerateConnectionInstanceSchema.safeParse({
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
      provider: "EVOLUTION",
    },
    select: { id: true },
  });
  if (!channel) {
    redirect("/cliente/conexion?error=Canal+no+encontrado");
  }

  const detailPath = `/cliente/conexion/whatsapp-business/${channel.id}`;
  try {
    await recreateEvolutionInstanceForChannel({
      channelId: channel.id,
      workspaceId: membership.workspace.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear la cuenta nueva";
    redirect(`${detailPath}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/cliente/conexion");
  revalidatePath(detailPath);
  redirect(`${detailPath}?ok=${encodeURIComponent("Cuenta nueva creada. Escanea el QR para conectar.")}`);
}

const connectEvolutionApiSchema = z.object({
  channelId: z.string().trim().min(1, "Canal invalido"),
  gatewayId: z.string().trim().min(1, "Elige una conexion de Evolution API"),
});

/**
 * Conecta Evolution API a un canal EXISTENTE (p. ej. "ventas"). Provisiona una instancia
 * nueva en el gateway API, apunta el canal a ella (nuevo QR) y guarda metadata.gateway.
 * API "reemplaza" a evogo; conserva conversaciones/contactos/CRM (cuelgan del channelId).
 */
export async function connectEvolutionApiToChannelAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    redirect("/unauthorized");
  }
  await requireClientWorkspaceAccess("connection");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/conexion?error=Debes+crear+tu+negocio+primero");
  }

  const parsed = connectEvolutionApiSchema.safeParse({
    channelId: getRequiredFormValue(formData, "channelId"),
    gatewayId: getRequiredFormValue(formData, "gatewayId"),
  });
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || "Datos invalidos";
    redirect(`/cliente/conexion?error=${encodeURIComponent(message)}`);
  }

  const channel = await prisma.whatsAppChannel.findFirst({
    where: { id: parsed.data.channelId, workspaceId: membership.workspace.id, provider: "EVOLUTION" },
    select: { id: true },
  });
  if (!channel) {
    redirect("/cliente/conexion?error=Canal+no+encontrado");
  }

  // La URL/apikey salen del catalogo del admin, nunca del formulario.
  const gateways = await getEvolutionGateways();
  const gateway = gateways.find(
    (item) => item.id === parsed.data.gatewayId && item.kind === "EVOLUTION_API",
  );
  if (!gateway) {
    redirect("/cliente/conexion?error=La+conexion+de+Evolution+API+ya+no+existe");
  }

  const detailPath = `/cliente/conexion/whatsapp-business/${channel.id}`;
  try {
    await connectEvolutionApiToChannel({
      channelId: channel.id,
      workspaceId: membership.workspace.id,
      baseUrl: gateway.baseUrl,
      apiKey: gateway.apiKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo conectar Evolution API";
    redirect(`${detailPath}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/cliente/conexion");
  revalidatePath(detailPath);
  redirect(`${detailPath}?ok=${encodeURIComponent("Evolution API conectada. Escanea el QR para vincular.")}`);
}

const deleteConnectionChannelSchema = z.object({
  channelId: z.string().trim().min(1, "Canal invalido"),
});

const assignConnectionChannelSchema = z.object({
  channelId: z.string().trim().min(1, "Canal invalido"),
  agentId: z.string().trim().min(1, "Agente invalido"),
  returnTo: z.string().trim().optional(),
});

const toggleConnectionChannelStatusSchema = z.object({
  channelId: z.string().trim().min(1, "Canal invalido"),
  returnTo: z.string().trim().optional(),
});

export async function deleteConnectionChannelAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    redirect("/unauthorized");
  }
  await requireClientWorkspaceAccess("connection");

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

  await prisma.conversation.deleteMany({ where: { channelId: channel.id } });

  await prisma.whatsAppChannel.delete({
    where: { id: channel.id },
  });

  revalidatePath("/cliente/conexion");
  revalidatePath("/cliente/conexion/whatsapp-business");
  redirect("/cliente/conexion?ok=Canal+eliminado");
}

export async function assignConnectionChannelAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    redirect("/unauthorized");
  }
  await requireClientWorkspaceAccess("connection");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    redirect("/cliente/conexion?error=Debes+crear+tu+negocio+primero");
  }

  const parsed = assignConnectionChannelSchema.safeParse({
    channelId: getRequiredFormValue(formData, "channelId"),
    agentId: getRequiredFormValue(formData, "agentId"),
    returnTo: getOptionalFormValue(formData, "returnTo"),
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
  const returnTo = parsed.data.returnTo?.trim() || "/cliente/conexion";
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}ok=Canal+vinculado+al+agente`);
}

export async function toggleConnectionChannelStatusAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    redirect("/unauthorized");
  }
  await requireClientWorkspaceAccess("connection");

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
