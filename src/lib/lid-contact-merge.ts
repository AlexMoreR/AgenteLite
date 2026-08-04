import { prisma } from "@/lib/prisma";
import { buildLinkedLidMetadata, readLinkedLid } from "@/lib/whatsapp-lid";
import type { Prisma } from "@prisma/client";

/**
 * Unir la ficha "fantasma" de un LID con la ficha real de la persona.
 *
 * WhatsApp identifica al mismo cliente de dos formas: con su telefono, o con un LID. A un lead
 * nuevo suele mandarlo SOLO con el LID, asi que se le crea una ficha con ese id como si fuera un
 * telefono. Cuando mas adelante escribe y WhatsApp si manda el numero, se crea una SEGUNDA ficha.
 * La misma clienta termina dos veces, con dos chats: la asesora contesta en uno, no ve el otro, y
 * el CRM cuenta dos leads donde hay uno.
 *
 * Aca se pasa todo lo de la ficha del LID a la ficha con telefono y se borra la del LID. Se
 * conserva SIEMPRE la del telefono: es la que sirve para llamar y la que el equipo reconoce.
 *
 * Es una operacion que mueve datos, asi que va en una transaccion: o queda todo del lado bueno o
 * no se mueve nada. Nunca a medias, que seria peor que el duplicado.
 */
export async function mergeLidContactIntoPhoneContact(input: {
  workspaceId: string;
  lid: string;
  phoneContactId: string;
}): Promise<{ merged: boolean }> {
  const lidDigits = input.lid.replace(/\D/g, "");
  if (!lidDigits) {
    return { merged: false };
  }

  // La ficha fantasma es la que tiene el LID guardado como si fuera su telefono.
  const fantasma = await prisma.contact.findFirst({
    where: {
      workspaceId: input.workspaceId,
      phoneNumber: lidDigits,
      NOT: { id: input.phoneContactId },
    },
    select: { id: true, name: true },
  });

  if (!fantasma) {
    return { merged: false };
  }

  const real = await prisma.contact.findFirst({
    where: { id: input.phoneContactId, workspaceId: input.workspaceId },
    select: { id: true, name: true, metadata: true },
  });

  if (!real) {
    return { merged: false };
  }

  await prisma.$transaction(async (tx) => {
    const conversacionesFantasma = await tx.conversation.findMany({
      where: { contactId: fantasma.id },
      select: { id: true, channelId: true },
    });

    for (const conversacion of conversacionesFantasma) {
      // Si la persona ya tiene un chat en ESE canal, los mensajes se mudan ahi y queda una sola
      // conversacion con la historia completa. Si no, se reapunta el chat entero.
      const destino = conversacion.channelId
        ? await tx.conversation.findFirst({
            where: { contactId: real.id, channelId: conversacion.channelId },
            select: { id: true },
          })
        : null;

      if (destino) {
        await tx.message.updateMany({
          where: { conversationId: conversacion.id },
          data: { conversationId: destino.id, contactId: real.id },
        });
        await tx.conversation.delete({ where: { id: conversacion.id } });
      } else {
        await tx.message.updateMany({
          where: { conversationId: conversacion.id },
          data: { contactId: real.id },
        });
        await tx.conversation.update({
          where: { id: conversacion.id },
          data: { contactId: real.id },
        });
      }
    }

    await tx.message.updateMany({ where: { contactId: fantasma.id }, data: { contactId: real.id } });
    await tx.callAttempt.updateMany({ where: { contactId: fantasma.id }, data: { contactId: real.id } });
    await tx.follow.updateMany({ where: { contactId: fantasma.id }, data: { contactId: real.id } });

    // Etiquetas: es una tabla de union (contacto + etiqueta), asi que se copian las que la ficha
    // real todavia no tenga y despues se sueltan las de la fantasma.
    const [etiquetasReales, etiquetasFantasma] = await Promise.all([
      tx.contactTag.findMany({ where: { contactId: real.id }, select: { tagId: true } }),
      tx.contactTag.findMany({ where: { contactId: fantasma.id }, select: { tagId: true, workspaceId: true } }),
    ]);
    const yaTiene = new Set(etiquetasReales.map((etiqueta) => etiqueta.tagId));

    for (const etiqueta of etiquetasFantasma) {
      if (yaTiene.has(etiqueta.tagId)) {
        continue;
      }
      await tx.contactTag.create({
        data: { contactId: real.id, tagId: etiqueta.tagId, workspaceId: etiqueta.workspaceId },
      });
    }
    await tx.contactTag.deleteMany({ where: { contactId: fantasma.id } });

    await tx.contact.update({
      where: { id: real.id },
      data: {
        // El nombre del LID suele ser el que puso el cliente en WhatsApp; se usa solo si la ficha
        // real no tiene ninguno, para no pisar lo que escribio una asesora.
        ...(real.name?.trim() ? {} : { name: fantasma.name }),
        metadata: buildLinkedLidMetadata(real.metadata, lidDigits) as Prisma.InputJsonValue,
      },
    });

    await tx.contact.delete({ where: { id: fantasma.id } });
  });

  return { merged: true };
}

/** ¿Esta ficha ya tiene anotado ese LID? Evita repetir trabajo en cada mensaje. */
export function contactAlreadyLinkedToLid(metadata: unknown, lid: string): boolean {
  return readLinkedLid(metadata) === lid.replace(/\D/g, "");
}
