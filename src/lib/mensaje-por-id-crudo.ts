import { Prisma, type MessageStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { idCrudoDeMensaje } from "@/lib/waha";

/** Por debajo de este largo, un id raro y corto podria coincidir con cualquier cosa por casualidad. */
const LARGO_MINIMO_DEL_CRUDO = 8;

export type MensajePorIdCrudo = {
  id: string;
  status: MessageStatus;
  workspaceId: string;
  conversationId: string;
  content: string | null;
  deletedAt: Date | null;
};

/**
 * El mensaje de esta linea con este id de WAHA: el id exacto, o uno que termine en `_<id crudo>`
 * (ver `idCrudoDeMensaje`: al enviar el id viene compuesto con el numero y en el acuse con el LID).
 * Si hay varios, el mas nuevo.
 *
 * Antes era un `findFirst` con `channel: { evolutionInstanceName }` y `endsWith`: un JOIN con la
 * linea y un `LIKE '%_...'` que ningun indice sirve, asi que cada acuse (2 a 4 por mensaje enviado)
 * recorria Message, unos 170 ms. Ahora se compara el ultimo pedazo despues del ultimo `_`, que es
 * lo que guarda el indice "Message_channel_idCrudo_idx", y la busqueda es por indice.
 *
 * Da el mismo mensaje que antes: el crudo sale de un `split("_")`, nunca trae `_`, asi que "termina
 * en `_` + crudo" es lo mismo que "tiene un `_` y el pedazo despues del ultimo es el crudo".
 */
export async function buscarMensajePorIdCrudo(
  channelId: string,
  idMensaje: string,
): Promise<MensajePorIdCrudo | null> {
  const crudo = idCrudoDeMensaje(idMensaje);
  // La expresion tiene que ser identica a la del indice, o Postgres no lo usa.
  const porCrudo =
    crudo.length >= LARGO_MINIMO_DEL_CRUDO
      ? Prisma.sql`OR (reverse(split_part(reverse(m."externalId"), '_', 1)) = ${crudo}
          AND strpos(m."externalId", '_') > 0)`
      : Prisma.empty;

  const filas = await prisma.$queryRaw<MensajePorIdCrudo[]>(Prisma.sql`
    SELECT m."id", m."status"::text AS "status", m."workspaceId", m."conversationId", m."content", m."deletedAt"
    FROM "Message" m
    WHERE m."channelId" = ${channelId}
      AND (m."externalId" = ${idMensaje} ${porCrudo})
    ORDER BY m."createdAt" DESC
    LIMIT 1
  `);
  return filas[0] ?? null;
}
