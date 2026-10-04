import { prisma } from "@/lib/prisma";
import {
  INTENTOS_SIN_RESPUESTA,
  LLAMADAS_CONTESTADAS,
  MISMO_INTENTO,
} from "@/features/crm/services/bajada-por-inactividad";

/**
 * CANDADO: no se descarta por "Sin respuesta" a quien tiene una cotización en curso.
 *
 * El 3 de octubre de 2026 se pasaron 438 contactos a Perdido con "Sin respuesta" en una tarde, y
 * entre ellos habia clientas con cotizacion enviada que habian escrito esa misma semana (Alex). Se
 * reabrieron a mano. Esto evita que vuelva a pasar.
 *
 * Con cotizacion, "Sin respuesta" solo se permite si se cumplen las dos:
 *  - 3 intentos de contacto sin respuesta desde su ultimo mensaje (la misma cuenta que la bajada
 *    por inactividad: mensajes de asesora agrupados por hora + llamadas, y ninguna contestada);
 *  - 30 dias desde el ultimo mensaje de la clienta.
 * Los otros motivos (competencia, presupuesto, cobertura...) se permiten siempre.
 *
 * QUE ES "TENER COTIZACION" (Alex, 03-10-2026): numero COT de Gestion, o la asesora le envio la
 * cotizacion ("te envio la cotizacion"), o le pidio los "Datos de Cotizacion", o le mando un PDF
 * cuyo nombre dice que es una cotizacion o una factura (COT-00123, "Cotizacion...", "FACTURA...").
 * Un catalogo NO cuenta: el primer conteo contaba cualquier PDF y salian 68 "con cotizacion"
 * cuando eran 5. Tampoco sirve comparar contra los nombres de la Biblioteca: desde el celular los
 * catalogos llegan con nombres parecidos pero no iguales ("LAVACABEZA PORCELANA.pdf").
 */

export const DIAS_SIN_ESCRIBIR_PARA_DESCARTAR = 30;

const MOTIVOS_SIN_RESPUESTA = new Set(["sin_respuesta", "no_responde"]);

export function esDescarteSinRespuesta(lostReason: string | null | undefined) {
  return Boolean(lostReason && MOTIVOS_SIN_RESPUESTA.has(lostReason));
}

type Medicion = {
  tiene_cotizacion: boolean;
  ultimo_cliente: Date | null;
  intentos: number;
  contestada: boolean;
};

/**
 * Devuelve null si se puede descartar, o el aviso para la asesora explicando por que no.
 * Solo mira cuando el motivo es "Sin respuesta"; con cualquier otro motivo devuelve null.
 */
export async function avisoSiNoSePuedeDescartar(input: {
  contactId: string;
  lostReason: string | null | undefined;
}): Promise<string | null> {
  if (!esDescarteSinRespuesta(input.lostReason)) {
    return null;
  }

  const [medicion] = await prisma.$queryRaw<Medicion[]>`
    WITH c AS (
      SELECT "id", "workspaceId", "wonQuoteRef" FROM "Contact" WHERE "id" = ${input.contactId}
    ),
    nuestros AS (
      SELECT d."type"::text AS tipo, coalesce(d."content", '') AS contenido, d."createdAt"
      FROM "Message" d
      JOIN "Conversation" cv ON cv."id" = d."conversationId"
      JOIN c ON cv."contactId" = c."id"
      WHERE d."direction" = 'OUTBOUND'
        AND COALESCE(d."rawPayload"->>'source', '') IN ('manual', 'instance')
    ),
    ultimo AS (
      SELECT GREATEST(
        (SELECT MAX(i."createdAt") FROM "Message" i JOIN "Conversation" cv ON cv."id" = i."conversationId"
           JOIN c ON cv."contactId" = c."id"
          WHERE i."direction" = 'INBOUND' AND i."isStatusBroadcast" = false),
        (SELECT MAX(om."createdAt") FROM "OfficialApiMessage" om
           JOIN "OfficialApiContact" oc ON oc."id" = om."contactId" JOIN c ON oc."crmContactId" = c."id"
          WHERE om."direction" = 'INBOUND')
      ) AS en
    )
    SELECT
      (
        (SELECT "wonQuoteRef" IS NOT NULL FROM c)
        OR EXISTS (
          SELECT 1 FROM nuestros n
          WHERE n.contenido ~* '(te|le) (env[ií]o|mando|comparto|adjunto) la cotizaci|aqu[ií] (te|le) env[ií]o la cotizaci|datos de cotizaci'
             OR (n.tipo = 'DOCUMENT' AND n.contenido ~* '(^|[^a-z])cot([^a-z]|iz)|cotizaci|factura|proforma')
        )
      ) AS tiene_cotizacion,
      (SELECT en FROM ultimo) AS ultimo_cliente,
      (
        (SELECT COUNT(*) FROM (
           SELECT n."createdAt", LAG(n."createdAt") OVER (ORDER BY n."createdAt") AS anterior
           FROM nuestros n
           WHERE n.tipo <> 'SYSTEM' AND ((SELECT en FROM ultimo) IS NULL OR n."createdAt" > (SELECT en FROM ultimo))
         ) x WHERE x.anterior IS NULL OR x."createdAt" - x.anterior > ${MISMO_INTENTO}::interval)
        + (SELECT COUNT(*) FROM "CallAttempt" ca JOIN c ON ca."contactId" = c."id"
            WHERE (SELECT en FROM ultimo) IS NULL OR ca."calledAt" > (SELECT en FROM ultimo))
      )::int AS intentos,
      EXISTS (
        SELECT 1 FROM "CallAttempt" ca JOIN c ON ca."contactId" = c."id"
        WHERE ((SELECT en FROM ultimo) IS NULL OR ca."calledAt" > (SELECT en FROM ultimo))
          AND ca."result" = ANY(${LLAMADAS_CONTESTADAS}::text[])
      ) AS contestada
  `;

  if (!medicion?.tiene_cotizacion) {
    return null;
  }

  // Las fechas de Prisma estan en UTC sin zona: se comparan contra la hora UTC de ahora.
  const dias = medicion.ultimo_cliente
    ? Math.floor((Date.now() - new Date(medicion.ultimo_cliente).getTime()) / 86_400_000)
    : null;
  const intentosSinRespuesta = medicion.contestada ? 0 : medicion.intentos;
  const cumpleIntentos = intentosSinRespuesta >= INTENTOS_SIN_RESPUESTA;
  const cumpleDias = dias === null || dias >= DIAS_SIN_ESCRIBIR_PARA_DESCARTAR;
  if (cumpleIntentos && cumpleDias) {
    return null;
  }

  const faltan: string[] = [];
  if (!cumpleIntentos) {
    faltan.push(
      medicion.contestada
        ? "te contestó una llamada desde su último mensaje"
        : `lleva ${intentosSinRespuesta} de ${INTENTOS_SIN_RESPUESTA} intentos de contacto sin respuesta`,
    );
  }
  if (!cumpleDias && dias !== null) {
    faltan.push(
      `escribió hace ${dias === 0 ? "menos de un día" : dias === 1 ? "1 día" : `${dias} días`} (hacen falta ${DIAS_SIN_ESCRIBIR_PARA_DESCARTAR})`,
    );
  }

  return (
    `No se puede descartar por «Sin respuesta»: este cliente tiene una cotización. ` +
    `Solo se permite con ${INTENTOS_SIN_RESPUESTA} intentos de contacto sin respuesta y ${DIAS_SIN_ESCRIBIR_PARA_DESCARTAR} días desde su último mensaje, ` +
    `y ahora ${faltan.join(" y ")}. Si se perdió por otro motivo (compró a la competencia, sin presupuesto, fuera de cobertura), elige ese motivo.`
  );
}
