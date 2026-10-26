"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { leerMapaDeLineas } from "@/lib/origen-de-venta-crm";
import { origenDelCliente, type OrigenDelCliente } from "@/lib/origen-del-cliente";

/**
 * Origen del cliente para la ficha del chat (solo lectura). Misma revisión de permisos que la ficha:
 * sesión, acceso a "chats" y mismo negocio. Si algo falla devuelve null: la ficha sigue sin la línea.
 */
export async function getOrigenDelContactoAction(contactId: string): Promise<OrigenDelCliente | null> {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
      return null;
    }
    await requireClientWorkspaceAccess("chats");
    const membership = await getPrimaryWorkspaceForUser(session.user.id);
    if (!membership) return null;
    const workspaceId = membership.workspace.id;

    const contacto = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId },
      select: {
        metadata: true,
        // La línea por la que llegó: la de su primera conversación.
        conversations: {
          where: { channelId: { not: null } },
          orderBy: { startedAt: "asc" },
          take: 1,
          select: { channel: { select: { id: true, name: true, purpose: true, metadata: true } } },
        },
      },
    });
    if (!contacto) return null;

    const canal = contacto.conversations[0]?.channel ?? null;
    const mapa = await leerMapaDeLineas(workspaceId);
    return origenDelCliente(
      contacto.metadata,
      canal ? { channelId: canal.id, nombre: canal.name, purpose: canal.purpose, metadata: canal.metadata } : null,
      mapa,
    );
  } catch {
    return null;
  }
}
