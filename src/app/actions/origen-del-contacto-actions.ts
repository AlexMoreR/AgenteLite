"use server";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { origenDelCliente, type OrigenDelCliente } from "@/lib/origen-del-cliente";
import { leerMapaDeLineas } from "@/lib/origen-de-venta-crm";
import { prisma } from "@/lib/prisma";

/**
 * De dónde llegó un contacto (anuncio, Marketplace u orgánico), para la ficha del chat. Solo lectura.
 *
 * Permiso: el mismo que para ver la bandeja (módulo "chats" del negocio). El contacto se busca SIEMPRE
 * dentro del negocio de quien pregunta. Si algo falla, la ficha sigue sin la línea "Origen".
 */
export async function leerOrigenDelContactoAction(
  contactId: string,
): Promise<{ origen: OrigenDelCliente } | { error: string }> {
  const access = await requireClientWorkspaceAccess("chats");
  const id = typeof contactId === "string" ? contactId.trim() : "";
  if (!id) return { error: "Falta el contacto" };
  try {
    const [contacto, primerChat, mapa] = await Promise.all([
      prisma.contact.findFirst({ where: { id, workspaceId: access.workspaceId }, select: { metadata: true } }),
      prisma.conversation.findFirst({
        where: { workspaceId: access.workspaceId, contactId: id, channelId: { not: null } },
        orderBy: { startedAt: "asc" },
        select: { channel: { select: { id: true, name: true, purpose: true, metadata: true } } },
      }),
      leerMapaDeLineas(access.workspaceId),
    ]);
    if (!contacto) return { error: "Contacto no encontrado" };
    const canal = primerChat?.channel;
    const linea = canal ? { channelId: canal.id, nombre: canal.name, purpose: canal.purpose, metadata: canal.metadata } : null;
    return { origen: origenDelCliente({ metadataContacto: contacto.metadata, linea, mapa }) };
  } catch (error) {
    console.error("[origen-del-contacto] no se pudo leer", error);
    return { error: "No se pudo leer el origen" };
  }
}
