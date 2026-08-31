import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

const DEFAULT_NEW_LEAD_TAG_NAME = "Nuevo lead";
const DEFAULT_NEW_LEAD_TAG_SLUG = "nuevo-lead";
const DEFAULT_NEW_LEAD_TAG_COLOR = "#0f172a";

const DEFAULT_ACTIVE_LEAD_TAG_NAME = "Lead";
const DEFAULT_ACTIVE_LEAD_TAG_SLUG = "lead";
const DEFAULT_ACTIVE_LEAD_TAG_COLOR = "#2563eb";

async function ensureWorkspaceTag(input: {
  workspaceId: string;
  slug: string;
  name: string;
  color: string;
  syncExistingValues?: boolean;
}) {
  const existing = await prisma.tag.findFirst({
    where: {
      workspaceId: input.workspaceId,
      slug: input.slug,
    },
    select: {
      id: true,
      name: true,
      color: true,
    },
  });

  if (existing) {
    if (input.syncExistingValues && (existing.name !== input.name || existing.color !== input.color)) {
      await prisma.tag.update({
        where: {
          id: existing.id,
        },
        data: {
          name: input.name,
          color: input.color,
          updatedAt: new Date(),
        },
      });
    }

    return existing;
  }

  return prisma.tag.create({
    data: {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      slug: input.slug,
      color: input.color,
      updatedAt: new Date(),
    },
    select: {
      id: true,
      name: true,
      color: true,
    },
  });
}

async function assignTagToContact(input: { workspaceId: string; contactId: string; tagId: string }) {
  try {
    await prisma.contactTag.upsert({
      where: {
        contactId_tagId: {
          contactId: input.contactId,
          tagId: input.tagId,
        },
      },
      create: {
        contactId: input.contactId,
        tagId: input.tagId,
        workspaceId: input.workspaceId,
      },
      update: {},
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Unique constraint failed")
    ) {
      return;
    }
    throw error;
  }
}

async function removeTagFromContact(input: { contactId: string; tagId: string }) {
  await prisma.contactTag.deleteMany({
    where: {
      contactId: input.contactId,
      tagId: input.tagId,
    },
  });
}

export async function syncLeadLifecycleForContact(input: {
  workspaceId: string;
  contactId: string;
  hasHistory: boolean;
  newLeadTagName?: string;
}) {
  const newLeadTag = await ensureWorkspaceTag({
    workspaceId: input.workspaceId,
    slug: DEFAULT_NEW_LEAD_TAG_SLUG,
    name: input.newLeadTagName?.trim() || DEFAULT_NEW_LEAD_TAG_NAME,
    color: DEFAULT_NEW_LEAD_TAG_COLOR,
    syncExistingValues: true,
  });

  const activeLeadTag = await ensureWorkspaceTag({
    workspaceId: input.workspaceId,
    slug: DEFAULT_ACTIVE_LEAD_TAG_SLUG,
    name: DEFAULT_ACTIVE_LEAD_TAG_NAME,
    color: DEFAULT_ACTIVE_LEAD_TAG_COLOR,
    syncExistingValues: false,
  });

  if (input.hasHistory) {
    await removeTagFromContact({
      contactId: input.contactId,
      tagId: newLeadTag.id,
    });
    await assignTagToContact({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      tagId: activeLeadTag.id,
    });

    return { state: "active" as const, tagId: activeLeadTag.id };
  }

  await removeTagFromContact({
    contactId: input.contactId,
    tagId: activeLeadTag.id,
  });
  await assignTagToContact({
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    tagId: newLeadTag.id,
  });

  return { state: "new" as const, tagId: newLeadTag.id };
}

/**
 * Las etiquetas de ciclo de vida de MUCHOS contactos, de una sola vez.
 *
 * La bandeja llamaba a syncLeadLifecycleForContact por cada contacto de la lista, en CADA carga de
 * la pantalla. Son unas seis consultas por contacto: con 20 contactos en pantalla, 120 consultas
 * -casi todas escrituras- cada vez que alguien abre o refresca los chats, y practicamente siempre
 * para dejar todo como ya estaba. Con varias asesoras trabajando eso es una tormenta constante
 * contra la base, y era ademas de donde salian los errores de "Unique constraint failed" en el log
 * (dos cargas simultaneas insertando la misma etiqueta a la vez).
 *
 * Aca se hace lo mismo con seis consultas EN TOTAL, y solo se escribe lo que de verdad cambia.
 */
export async function syncLeadLifecycleForContacts(input: {
  workspaceId: string;
  contactIds: string[];
  /** Los que ya tienen historial: alguien les hablo alguna vez. */
  conHistorial: Set<string>;
  newLeadTagName?: string;
}): Promise<{ revisados: number; cambiados: number }> {
  const contactIds = Array.from(new Set(input.contactIds)).filter(Boolean);
  if (contactIds.length === 0) {
    return { revisados: 0, cambiados: 0 };
  }

  const [tagNuevo, tagActivo] = await Promise.all([
    ensureWorkspaceTag({
      workspaceId: input.workspaceId,
      slug: DEFAULT_NEW_LEAD_TAG_SLUG,
      name: input.newLeadTagName?.trim() || DEFAULT_NEW_LEAD_TAG_NAME,
      color: DEFAULT_NEW_LEAD_TAG_COLOR,
      syncExistingValues: true,
    }),
    ensureWorkspaceTag({
      workspaceId: input.workspaceId,
      slug: DEFAULT_ACTIVE_LEAD_TAG_SLUG,
      name: DEFAULT_ACTIVE_LEAD_TAG_NAME,
      color: DEFAULT_ACTIVE_LEAD_TAG_COLOR,
      syncExistingValues: false,
    }),
  ]);

  // Como esta cada uno HOY. Una sola consulta para toda la lista.
  const puestas = await prisma.contactTag.findMany({
    where: {
      contactId: { in: contactIds },
      tagId: { in: [tagNuevo.id, tagActivo.id] },
    },
    select: { contactId: true, tagId: true },
  });

  const tieneNuevo = new Set<string>();
  const tieneActivo = new Set<string>();
  for (const fila of puestas) {
    if (fila.tagId === tagNuevo.id) tieneNuevo.add(fila.contactId);
    if (fila.tagId === tagActivo.id) tieneActivo.add(fila.contactId);
  }

  const ponerNuevo: string[] = [];
  const ponerActivo: string[] = [];
  const sacarNuevo: string[] = [];
  const sacarActivo: string[] = [];

  for (const contactId of contactIds) {
    if (input.conHistorial.has(contactId)) {
      if (!tieneActivo.has(contactId)) ponerActivo.push(contactId);
      if (tieneNuevo.has(contactId)) sacarNuevo.push(contactId);
    } else {
      if (!tieneNuevo.has(contactId)) ponerNuevo.push(contactId);
      if (tieneActivo.has(contactId)) sacarActivo.push(contactId);
    }
  }

  const cambiados =
    ponerNuevo.length + ponerActivo.length + sacarNuevo.length + sacarActivo.length;
  if (cambiados === 0) {
    // El caso normal: no se escribe NADA.
    return { revisados: contactIds.length, cambiados: 0 };
  }

  await Promise.all([
    sacarNuevo.length
      ? prisma.contactTag.deleteMany({
          where: { tagId: tagNuevo.id, contactId: { in: sacarNuevo } },
        })
      : Promise.resolve(null),
    sacarActivo.length
      ? prisma.contactTag.deleteMany({
          where: { tagId: tagActivo.id, contactId: { in: sacarActivo } },
        })
      : Promise.resolve(null),
  ]);

  const aInsertar = [
    ...ponerNuevo.map((contactId) => ({
      contactId,
      tagId: tagNuevo.id,
      workspaceId: input.workspaceId,
    })),
    ...ponerActivo.map((contactId) => ({
      contactId,
      tagId: tagActivo.id,
      workspaceId: input.workspaceId,
    })),
  ];
  if (aInsertar.length) {
    // skipDuplicates y no upsert: dos cargas a la vez insertando lo mismo es NORMAL aca, y con el
    // upsert una de las dos reventaba con "Unique constraint failed" y ensuciaba el log.
    await prisma.contactTag.createMany({ data: aInsertar, skipDuplicates: true });
  }

  return { revisados: contactIds.length, cambiados };
}

export async function ensureNewLeadTagForContact(input: {
  workspaceId: string;
  contactId: string;
  tagName?: string;
}) {
  return syncLeadLifecycleForContact({
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    hasHistory: false,
    newLeadTagName: input.tagName,
  });
}
