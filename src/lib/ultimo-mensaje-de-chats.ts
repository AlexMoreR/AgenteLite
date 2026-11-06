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
  /**
   * Desde cuando el cliente espera respuesta: el PRIMER mensaje suyo despues de la ultima
   * respuesta valida. `null` = ya contestado (o el cliente no escribio en los ultimos dias).
   * Es la misma regla de `sqlIdsSinResponder`: no es null exactamente en los chats del filtro.
   */
  sinResponderDesde: Date | null;
};

/**
 * Los dos LEFT JOIN LATERAL de "sin responder desde" para la conversacion con alias `c`
 * (WhatsApp normal). Dejan la columna `sr."sinResponderDesde"`; nunca quitan ni duplican filas.
 *
 * 1. La ultima saliente valida (no SYSTEM, no FAILED, no estado de WhatsApp): recorre el indice
 *    (conversationId, createdAt) de atras para adelante y se detiene en la primera (LIMIT 1).
 * 2. El MIN(createdAt) de las entrantes (no SYSTEM) posteriores a esa saliente. El HAVING da
 *    cero filas (null) si la ultima de esas entrantes tiene mas de `dias` dias.
 * No abre el rawPayload.
 */
function sqlLateralSinResponderDesde(input: { workspaceId: string; dias: number }): Prisma.Sql {
  return Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT s."createdAt"
      FROM "Message" s
      WHERE s."conversationId" = c."id"
        AND s."workspaceId" = ${input.workspaceId}
        AND s."isStatusBroadcast" = false
        AND s."direction" = 'OUTBOUND'
        AND s."type" <> 'SYSTEM'
        AND s."status" <> 'FAILED'
      ORDER BY s."createdAt" DESC
      LIMIT 1
    ) respuesta ON true
    LEFT JOIN LATERAL (
      SELECT MIN(e."createdAt") AS "sinResponderDesde"
      FROM "Message" e
      WHERE e."conversationId" = c."id"
        AND e."workspaceId" = ${input.workspaceId}
        AND e."isStatusBroadcast" = false
        AND e."direction" = 'INBOUND'
        AND e."type" <> 'SYSTEM'
        AND e."createdAt" > COALESCE(respuesta."createdAt", TIMESTAMP '-infinity')
      HAVING MAX(e."createdAt") > now() - make_interval(days => ${input.dias})
    ) sr ON true`;
}

export function sqlUltimoMensajeDeChats(input: {
  workspaceId: string;
  conversationIds: string[];
  /**
   * La bandeja (API de lista) no muestra mensajes de sistema como vista previa, salvo las
   * llamadas. La pagina servida (SSR) nunca tuvo ese filtro: se respeta tal cual en cada lugar.
   * No cambia `sinResponderDesde`.
   */
  ocultarSistemaSalvoLlamadas: boolean;
  /** Hasta donde se mira hacia atras para "sin responder" (DIAS_DE_SIN_RESPONDER). */
  diasSinResponder: number;
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
      u."status" AS "status",
      sr."sinResponderDesde" AS "sinResponderDesde"
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
    ${sqlLateralSinResponderDesde({ workspaceId: input.workspaceId, dias: input.diasSinResponder })}
    ORDER BY c."id"
  `;
}

/**
 * "Sin responder desde" de UNA conversacion de WhatsApp normal (los resumenes que refrescan una
 * fila). Misma regla que la columna de `sqlUltimoMensajeDeChats`; da una fila siempre.
 */
export function sqlSinResponderDesdeDeChat(input: {
  workspaceId: string;
  conversationId: string;
  dias: number;
}): Prisma.Sql {
  return Prisma.sql`
    SELECT sr."sinResponderDesde" AS "sinResponderDesde"
    FROM (SELECT ${input.conversationId}::text AS "id") c
    ${sqlLateralSinResponderDesde({ workspaceId: input.workspaceId, dias: input.dias })}
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

/**
 * "Sin responder desde" de la linea oficial, como expresion para el SELECT: la conversacion va
 * con el alias `c`. Misma regla que en WhatsApp normal: la ultima saliente valida con LIMIT 1 por
 * el indice (conversationId, createdAt), y el MIN(createdAt) de las entrantes posteriores; null
 * si ya se contesto o si la ultima de esas entrantes tiene mas de `dias` dias.
 * No es null exactamente cuando `sqlOficialQuedoSinResponder` es verdadera. No abre el rawPayload.
 */
export function sqlOficialSinResponderDesde(dias: number): Prisma.Sql {
  return Prisma.sql`(
      SELECT CASE
          WHEN MAX(entrante."createdAt") > now() - make_interval(days => ${dias}) THEN MIN(entrante."createdAt")
        END
      FROM "OfficialApiMessage" entrante
      WHERE entrante."conversationId" = c."id"
        AND entrante."direction" = 'INBOUND'
        AND entrante."type"::text <> 'SYSTEM'
        AND entrante."createdAt" > COALESCE((
          SELECT saliente."createdAt" FROM "OfficialApiMessage" saliente
          WHERE saliente."conversationId" = c."id"
            AND saliente."direction" = 'OUTBOUND'
            AND saliente."type"::text <> 'SYSTEM'
            AND saliente."status"::text <> 'FAILED'
          ORDER BY saliente."createdAt" DESC
          LIMIT 1
        ), TIMESTAMP '-infinity')
    )`;
}
