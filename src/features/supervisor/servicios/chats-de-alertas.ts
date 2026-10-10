import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import type { DatosDelChat } from "../dominio/chats-de-la-alerta";

type FilaDeDatos = {
  conversationId: string;
  nombre: string | null;
  telefono: string | null;
  asesoraNombre: string | null;
  ultimoClienteEn: Date | null;
  ultimaRespuestaHumanaEn: Date | null;
  ultimoTextoCliente: string | null;
};

/**
 * Los datos para MOSTRAR los chats de las alertas: nombre y teléfono del contacto, asesora, último
 * mensaje del cliente y última respuesta humana. UNA consulta para todos los chats de la pantalla
 * (sin N+1), filtrada por el negocio: un id de otro negocio simplemente no vuelve ("no encontrado").
 * Solo lectura. "Respuesta humana" = lo mismo que usa el chequeo de atención (source manual/instance).
 */
export async function leerDatosDeChats(workspaceId: string, ids: string[]): Promise<Map<string, DatosDelChat>> {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (unicos.length === 0) return new Map();
  const filas = await prisma.$queryRaw<FilaDeDatos[]>(Prisma.sql`
    SELECT c."id" AS "conversationId", ct."name" AS "nombre", ct."phoneNumber" AS "telefono", u."name" AS "asesoraNombre",
           cli."createdAt" AS "ultimoClienteEn", cli."texto" AS "ultimoTextoCliente", hum."createdAt" AS "ultimaRespuestaHumanaEn"
      FROM "Conversation" c
      JOIN "Contact" ct ON ct."id" = c."contactId"
      LEFT JOIN "User" u ON u."id" = c."assignedToUserId"
      LEFT JOIN LATERAL (
        SELECT m."createdAt", left(coalesce(nullif(m."transcripcion", ''), m."content", ''), 200) AS "texto" FROM "Message" m
         WHERE m."conversationId" = c."id" AND m."direction" = 'INBOUND' AND m."type"::text <> 'SYSTEM'
         ORDER BY m."createdAt" DESC LIMIT 1) cli ON true
      LEFT JOIN LATERAL (
        SELECT m."createdAt" FROM "Message" m
         WHERE m."conversationId" = c."id" AND m."direction" = 'OUTBOUND' AND m."type"::text <> 'SYSTEM'
           AND m."rawPayload"->>'source' IN ('manual', 'instance')
         ORDER BY m."createdAt" DESC LIMIT 1) hum ON true
     WHERE c."workspaceId" = ${workspaceId}
       AND c."id" IN (${Prisma.join(unicos)})`);
  return new Map(
    filas.map((fila) => [
      fila.conversationId,
      {
        conversationId: fila.conversationId,
        nombre: fila.nombre,
        telefono: fila.telefono,
        asesoraNombre: fila.asesoraNombre,
        ultimoClienteEn: fila.ultimoClienteEn ? new Date(fila.ultimoClienteEn) : null,
        ultimaRespuestaHumanaEn: fila.ultimaRespuestaHumanaEn ? new Date(fila.ultimaRespuestaHumanaEn) : null,
        ultimoTextoCliente: fila.ultimoTextoCliente,
      },
    ]),
  );
}
