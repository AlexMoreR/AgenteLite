import { Prisma } from "@prisma/client";

import { FUENTES_DE_ASESORA } from "@/features/agente-v3/motor/aviso-pausa";
import { esMensajeHumano } from "@/lib/anti-bloqueo/reglas";
import { prisma } from "@/lib/prisma";

/**
 * ¿ESTE CHAT ES DE LA ASESORA? (tarjeta axybzjk7, 27-nov-2026: "el bot no debe escribir en chats que ya
 * atiende una asesora"). La pregunta común que se hacen los automáticos antes de escribirle al cliente.
 *
 * Es de la asesora si:
 *  - el chat está pausado (`automationPaused`: la IA no contesta), o
 *  - tiene asesora asignada y una persona ya le escribió al cliente (desde el CRM, `manual`, o desde el
 *    celular, `instance`, sin contar el automático del primer minuto: ver `esMensajeHumano`).
 *
 * Solo lee: no envía ni cambia nada. Si la lectura falla, responde que SÍ es de la asesora: es mejor
 * perder un toque que pisarla.
 */

/** Lo único que se usa de la base: una lectura SQL. En las pruebas se cambia por una base de mentira. */
export type BaseDelChat = {
  $queryRaw: <T = unknown>(consulta: Prisma.Sql) => Promise<T>;
};

type FilaDelChat = { pausado: boolean; asignado: boolean; inicio: Date | null };
type FilaDePersona = { origen: string | null; ultimo: Date | null };

type LecturaDelChat = { pausado: boolean; asignado: boolean; personaEscribio: boolean };

/** null = el chat no existe. */
async function leerChat(conversationId: string, db: BaseDelChat): Promise<LecturaDelChat | null> {
  const [chat] = await db.$queryRaw<FilaDelChat[]>(Prisma.sql`
    SELECT c."automationPaused" AS "pausado",
           (c."assignedToUserId" IS NOT NULL) AS "asignado",
           c."startedAt" AS "inicio"
      FROM "Conversation" c
     WHERE c."id" = ${conversationId}
     LIMIT 1
  `);
  if (!chat) return null;
  /*
    Lo último que escribió una persona por cada fuente. Basta con el último: si alguno del celular cuenta
    como persona (pasado el primer minuto), el último del celular también cuenta.
  */
  const personas = await db.$queryRaw<FilaDePersona[]>(Prisma.sql`
    SELECT m."rawPayload"->>'source' AS "origen", MAX(m."createdAt") AS "ultimo"
      FROM "Message" m
     WHERE m."conversationId" = ${conversationId}
       AND m."direction" = 'OUTBOUND'
       AND m."type" <> 'SYSTEM'
       AND m."rawPayload"->>'source' IN (${Prisma.join([...FUENTES_DE_ASESORA])})
     GROUP BY 1
  `);
  const inicio = chat.inicio ? new Date(chat.inicio) : null;
  const personaEscribio = personas.some(
    (fila) => fila.ultimo !== null && esMensajeHumano({ createdAt: new Date(fila.ultimo), origen: fila.origen }, inicio),
  );
  return { pausado: chat.pausado === true, asignado: chat.asignado === true, personaEscribio };
}

/** true = el chat lo atiende una asesora y ningún automático le escribe al cliente. */
export async function esChatDeLaAsesora(conversationId: string, db: BaseDelChat = prisma): Promise<boolean> {
  try {
    const chat = await leerChat(conversationId, db);
    if (!chat) return false;
    return chat.pausado || (chat.asignado && chat.personaEscribio);
  } catch (error) {
    console.error("[chat-de-la-asesora] no se pudo leer el chat; se toma como de la asesora", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

/** true = una persona del equipo le escribió alguna vez al cliente en este chat (sin límite de tiempo). */
export async function hayPersonaEnElChat(conversationId: string, db: BaseDelChat = prisma): Promise<boolean> {
  try {
    const chat = await leerChat(conversationId, db);
    return chat?.personaEscribio ?? false;
  } catch (error) {
    console.error("[chat-de-la-asesora] no se pudo leer el chat; se toma como con persona", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}
