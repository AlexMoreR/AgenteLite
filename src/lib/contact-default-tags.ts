import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

const DEFAULT_NEW_LEAD_TAG_NAME = "Nuevo lead";
const DEFAULT_NEW_LEAD_TAG_SLUG = "nuevo-lead";
const DEFAULT_NEW_LEAD_TAG_COLOR = "#0f172a";

/*
  YA NO HAY ETIQUETA "Lead".

  El ciclo era: contacto nuevo -> "Nuevo lead"; en cuanto tenia historial -> "Lead". Resultado:
  2.803 contactos con la misma chapita "LEAD" al lado de cada chat, que no distinguia nada -todos
  los contactos del CRM son leads- y le quitaba lugar a las etiquetas que si dicen algo (Alex,
  30-09-2026: "ya se sabe que es un lead"). Se borro de la base en la migracion
  20260930190000_quitar_etiqueta_lead. "Nuevo lead" sigue: esa si separa a quien todavia no hablo.
*/

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

/**
 * Le pone una etiqueta a un contacto. Si ya la tiene, no pasa nada.
 *
 * Va con createMany y skipDuplicates, no con upsert. El upsert atrapaba el choque y seguia, pero
 * Prisma YA habia escrito el error en el registro antes de que ese catch existiera: el log de
 * produccion se llenaba de "Unique constraint failed on (contactId, tagId)" por algo que no es un
 * problema. Que dos mensajes del mismo contacto entren a la vez y los dos quieran ponerle la misma
 * etiqueta es NORMAL aca.
 *
 * Un registro lleno de errores que no importan es peor que no tener registro: se deja de mirar, y
 * el dia que aparece uno de verdad pasa desapercibido.
 */
async function assignTagToContact(input: { workspaceId: string; contactId: string; tagId: string }) {
  await prisma.contactTag.createMany({
    data: [{ contactId: input.contactId, tagId: input.tagId, workspaceId: input.workspaceId }],
    skipDuplicates: true,
  });
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

  // Con historial deja de ser "nuevo": se le quita y no se le pone ninguna otra en su lugar.
  if (input.hasHistory) {
    await removeTagFromContact({
      contactId: input.contactId,
      tagId: newLeadTag.id,
    });

    return { state: "active" as const, tagId: null };
  }

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

  const tagNuevo = await ensureWorkspaceTag({
    workspaceId: input.workspaceId,
    slug: DEFAULT_NEW_LEAD_TAG_SLUG,
    name: input.newLeadTagName?.trim() || DEFAULT_NEW_LEAD_TAG_NAME,
    color: DEFAULT_NEW_LEAD_TAG_COLOR,
    syncExistingValues: true,
  });

  // Como esta cada uno HOY. Una sola consulta para toda la lista.
  const puestas = await prisma.contactTag.findMany({
    where: { contactId: { in: contactIds }, tagId: tagNuevo.id },
    select: { contactId: true },
  });
  const tieneNuevo = new Set(puestas.map((fila) => fila.contactId));

  const ponerNuevo: string[] = [];
  const sacarNuevo: string[] = [];

  for (const contactId of contactIds) {
    if (input.conHistorial.has(contactId)) {
      if (tieneNuevo.has(contactId)) sacarNuevo.push(contactId);
    } else if (!tieneNuevo.has(contactId)) {
      ponerNuevo.push(contactId);
    }
  }

  const cambiados = ponerNuevo.length + sacarNuevo.length;
  if (cambiados === 0) {
    // El caso normal: no se escribe NADA.
    return { revisados: contactIds.length, cambiados: 0 };
  }

  if (sacarNuevo.length) {
    await prisma.contactTag.deleteMany({
      where: { tagId: tagNuevo.id, contactId: { in: sacarNuevo } },
    });
  }

  const aInsertar = ponerNuevo.map((contactId) => ({
    contactId,
    tagId: tagNuevo.id,
    workspaceId: input.workspaceId,
  }));
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
