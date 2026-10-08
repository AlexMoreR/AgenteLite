import { Prisma } from "@prisma/client";

/**
 * La vista previa de cada fila de la bandeja: el ULTIMO mensaje de cada chat.
 *
 * Antes era un `SELECT DISTINCT ON (conversationId) ... WHERE conversationId IN (40 ids)` con el
 * filtro `rawPayload->>'source'`. Postgres tenia que leer TODOS los mensajes de esos 40 chats y
 * abrir el JSON de cada uno (el webhook entero, a veces con la foto o el audio en base64) antes de
 * quedarse con el ultimo. Era la consulta mas cara del CRM (diagnostico del 7-oct-2026).
 *
 * Ahora es un LATERAL ... LIMIT 1 por chat: recorre el indice `Message(conversationId, createdAt)`
 * de atras para adelante y se detiene en el primer mensaje que cumple el filtro, asi que abre 1 a 3
 * JSON por chat en vez de todos. Mismo filtro, mismo orden (createdAt DESC, id DESC) y las mismas
 * columnas: el resultado es identico (lo comprueba `scripts/check-ultimo-mensaje.mjs`).
 *
 * Se agrega `id` del mensaje para que el respaldo con `rawPayload` (texto o nombre que faltan)
 * busque esas pocas filas por clave primaria en vez de repetir el barrido.
 */
export type MessageTypeDeFila =
  | "TEXT"
  | "IMAGE"
  | "AUDIO"
  | "VIDEO"
  | "STICKER"
  | "DOCUMENT"
  | "LOCATION"
  | "CONTACTS"
  | "BUTTON"
  | "TEMPLATE"
  | "SYSTEM"
  | "INTERACTIVE";

export type FilaUltimoMensaje = {
  conversationId: string;
  /** Id del mensaje elegido: sirve para pedir su rawPayload por clave primaria. */
  messageId: string;
  content: string | null;
  direction: "INBOUND" | "OUTBOUND";
  createdAt: Date;
  deletedAt: Date | null;
  type: MessageTypeDeFila | null;
  status: string | null;
};

export function sqlUltimoMensajeDeChats(input: {
  workspaceId: string;
  conversationIds: string[];
  /**
   * La bandeja (API de lista) no muestra mensajes de sistema como vista previa, salvo las
   * llamadas. La pagina servida (SSR) nunca tuvo ese filtro: se respeta tal cual en cada lugar.
   */
  ocultarSistemaSalvoLlamadas: boolean;
}): Prisma.Sql {
  const filtroDeSistema = input.ocultarSistemaSalvoLlamadas
    ? Prisma.sql`AND (m."type" IS DISTINCT FROM 'SYSTEM' OR (m."rawPayload"->>'source') = 'llamada')`
    : Prisma.empty;

  return Prisma.sql`
    SELECT
      c."id" AS "conversationId",
      u."id" AS "messageId",
      u."content" AS "content",
      u."direction" AS "direction",
      u."createdAt" AS "createdAt",
      u."deletedAt" AS "deletedAt",
      u."type" AS "type",
      -- El acuse del ULTIMO mensaje, para dibujar el chulo en la fila de la lista.
      u."status" AS "status"
    FROM (SELECT DISTINCT unnest(ARRAY[${Prisma.join(input.conversationIds)}]::text[]) AS "id") c
    CROSS JOIN LATERAL (
      SELECT m."id", m."content", m."direction", m."createdAt", m."deletedAt", m."type", m."status"
      FROM "Message" m
      WHERE m."conversationId" = c."id"
        AND m."workspaceId" = ${input.workspaceId}
        AND m."isStatusBroadcast" = false
        AND (m."rawPayload"->>'source') IS DISTINCT FROM 'activity'
        ${filtroDeSistema}
      ORDER BY m."createdAt" DESC, m."id" DESC
      LIMIT 1
    ) u
    ORDER BY c."id"
  `;
}

/** El rawPayload de unos pocos mensajes ya elegidos, por clave primaria. */
export function sqlPayloadDeMensajes(input: { workspaceId: string; messageIds: string[] }): Prisma.Sql {
  return Prisma.sql`
    SELECT
      m."conversationId" AS "conversationId",
      m."rawPayload" AS "rawPayload"
    FROM "Message" m
    WHERE m."workspaceId" = ${input.workspaceId}
      AND m."id" IN (${Prisma.join(input.messageIds)})
  `;
}
