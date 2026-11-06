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

/*
  "Sin responder": la misma regla en las dos fuentes (ver src/features/chats/domain/sin-responder.ts).
  - Se ignoran los SYSTEM (notas internas, actividad y llamadas) en los dos sentidos.
  - Responde una saliente que no es SYSTEM ni fallo (status FAILED): asesora, bot o envio automatico.
  - Solo cuentan los chats con un mensaje del cliente en los ultimos `dias` dias.
  No se abre el rawPayload: es lo que hacia lenta la consulta (diagnostico del 7-oct-2026).
*/

/**
 * Las conversaciones de WhatsApp normal donde lo ultimo (sin SYSTEM) es del cliente.
 *
 * Una sola pasada agrupada que compara dos fechas por chat —la ultima entrante contra la ultima
 * saliente valida—. Se mira solo lo de los ultimos `dias` dias: una respuesta mas vieja es
 * anterior a cualquier entrante de la ventana, asi que no cambia el resultado.
 *
 * `canales`: `null` = todas las lineas; `[]` = ninguna.
 */
export function sqlIdsSinResponder(input: {
  workspaceId: string;
  canales: string[] | null;
  dias: number;
}): Prisma.Sql {
  const filtroDeCanales = input.canales
    ? input.canales.length > 0
      ? Prisma.sql`AND m."channelId" IN (${Prisma.join(input.canales)})`
      : Prisma.sql`AND false`
    : Prisma.empty;

  return Prisma.sql`
    SELECT m."conversationId" AS "conversationId"
    FROM "Message" m
    WHERE m."workspaceId" = ${input.workspaceId}
      AND m."isStatusBroadcast" = false
      AND m."type" <> 'SYSTEM'
      AND m."createdAt" > now() - make_interval(days => ${input.dias})
      ${filtroDeCanales}
    GROUP BY m."conversationId"
    HAVING MAX(m."createdAt") FILTER (WHERE m."direction" = 'INBOUND')
         > COALESCE(
             MAX(m."createdAt") FILTER (WHERE m."direction" = 'OUTBOUND' AND m."status" <> 'FAILED'),
             TIMESTAMP '1970-01-01'
           )
  `;
}

/**
 * La condicion "quedo sin responder" de la linea oficial, para el WHERE de la bandeja: la
 * conversacion va con el alias `c`. Da NULL si el cliente no escribio en los ultimos `dias` dias
 * (quien la niegue tiene que envolverla en COALESCE(..., false)).
 */
export function sqlOficialQuedoSinResponder(dias: number): Prisma.Sql {
  return Prisma.sql`(
      SELECT MAX(entrante."createdAt") FROM "OfficialApiMessage" entrante
      WHERE entrante."conversationId" = c."id"
        AND entrante."direction" = 'INBOUND'
        AND entrante."type"::text <> 'SYSTEM'
        AND entrante."createdAt" > now() - make_interval(days => ${dias})
    ) > COALESCE((
      SELECT MAX(saliente."createdAt") FROM "OfficialApiMessage" saliente
      WHERE saliente."conversationId" = c."id"
        AND saliente."direction" = 'OUTBOUND'
        AND saliente."type"::text <> 'SYSTEM'
        AND saliente."status"::text <> 'FAILED'
    ), TIMESTAMP '1970-01-01')`;
}
