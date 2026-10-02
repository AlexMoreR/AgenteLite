"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { bloquearContacto, desbloquearContacto, type ResultadoDeBloqueo } from "@/lib/bloqueo-de-contactos";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";

/**
 * Bloquear y desbloquear un contacto (ver lib/bloqueo-de-contactos).
 *
 * SOLO dueño y admin del negocio, a pedido de Alex: la supervisora no. Bloquear corta al cliente
 * en WhatsApp y lo saca de todas las pantallas, y eso es una decisión del negocio, no del turno.
 */

type Respuesta =
  | { ok: true; lineasConError: Array<{ linea: string; error: string }>; chatIds: string[] }
  | { error: string };

async function quienPuedeBloquear() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }
  // La misma regla de "jefe" que usa la bandeja para mostrar la opcion (page.tsx).
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !(access.isOwner || access.role === "ADMIN")) {
    return null;
  }
  return { userId: session.user.id, userName: session.user.name ?? null, workspaceId: access.workspaceId };
}

function responder(resultado: ResultadoDeBloqueo | { error: string }): Respuesta {
  if ("error" in resultado) {
    return { error: resultado.error };
  }
  revalidatePath("/cliente/chats");
  revalidatePath("/cliente/contactos");
  return { ok: true, lineasConError: resultado.lineasConError, chatIds: resultado.chatIds };
}

export async function bloquearContactoAction(input: { contactId: string }): Promise<Respuesta> {
  const quien = await quienPuedeBloquear();
  if (!quien) {
    return { error: "Solo el dueño o un administrador pueden bloquear contactos." };
  }
  const contactId = typeof input?.contactId === "string" ? input.contactId.trim() : "";
  if (!contactId) {
    return { error: "Datos inválidos" };
  }
  return responder(await bloquearContacto({ ...quien, contactId }));
}

export async function desbloquearContactoAction(input: { contactId: string }): Promise<Respuesta> {
  const quien = await quienPuedeBloquear();
  if (!quien) {
    return { error: "Solo el dueño o un administrador pueden desbloquear contactos." };
  }
  const contactId = typeof input?.contactId === "string" ? input.contactId.trim() : "";
  if (!contactId) {
    return { error: "Datos inválidos" };
  }
  return responder(await desbloquearContacto({ workspaceId: quien.workspaceId, contactId }));
}
