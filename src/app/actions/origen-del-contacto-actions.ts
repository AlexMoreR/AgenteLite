"use server";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { leerMapaDeLineas } from "@/lib/origen-de-venta-crm";
import { clasificarOrigenDelCliente, type OrigenDelCliente } from "@/lib/origen-del-cliente";

/**
 * Origen del cliente de un contacto, para la línea "Origen" de la ficha del chat. Solo lectura.
 *
 * Permiso: el mismo que para ver la bandeja (módulo "chats"); el contacto se busca SIEMPRE dentro del
 * negocio de quien pregunta. Si algo falla devuelve error y la ficha simplemente no muestra la línea.
 */
export async function leerOrigenDelContactoAction(input: {
  contactId: string;
}): Promise<{ origen: OrigenDelCliente } | { error: string }> {
  const access = await requireClientWorkspaceAccess("chats");
  const contactId = typeof input?.contactId === "string" ? input.contactId.trim() : "";
  if (!contactId) return { error: "Falta el contacto" };
  try {
    const contacto = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId: access.workspaceId },
      select: { metadata: true },
    });
    if (!contacto) return { error: "No existe ese contacto" };
    // La línea del primer chat del contacto (por donde llegó).
    const [primerChat, mapa] = await Promise.all([
      prisma.conversation.findFirst({
        where: { workspaceId: access.workspaceId, contactId, channelId: { not: null } },
        orderBy: { startedAt: "asc" },
        select: { channel: { select: { id: true, name: true, purpose: true, metadata: true } } },
      }),
      leerMapaDeLineas(access.workspaceId),
    ]);
    const canal = primerChat?.channel;
    return {
      origen: clasificarOrigenDelCliente({
        metadataContacto: contacto.metadata,
        linea: canal ? { channelId: canal.id, nombre: canal.name, purpose: canal.purpose, metadata: canal.metadata } : null,
        mapa,
      }),
    };
  } catch (error) {
    console.error("[origen-del-contacto] no se pudo leer", error);
    return { error: "No se pudo leer el origen" };
  }
}
