"use server";

import { auth } from "@/auth";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import {
  applyEvolutionChatSyncCandidate,
  scanEvolutionChatSyncCandidate,
  scanEvolutionChatSyncCandidateByPhone,
  type EvolutionChatSyncApplyResult,
  type EvolutionChatSyncScanResult,
} from "@/lib/evolution-chat-sync";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

async function requireWorkspace() {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return null;
  }
  await requireClientWorkspaceAccess("chats");

  return getPrimaryWorkspaceForUser(session.user.id);
}

export async function scanEvolutionChatSyncAction(input: {
  channelId: string;
}): Promise<EvolutionChatSyncScanResult | { ok: false; error: string }> {
  const membership = await requireWorkspace();
  if (!membership) {
    return { ok: false, error: "No autorizado" };
  }

  if (!input.channelId.trim()) {
    return { ok: false, error: "Canal invalido" };
  }

  return scanEvolutionChatSyncCandidate({
    workspaceId: membership.workspace.id,
    channelId: input.channelId.trim(),
  });
}

export async function scanEvolutionChatSyncByPhoneAction(input: {
  channelId: string;
  phoneNumber: string;
}): Promise<EvolutionChatSyncScanResult | { ok: false; error: string }> {
  const membership = await requireWorkspace();
  if (!membership) {
    return { ok: false, error: "No autorizado" };
  }

  if (!input.channelId.trim()) {
    return { ok: false, error: "Canal invalido" };
  }

  if (!input.phoneNumber.trim()) {
    return { ok: false, error: "Ingresa un numero de telefono para sincronizar." };
  }

  return scanEvolutionChatSyncCandidateByPhone({
    workspaceId: membership.workspace.id,
    channelId: input.channelId.trim(),
    phoneNumber: input.phoneNumber.trim(),
  });
}

export async function applyEvolutionChatSyncAction(input: {
  channelId: string;
  candidate: {
    fingerprint: string;
    kind: "CONTACT" | "CONVERSATION";
    remotePhoneNumber: string;
    remoteDisplayName: string | null;
    remoteJid: string | null;
    remoteJidAlt: string | null;
    remoteItemId: string | null;
    summary: string;
    needsContact: boolean;
    needsConversation: boolean;
    needsMessages: boolean;
    messagePreview: Array<{
      id: string;
      direction: "INBOUND" | "OUTBOUND";
      type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM";
      content: string | null;
      createdAt: string;
      mediaUrl: string | null;
    }>;
  };
}): Promise<EvolutionChatSyncApplyResult> {
  const membership = await requireWorkspace();
  if (!membership) {
    return { ok: false, error: "No autorizado" };
  }

  if (!input.channelId.trim() || !input.candidate?.remotePhoneNumber?.trim()) {
    return { ok: false, error: "Datos invalidos" };
  }

  const result = await applyEvolutionChatSyncCandidate({
    workspaceId: membership.workspace.id,
    channelId: input.channelId.trim(),
    candidate: input.candidate,
  });

  if (!result.ok) {
    return result;
  }

  revalidatePath("/cliente/chats");
  revalidatePath("/cliente/contactos");
  revalidatePath("/cliente/conexion");
  revalidatePath(`/cliente/conexion/whatsapp-business/${input.channelId.trim()}`);

  const channel = await prisma.whatsAppChannel.findFirst({
    where: {
      id: input.channelId.trim(),
      workspaceId: membership.workspace.id,
    },
    select: {
      agentId: true,
    },
  });

  if (channel?.agentId) {
    revalidatePath(`/cliente/agentes/${channel.agentId}/chats`);
    revalidatePath(`/cliente/agentes/${channel.agentId}`);
  }

  return result;
}
