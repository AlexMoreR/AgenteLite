import { prisma } from "@/lib/prisma";

/**
 * CUÁNDO UN CONTACTO BAJA DE ETAPA POR INACTIVIDAD: la regla del Playbook, una sola para todo.
 *
 * Había dos relojes con dos reglas distintas, y el de la temperatura estaba mal: bajaba de Tibio a
 * Frío a quien llevara 2 días sin ESCRIBIR, sin mirar que nosotros le acabábamos de escribir.
 * Caso real (Alex, 02-10-2026): Magali Fajardo tenía cotización formal, había elegido color y
 * mandado sus datos; a la 1:41 p. m. la asesora le escribió y a la 1:45 el reloj la bajó a Frío.
 *
 * Ahora un contacto baja una etapa (Caliente → Tibio, Tibio → Frío) SOLO si se cumplen las tres:
 *  1. 3 intentos de contacto NUESTROS sin respuesta desde su último mensaje: mensajes de una
 *     asesora (desde el CRM o el celular; varios seguidos en menos de una hora son UN intento) o
 *     llamadas registradas. Lo que manda el agente o un seguimiento automático no es un intento.
 *  2. 5 días desde el último mensaje de la clienta.
 *  3. Cero respuesta en ese tiempo: ni WhatsApp (sale del punto 2) ni una llamada contestada.
 *
 * Y NUNCA baja a quien:
 *  - tiene cotización hecha: una asesora le mandó un documento (la cotización formal sale de
 *    Gestión como PDF) o le escribió de la cotización, o ya tiene número de cotización de Ganado;
 *  - está en Caliente con una fecha de próximo contacto futura (de una llamada, o porque se
 *    pospuso): alguien ya decidió cuándo volver a hablarle.
 */

export const INTENTOS_SIN_RESPUESTA = 3;
export const DIAS_DESDE_SU_ULTIMO_MENSAJE = 5;

/** Un mensaje de asesora a menos de esto del anterior es el mismo intento. */
const MISMO_INTENTO = "1 hour";

/** Resultados de llamada que SÍ son una respuesta del cliente. */
const LLAMADAS_CONTESTADAS = ["interesada", "lo_piensa", "no_interesada", "sin_definir", "ganado", "perdido"];

/** Tope por corrida: si algo sale mal, que salga mal de a poco. */
const TOPE_POR_CORRIDA = 200;

export type CandidatoABajar = {
  id: string;
  workspaceId: string;
  crmStage: "PROPUESTA" | "NEGOCIACION";
};

/**
 * Los contactos de una etapa que cumplen la regla. Las fechas se comparan contra la hora UTC de
 * la base (`NOW() AT TIME ZONE 'UTC'`): Prisma guarda en UTC sin zona, y comparar contra NOW() a
 * secas las corría por la zona horaria del servidor.
 */
export async function contactosQueBajan(etapa: "PROPUESTA" | "NEGOCIACION"): Promise<CandidatoABajar[]> {
  return prisma.$queryRaw<CandidatoABajar[]>`
    WITH vivos AS (
      SELECT c."id", c."workspaceId", c."crmStage"::text AS "crmStage", c."wonQuoteRef", c."metadata",
             (SELECT MAX(i."createdAt") FROM "Message" i
               WHERE i."contactId" = c."id" AND i."direction" = 'INBOUND' AND i."isStatusBroadcast" = false) AS ultimo_cliente
      FROM "Contact" c
      WHERE c."crmStage"::text = ${etapa}
        AND c."excludedFromCrm" = false
        AND c."bloqueadoEn" IS NULL
    )
    SELECT v."id", v."workspaceId", v."crmStage"
    FROM vivos v
    WHERE v.ultimo_cliente IS NOT NULL
      -- 2. Cinco dias desde su ultimo mensaje.
      AND v.ultimo_cliente <= (NOW() AT TIME ZONE 'UTC') - (${DIAS_DESDE_SU_ULTIMO_MENSAJE} || ' days')::interval
      -- 1. Tres intentos nuestros (asesora o llamada) desde ese mensaje.
      AND (
        (SELECT COUNT(*) FROM (
           SELECT q."createdAt", LAG(q."createdAt") OVER (ORDER BY q."createdAt") AS anterior
           FROM "Message" q
           WHERE q."contactId" = v."id" AND q."direction" = 'OUTBOUND' AND q."type" <> 'SYSTEM'
             AND q."createdAt" > v.ultimo_cliente
             AND COALESCE(q."rawPayload"->>'source', '') IN ('manual', 'instance')
         ) x WHERE x.anterior IS NULL OR x."createdAt" - x.anterior > ${MISMO_INTENTO}::interval)
        + (SELECT COUNT(*) FROM "CallAttempt" ca WHERE ca."contactId" = v."id" AND ca."calledAt" > v.ultimo_cliente)
      ) >= ${INTENTOS_SIN_RESPUESTA}
      -- 3. Ninguna llamada contestada en ese tiempo.
      AND NOT EXISTS (
        SELECT 1 FROM "CallAttempt" ca
        WHERE ca."contactId" = v."id" AND ca."calledAt" > v.ultimo_cliente
          AND ca."result" = ANY(${LLAMADAS_CONTESTADAS}::text[])
      )
      -- Nunca con cotizacion hecha.
      AND v."wonQuoteRef" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "Message" d
        WHERE d."contactId" = v."id" AND d."direction" = 'OUTBOUND'
          AND COALESCE(d."rawPayload"->>'source', '') IN ('manual', 'instance')
          AND (d."type" = 'DOCUMENT' OR d."content" ILIKE '%cotizaci%')
      )
      -- Nunca Caliente con proximo contacto futuro (llamada agendada o pospuesto).
      AND NOT (
        v."crmStage" = 'NEGOCIACION' AND (
          EXISTS (
            SELECT 1 FROM "CallAttempt" ca
            WHERE ca."contactId" = v."id" AND ca."nextContactAt" > (NOW() AT TIME ZONE 'UTC')
          )
          OR COALESCE(v."metadata"->>'snoozedUntil', '') > to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')
        )
      )
    LIMIT ${TOPE_POR_CORRIDA}
  `;
}
