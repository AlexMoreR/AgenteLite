"use server";

import { auth } from "@/auth";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import {
  applyEvolutionChatSyncCandidate,
  applyEvolutionChatSyncCandidates,
  scanEvolutionChatSyncCandidate,
  scanEvolutionChatSyncCandidateByPhone,
  type EvolutionChatSyncApplyResult,
  type EvolutionChatSyncScanResult,
} from "@/lib/evolution-chat-sync";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

// Cualquier fallo del gateway (timeout, 401, "404 page not found") viajaba como excepcion
// hasta el cliente, y Next lo convertia en el error de pantalla completa "No se pudo cargar
// esta pantalla": el usuario perdia la pantalla de Conexion entera y solo veia un codigo.
// El dialogo ya sabe mostrar `{ ok: false, error }`, asi que aqui se traduce todo a eso.
function describeSyncFailure(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const detail = raw.trim().slice(0, 200);
  console.error("[chat-sync] fallo la sincronizacion de chats", error);

  return {
    ok: false as const,
    error: detail
      ? `No pudimos sincronizar los chats: ${detail}`
      : "No pudimos sincronizar los chats. Intenta de nuevo en un momento.",
  };
}

async function requireWorkspace() {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return null;
  }
  // "connection", no "chats": estas son las acciones del panel de Conexion, y la mas pesada
  // del sistema (applyEvolutionChatSyncAction con importLimit: null trae el historial COMPLETO
  // de un canal, crea contactos y golpea al gateway). La pantalla ya exige "connection", pero
  // eso solo esconde el boton: la accion quedaba invocable por cualquiera con acceso a Chats.
  //
  // La sincronizacion que SI tienen las asesoras es la de un contacto suelto desde el chat
  // (importConversationHistoryAction en chats-actions.ts), que pide "chats" y esta acotada a
  // una conversacion.
  await requireClientWorkspaceAccess("connection");

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

  try {
    return await scanEvolutionChatSyncCandidate({
      workspaceId: membership.workspace.id,
      channelId: input.channelId.trim(),
    });
  } catch (error) {
    return describeSyncFailure(error);
  }
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

  try {
    return await scanEvolutionChatSyncCandidateByPhone({
      workspaceId: membership.workspace.id,
      channelId: input.channelId.trim(),
      phoneNumber: input.phoneNumber.trim(),
    });
  } catch (error) {
    return describeSyncFailure(error);
  }
}

// El candidato viaja desde el navegador, asi que se escribe entero en vez de importar el tipo
// del lado servidor: lo que llega es JSON, no la instancia de la libreria.
type CandidateInput = {
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

// Un chat importado aparece en Chats, en Contactos y en la pantalla del canal: si no se
// invalidan, el usuario vuelve y sigue viendo la lista de antes.
async function revalidateAfterChatSync(input: { channelId: string; workspaceId: string }) {
  revalidatePath("/cliente/chats");
  revalidatePath("/cliente/contactos");
  revalidatePath("/cliente/conexion");
  revalidatePath(`/cliente/conexion/whatsapp-business/${input.channelId}`);

  const channel = await prisma.whatsAppChannel.findFirst({
    where: {
      id: input.channelId,
      workspaceId: input.workspaceId,
    },
    select: {
      agentId: true,
    },
  });

  if (channel?.agentId) {
    revalidatePath(`/cliente/agentes/${channel.agentId}/chats`);
    revalidatePath(`/cliente/agentes/${channel.agentId}`);
  }
}

/**
 * Importa TODOS los chats que ofrecio el escaneo, de una.
 *
 * El escaneo de un canal recien vinculado ofrece una docena de chats y el "Agregar" de a uno
 * cierra el dialogo cada vez: doce vueltas de abrir-escanear-elegir-agregar para dejar el CRM
 * como estaba en el telefono.
 */
export async function applyAllEvolutionChatSyncAction(input: {
  channelId: string;
  importLimit?: number | null;
  candidates: CandidateInput[];
}): Promise<{ ok: true; message: string; chats: number; messages: number } | { ok: false; error: string }> {
  const membership = await requireWorkspace();
  if (!membership) {
    return { ok: false, error: "No autorizado" };
  }

  const candidates = (input.candidates ?? []).filter((candidate) => candidate?.remotePhoneNumber?.trim());
  if (!input.channelId.trim() || !candidates.length) {
    return { ok: false, error: "Datos invalidos" };
  }

  let result: Awaited<ReturnType<typeof applyEvolutionChatSyncCandidates>>;
  try {
    result = await applyEvolutionChatSyncCandidates({
      workspaceId: membership.workspace.id,
      channelId: input.channelId.trim(),
      candidates,
      importLimit: input.importLimit,
    });
  } catch (error) {
    return describeSyncFailure(error);
  }

  if (!result.ok) {
    return result;
  }

  await revalidateAfterChatSync({
    channelId: input.channelId.trim(),
    workspaceId: membership.workspace.id,
  });

  // Se informan los que fallaron en el mismo mensaje: un "listo" a secas despues de importar
  // 9 de 12 es mentira, y nadie va a ir a buscar los 3 que faltan.
  const failedSummary = result.failed.length
    ? ` ${result.failed.length} ${result.failed.length === 1 ? "chat quedo" : "chats quedaron"} sin importar (${result.failed
        .slice(0, 3)
        .map((item) => item.phoneNumber)
        .join(", ")}${result.failed.length > 3 ? "…" : ""}).`
    : "";

  return {
    ok: true,
    chats: result.chats,
    messages: result.messages,
    message: `Se importaron ${result.chats} ${result.chats === 1 ? "chat" : "chats"} con ${result.messages} ${
      result.messages === 1 ? "mensaje" : "mensajes"
    }.${failedSummary}`,
  };
}

export async function applyEvolutionChatSyncAction(input: {
  channelId: string;
  // Cantidad de mensajes mas recientes a importar. null = todo el historial.
  importLimit?: number | null;
  candidate: CandidateInput;
}): Promise<EvolutionChatSyncApplyResult> {
  const membership = await requireWorkspace();
  if (!membership) {
    return { ok: false, error: "No autorizado" };
  }

  if (!input.channelId.trim() || !input.candidate?.remotePhoneNumber?.trim()) {
    return { ok: false, error: "Datos invalidos" };
  }

  let result: EvolutionChatSyncApplyResult;
  try {
    result = await applyEvolutionChatSyncCandidate({
      workspaceId: membership.workspace.id,
      channelId: input.channelId.trim(),
      candidate: input.candidate,
      importLimit: input.importLimit,
    });
  } catch (error) {
    return describeSyncFailure(error);
  }

  if (!result.ok) {
    return result;
  }

  await revalidateAfterChatSync({
    channelId: input.channelId.trim(),
    workspaceId: membership.workspace.id,
  });

  return result;
}
