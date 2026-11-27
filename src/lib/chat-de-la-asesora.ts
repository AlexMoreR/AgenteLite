import { Prisma } from "@prisma/client";

import { FUENTES_DE_ASESORA } from "@/features/agente-v3/motor/aviso-pausa";
import { esMensajeHumano } from "@/lib/anti-bloqueo/reglas";
import { prisma } from "@/lib/prisma";

/**
 * ¿Es un CHAT DE LA ASESORA? (tarjeta 8yvjdvpw, 27-11-2026: «el bot no debe escribir en chats que ya
 * atiende una asesora»). La pregunta común que miran los automáticos antes de escribirle al cliente.
 *
 * Es de la asesora si (cualquiera):
 *  - el chat está pausado (`automationPaused`: la IA no contesta), o
 *  - tiene asesora asignada y una persona ya le escribió al cliente alguna vez (un mensaje saliente
 *    desde el CRM, `manual`, o desde el celular, `instance`; lo del primer minuto del celular es el
 *    automático de la línea y no cuenta: ver `esMensajeHumano`).
 *
 * Solo lee. Si la lectura falla, responde que SÍ: es mejor perder un toque que pisar a la asesora.
 */

/** Lo único que se usa de la base: así las pruebas le pasan una de mentira. */
export type BaseDelChat = Pick<typeof prisma, "$queryRaw">;

type FilaDelChat = { automationPaused: boolean; assignedToUserId: string | null; startedAt: Date | null };

/** El último mensaje de cada fuente de persona: si alguno cuenta como de persona, ya escribió alguien. */
async function personaEscribio(conversationId: string, inicioDeLaCharla: Date | null, db: BaseDelChat): Promise<boolean> {
  const filas = await db.$queryRaw<Array<{ createdAt: Date; origen: string | null }>>(Prisma.sql`
    SELECT DISTINCT ON (m."rawPayload"->>'source') m."createdAt", m."rawPayload"->>'source' AS "origen"
      FROM public."Message" m
     WHERE m."conversationId" = ${conversationId}
       AND m."direction" = 'OUTBOUND' AND m."type" <> 'SYSTEM' AND m."deletedAt" IS NULL
       AND m."rawPayload"->>'source' IN (${Prisma.join([...FUENTES_DE_ASESORA])})
     ORDER BY m."rawPayload"->>'source', m."createdAt" DESC
  `);
  return filas.some((fila) => esMensajeHumano({ createdAt: new Date(fila.createdAt), origen: fila.origen }, inicioDeLaCharla));
}

async function leerChat(conversationId: string, db: BaseDelChat): Promise<FilaDelChat | null> {
  const [fila] = await db.$queryRaw<FilaDelChat[]>(Prisma.sql`
    SELECT c."automationPaused", c."assignedToUserId", c."startedAt"
      FROM public."Conversation" c
     WHERE c."id" = ${conversationId}
  `);
  return fila ?? null;
}

export async function esChatDeLaAsesora(conversationId: string, db: BaseDelChat = prisma): Promise<boolean> {
  try {
    const chat = await leerChat(conversationId, db);
    if (!chat) return false;
    if (chat.automationPaused) return true;
    if (!chat.assignedToUserId) return false;
    return await personaEscribio(conversationId, chat.startedAt ? new Date(chat.startedAt) : null, db);
  } catch (error) {
    console.warn("[chat-de-la-asesora] no se pudo leer el chat; se toma como de la asesora", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

/** ¿Una persona del equipo le escribió alguna vez al cliente en este chat? Sin límite de tiempo. */
export async function hayPersonaEnElChat(conversationId: string, db: BaseDelChat = prisma): Promise<boolean> {
  try {
    const chat = await leerChat(conversationId, db);
    if (!chat) return false;
    return await personaEscribio(conversationId, chat.startedAt ? new Date(chat.startedAt) : null, db);
  } catch (error) {
    console.warn("[chat-de-la-asesora] no se pudo leer el chat; se toma como que escribió una persona", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

/**
 * Lo mismo, desde un Follow (contacto + línea): el chat más reciente del contacto en esa línea. Sin
 * chat, no hay asesora que pisar. Si la lectura falla, SÍ.
 */
export async function esChatDeLaAsesoraDelContacto(
  input: { workspaceId: string; contactId: string; channelId: string | null },
  db: BaseDelChat = prisma,
): Promise<{ deLaAsesora: boolean; conversationId: string | null }> {
  try {
    const [chat] = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT c."id"
        FROM public."Conversation" c
       WHERE c."workspaceId" = ${input.workspaceId}
         AND c."contactId" = ${input.contactId}
         ${input.channelId ? Prisma.sql`AND c."channelId" = ${input.channelId}` : Prisma.empty}
       ORDER BY c."lastMessageAt" DESC NULLS LAST
       LIMIT 1
    `);
    if (!chat) return { deLaAsesora: false, conversationId: null };
    return { deLaAsesora: await esChatDeLaAsesora(chat.id, db), conversationId: chat.id };
  } catch (error) {
    console.warn("[chat-de-la-asesora] no se pudo buscar el chat del contacto; se toma como de la asesora", {
      contactId: input.contactId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { deLaAsesora: true, conversationId: null };
  }
}
