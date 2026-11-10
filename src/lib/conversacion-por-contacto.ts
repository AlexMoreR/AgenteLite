import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * El id de la conversacion de este contacto en este canal, siempre el mismo.
 *
 * No es un identificador con significado: es el candado. Dos webhooks simultaneos calculan el
 * mismo id y la base deja crear una sola.
 */
export function idDeConversacion(workspaceId: string, channelId: string, contactId: string): string {
  const huella = createHash("sha1")
    .update(`${workspaceId}|${channelId}|${contactId}`)
    .digest("hex")
    .slice(0, 24);
  // El prefijo lo distingue a simple vista de los cuid de siempre al mirar la base.
  return `cv${huella}`;
}


export async function resolveConversationWithLock(args: {
  workspaceId: string;
  channelId: string;
  contactId: string;
  agentId: string | null;
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const existingConversation = await prisma.conversation.findFirst({
        where: {
          workspaceId: args.workspaceId,
          channelId: args.channelId,
          contactId: args.contactId,
        },
        orderBy: {
          updatedAt: "desc",
        },
        select: {
          id: true,
          status: true,
          activeProductContext: true,
          commercialContext: true,
        },
      });

      if (existingConversation) {
        return {
          id: existingConversation.id,
          status: existingConversation.status,
          activeProductContext: existingConversation.activeProductContext ?? null,
          commercialContext: existingConversation.commercialContext ?? null,
        };
      }

      const createdConversation = await prisma.conversation.create({
        data: {
          /*
            El id se CALCULA a partir del negocio, el canal y el contacto.

            Esta funcion ya reintentaba al chocar con un duplicado (P2002), pero ese choque no
            pasaba NUNCA: no hay restriccion de unicidad sobre (canal, contacto), asi que dos
            mensajes que entran a la vez pasaban los dos por el findFirst sin encontrar nada y
            creaban DOS conversaciones. Medido el 2-sep-2026: 12 contactos en 7 dias con dos
            conversaciones creadas con milisegundos de diferencia. Y dos conversaciones son dos
            bienvenidas: el cliente recibia el saludo repetido.

            Con el id calculado, las dos creaciones simultaneas piden la MISMA clave primaria: una
            gana, la otra recibe P2002, y el reintento que ya existia hace su trabajo -vuelve a
            buscar y encuentra la que gano-.

            Las conversaciones viejas conservan su id: el findFirst de arriba las sigue
            encontrando, asi que para ellas no cambia nada.
          */
          id: idDeConversacion(args.workspaceId, args.channelId, args.contactId),
          workspaceId: args.workspaceId,
          channelId: args.channelId,
          agentId: args.agentId,
          contactId: args.contactId,
          status: "OPEN",
          lastMessageAt: new Date(),
        },
        select: {
          id: true,
          status: true,
          activeProductContext: true,
          commercialContext: true,
        },
      });

      return {
        id: createdConversation.id,
        status: createdConversation.status,
        activeProductContext: createdConversation.activeProductContext ?? null,
        commercialContext: createdConversation.commercialContext ?? null,
      };
    } catch (error) {
      const isDuplicateConversation =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002";

      if (isDuplicateConversation && attempt < 2) {
        await sleep(50 * (attempt + 1));
        continue;
      }

      if (!isDuplicateConversation || attempt === 2) {
        throw error;
      }
    }
  }

  return null;
}
