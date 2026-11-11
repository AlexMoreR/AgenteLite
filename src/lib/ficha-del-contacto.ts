import { enmascararTelefono, estaEnModoMonitoreo } from "@/lib/modo-monitoreo";
import { prisma } from "@/lib/prisma";

/**
 * La ficha del contacto (nombre, teléfono, ciudad, dirección, interés y etiquetas), la MISMA que
 * devolvía getContactDetailsAction.
 *
 * Vive aparte porque desde el 10-nov-2026 (velocidad del chat) también viaja dentro de /live al
 * abrir un chat: antes era una acción de servidor que salía en fila detrás de las demás (medido:
 * 0,6-1,4 s cada una, con 3 acciones seguidas por apertura). El que llama ya verificó el permiso.
 * En modo monitoreo el teléfono sale tapado, igual que en la lista.
 */
export type FichaDelContacto = {
  contactId: string;
  name: string;
  phoneNumber: string;
  city: string;
  address: string;
  interested: string;
  tagIds: string[];
  tags: Array<{ id: string; name: string; color: string }>;
  availableTags: Array<{ id: string; name: string; color: string }>;
};

function textoDelMetadata(metadata: unknown, clave: string): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return "";
  }
  const valor = (metadata as Record<string, unknown>)[clave];
  return typeof valor === "string" ? valor : "";
}

export async function leerFichaDelContacto(input: {
  workspaceId: string;
  userId: string;
  contactId: string;
}): Promise<FichaDelContacto | null> {
  const { workspaceId, userId, contactId } = input;
  const [contact, availableTags, taparTelefonos] = await Promise.all([
    prisma.contact.findFirst({
      where: { id: contactId, workspaceId },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        metadata: true,
        ContactTag: {
          orderBy: { createdAt: "asc" },
          select: { tagId: true, Tag: { select: { id: true, name: true, color: true } } },
        },
      },
    }),
    prisma.tag.findMany({
      where: { workspaceId },
      select: { id: true, name: true, color: true },
      orderBy: { createdAt: "asc" },
    }),
    estaEnModoMonitoreo({ workspaceId, userId }),
  ]);

  if (!contact) {
    return null;
  }

  return {
    contactId: contact.id,
    name: contact.name ?? "",
    phoneNumber: taparTelefonos ? enmascararTelefono(contact.phoneNumber) : contact.phoneNumber,
    city: textoDelMetadata(contact.metadata, "city"),
    address: textoDelMetadata(contact.metadata, "address"),
    interested: textoDelMetadata(contact.metadata, "interested"),
    tagIds: contact.ContactTag.map((item) => item.tagId),
    tags: contact.ContactTag.map((item) => item.Tag),
    availableTags,
  };
}
