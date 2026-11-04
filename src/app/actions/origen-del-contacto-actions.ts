"use server";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { leerMapaDeLineas, lineaDelPrimerChat } from "@/lib/origen-de-venta-crm";
import { origenDelCliente, type OrigenDelCliente } from "@/lib/origen-del-cliente";

/**
 * Origen del cliente para la ficha del chat. Solo lectura.
 *
 * Permiso: el mismo que para ver la bandeja (módulo "chats" del negocio). El contacto se busca
 * SIEMPRE dentro del negocio de quien pregunta. La campaña sale de OrigenDePauta (también del negocio).
 */
export async function leerOrigenDelContactoAction(input: {
  contactId: string;
}): Promise<{ origen: OrigenDelCliente } | { error: string }> {
  const access = await requireClientWorkspaceAccess("chats");
  const contactId = typeof input?.contactId === "string" ? input.contactId.trim() : "";
  if (!contactId) return { error: "Falta el contacto" };
  try {
    const [contacto, linea, mapa, pauta] = await Promise.all([
      prisma.contact.findFirst({ where: { id: contactId, workspaceId: access.workspaceId }, select: { metadata: true } }),
      lineaDelPrimerChat(access.workspaceId, contactId),
      leerMapaDeLineas(access.workspaceId),
      // Si esta lectura falla, la ficha sale igual, sin la campaña.
      prisma.origenDePauta
        .findUnique({
          where: { workspaceId_contactId: { workspaceId: access.workspaceId, contactId } },
          select: { campanaId: true, campanaNombre: true },
        })
        .catch(() => null),
    ]);
    if (!contacto) return { error: "No se encontró el contacto" };
    return { origen: origenDelCliente({ metadataContacto: contacto.metadata, linea, mapa, pauta }) };
  } catch (error) {
    console.error("[origen-del-contacto] no se pudo leer", error);
    return { error: "No se pudo leer el origen" };
  }
}
