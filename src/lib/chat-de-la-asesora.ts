import { Prisma } from "@prisma/client";

import { FUENTES_DE_ASESORA } from "@/features/agente-v3/motor/aviso-pausa";
import { esMensajeHumano } from "@/lib/anti-bloqueo/reglas";
import { prisma } from "@/lib/prisma";

/**
 * ¿Este chat ya es de la asesora? (tarjeta 8yvjdvpw, 27-nov-2026: "el bot no debe escribir en chats que
 * ya atiende una asesora").
 *
 * Es la pregunta común que hacen los automáticos antes de escribirle al cliente. Un chat es de la
 * asesora si:
 *  - está pausado (`automationPaused`: la IA del V3 no le contesta), o
 *  - tiene asesora asignada y una persona del equipo ya le escribió al menos una vez (CRM = "manual",
 *    celular = "instance"; lo del primer minuto del celular es el automático de la línea, no cuenta:
 *    ver `esMensajeHumano`).
 *
 * Solo lee: no envía nada ni cambia el chat. Si la lectura falla, contesta que SÍ es de la asesora:
 * es mejor perder un toque que pisarla.
 */

/** Lo único que se usa de la base: una lectura con SQL. En las pruebas se pasa un cliente falso. */
export type BaseDeLectura = { $queryRaw: (consulta: Prisma.Sql) => Promise<unknown> };

/** Cuántos mensajes de persona se miran: con uno que cuente alcanza. */
const MENSAJES_A_MIRAR = 20;

type EstadoDelChat = { pausado: boolean; conAsesora: boolean; personaEscribio: boolean } | null;

async function leerEstadoDelChat(conversationId: string, db: BaseDeLectura): Promise<EstadoDelChat> {
  const [charla] = (await db.$queryRaw(Prisma.sql`
    SELECT c."automationPaused" AS "pausado", c."assignedToUserId" AS "asesora", c."startedAt" AS "inicio"
      FROM "Conversation" c
     WHERE c."id" = ${conversationId}
     LIMIT 1`)) as Array<{ pausado: boolean | null; asesora: string | null; inicio: Date | string | null }>;
  if (!charla) return null;
  const mensajes = (await db.$queryRaw(Prisma.sql`
    SELECT m."createdAt", m."rawPayload"->>'source' AS "origen"
      FROM "Message" m
     WHERE m."conversationId" = ${conversationId}
       AND m."direction" = 'OUTBOUND'
       AND m."type" <> 'SYSTEM'
       AND m."rawPayload"->>'source' IN (${Prisma.join([...FUENTES_DE_ASESORA])})
     ORDER BY m."createdAt" DESC
     LIMIT ${MENSAJES_A_MIRAR}`)) as Array<{ createdAt: Date | string; origen: string | null }>;
  const inicio = charla.inicio ? new Date(charla.inicio) : null;
  return {
    pausado: charla.pausado === true,
    conAsesora: Boolean(charla.asesora),
    personaEscribio: mensajes.some((mensaje) => esMensajeHumano({ createdAt: new Date(mensaje.createdAt), origen: mensaje.origen }, inicio)),
  };
}

/** true si el chat es de la asesora (pausado, o asignado y con un mensaje de persona). Ante la duda, true. */
export async function esChatDeLaAsesora(conversationId: string, db: BaseDeLectura = prisma): Promise<boolean> {
  try {
    const estado = await leerEstadoDelChat(conversationId, db);
    if (!estado) return false;
    return estado.pausado || (estado.conAsesora && estado.personaEscribio);
  } catch (error) {
    console.warn("[chat-de-la-asesora] no se pudo leer el chat; se toma como de la asesora", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

/** true si una persona del equipo escribió alguna vez en el chat, sin límite de tiempo. Ante la duda, true. */
export async function hayPersonaEnElChat(conversationId: string, db: BaseDeLectura = prisma): Promise<boolean> {
  try {
    const estado = await leerEstadoDelChat(conversationId, db);
    return Boolean(estado?.personaEscribio);
  } catch (error) {
    console.warn("[chat-de-la-asesora] no se pudo leer el chat; se toma como con persona", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}
