import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { recordConversationActivity } from "@/lib/conversation-activity";

/**
 * DESCARTE AUTOMÁTICO: el lead que lleva un mes callado después de que le insistimos tres veces.
 *
 * ====================================================================================
 * ESTO CRUZA UNA REGLA QUE ALEX MISMO PUSO, Y LO SABE.
 *
 * La regla escrita en `crm-stage-sync.ts` dice, sin matices: "ni el V2, ni el V3, ni un
 * automatismo ponen GANADO o PERDIDO; cerrar es decisión humana". Nació de un bug real: el agente
 * marcó GANADO a una clienta por decir su ciudad, sin haber pagado un peso.
 *
 * Alex autorizó la excepción el 29-09-2026, y pidió expresamente que fuera **por camino aparte y
 * marcado, sin tocar el candado del agente**. Por eso esto escribe la etapa acá, a la vista, y NO
 * pasa por `moverEtapaDesdeAgente`: ese candado sigue intacto y sigue rechazando todo intento del
 * agente de cerrar una venta. Lo que cambia es que existe UNA puerta más, con nombre y apellido,
 * que hace UNA cosa muy acotada y que se apaga con una bandera.
 *
 * Si alguien vuelve acá buscando por qué el CRM cerró un lead solo: fue esto, y fue pedido.
 * ====================================================================================
 *
 * Las condiciones, tal cual las definió Alex:
 *  - El cliente no escribe hace más de 30 días (o nunca escribió).
 *  - Le insistimos al menos 3 veces DESPUÉS de su último mensaje.
 *  - Está en Nuevo, Frío o Tibio. **Caliente queda afuera**: un lead en negociación que se calla
 *    merece que alguien lo mire, no que se descarte solo.
 *
 * Medido en producción antes de construirlo: 378 leads caerían hoy, 358 de ellos de Ingrid.
 */

/** Días sin que el cliente escriba. */
const DIAS_SIN_RESPUESTA = 30;

/** Cuántas veces le escribimos después de su último mensaje. */
const INSISTENCIAS_MINIMAS = 3;

/**
 * Las etapas que se descartan. Caliente (NEGOCIACION) NO está, por decisión de Alex.
 * Ganado y Perdido tampoco: uno ya se cerró bien y el otro ya está descartado.
 */
const ETAPAS_QUE_SE_DESCARTAN = ["NUEVO", "CALIFICADO", "PROPUESTA"] as const;

/*
  La lista se arma UNA vez y se usa en las dos consultas.

  Estaba escrita a mano adentro del SQL, con la constante de arriba solo de adorno. Eso es como
  quedan las reglas que se despegan de su documentacion: alguien agrega una etapa arriba, el SQL
  sigue igual, y nadie se entera hasta que descarta lo que no debia.
*/
const ETAPAS_SQL = Prisma.join(ETAPAS_QUE_SE_DESCARTAN.map((etapa) => Prisma.sql`${etapa}`));

/** El motivo oficial del CRM. Existe desde antes, no se inventa uno nuevo. */
const MOTIVO = "sin_respuesta";

/**
 * Por corrida. Son cientos de leads la primera vez: moverlos todos de un golpe le cambiaría el
 * tablero a las asesoras delante de sus ojos, y cualquier error se volvería masivo antes de que
 * alguien lo note.
 */
const TOPE_POR_CORRIDA = 50;

const CLAVE_BANDERA = "crm:descarte-automatico:";

export type CandidatoAlDescarte = {
  contactId: string;
  nombre: string;
  etapa: string;
  asesora: string | null;
};

/**
 * APAGADO salvo que se prenda a mano.
 *
 * Al revés que el resto de las banderas del proyecto, que vienen encendidas. Esto cierra leads: el
 * defecto tiene que ser no hacer nada.
 */
export async function descarteAutomaticoEncendido(workspaceId: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE_BANDERA}${workspaceId}` } });
  return fila?.value === "on";
}

export async function guardarBanderaDeDescarte(workspaceId: string, encendido: boolean): Promise<void> {
  const key = `${CLAVE_BANDERA}${workspaceId}`;
  const value = encendido ? "on" : "off";
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/**
 * Quiénes caerían, SIN tocar nada.
 *
 * La misma consulta que usa la ejecución, para que el número que se mira antes de prender sea el
 * mismo que se va a mover. Dos consultas parecidas serían dos respuestas distintas el día que una
 * se corrija y la otra no.
 */
async function buscarCandidatos(workspaceId: string, tope: number): Promise<CandidatoAlDescarte[]> {
  return prisma.$queryRaw<CandidatoAlDescarte[]>`
    WITH candidatos AS (
      SELECT c."id"        AS "contactId",
             coalesce(nullif(trim(c."name"), ''), c."phoneNumber") AS nombre,
             c."crmStage"::text AS etapa,
             (SELECT max(m."createdAt") FROM "Message" m
               WHERE m."contactId" = c."id" AND m."direction" = 'INBOUND') AS ultimo_cliente
      FROM "Contact" c
      WHERE c."workspaceId" = ${workspaceId}
        AND c."excludedFromCrm" = false
        AND c."crmStage"::text IN (${ETAPAS_SQL})
    )
    SELECT ca."contactId", ca.nombre, ca.etapa,
           (SELECT coalesce(u."name", u."email") FROM "Conversation" cv
              LEFT JOIN "User" u ON u."id" = cv."assignedToUserId"
             WHERE cv."contactId" = ca."contactId" AND cv."assignedToUserId" IS NOT NULL
             LIMIT 1) AS asesora
    FROM candidatos ca
    WHERE (ca.ultimo_cliente IS NULL OR ca.ultimo_cliente < NOW() - (${DIAS_SIN_RESPUESTA} || ' days')::interval)
      AND (
        SELECT count(*) FROM "Message" m
         WHERE m."contactId" = ca."contactId"
           AND m."direction" = 'OUTBOUND'
           AND m."type" <> 'SYSTEM'
           AND (ca.ultimo_cliente IS NULL OR m."createdAt" > ca.ultimo_cliente)
      ) >= ${INSISTENCIAS_MINIMAS}
    LIMIT ${tope}
  `;
}

/** Para mirar el número antes de prender la bandera. No mueve nada. */
export async function contarCandidatosDeDescarte(workspaceId: string): Promise<CandidatoAlDescarte[]> {
  // Tope alto: acá se quiere ver el total, no drenar de a poco.
  return buscarCandidatos(workspaceId, 5000);
}

export async function ejecutarDescarteAutomatico(): Promise<{ descartados: number; revisados: number }> {
  const workspaces = await prisma.workspace.findMany({ select: { id: true } });

  let descartados = 0;
  let revisados = 0;

  for (const workspace of workspaces) {
    if (!(await descarteAutomaticoEncendido(workspace.id))) {
      continue;
    }

    const candidatos = await buscarCandidatos(workspace.id, TOPE_POR_CORRIDA);
    revisados += candidatos.length;

    for (const candidato of candidatos) {
      try {
        /*
          LA PUERTA APARTE. Acá se escribe PERDIDO.

          Con el WHERE de la etapa otra vez: si entre la consulta y este momento alguien movió el
          lead a mano -o el cliente contestó y algo lo recalentó- no se pisa esa decisión. Correr
          esto dos veces no hace daño.
        */
        const movidos = await prisma.$executeRaw`
          UPDATE "Contact"
          SET "crmStage" = 'PERDIDO',
              "lostReason" = ${MOTIVO},
              "wonAt" = NULL,
              "updatedAt" = NOW()
          WHERE "id" = ${candidato.contactId}
            AND "crmStage"::text IN (${ETAPAS_SQL})
        `;
        if (movidos === 0) {
          continue;
        }

        /*
          La nota en la tarjeta, que es lo que pidió Alex para poder auditarlo.

          Dice que fue automático y por qué, sin autor: no lo hizo nadie. Un "Magilus descartó" ahí
          sería mentira y es justo lo que hoy tiene confundido al equipo con las asignaciones.
        */
        const conversacion = await prisma.conversation.findFirst({
          where: { workspaceId: workspace.id, contactId: candidato.contactId },
          orderBy: { lastMessageAt: "desc" },
          select: { id: true, channelId: true },
        });
        if (conversacion) {
          await recordConversationActivity({
            workspaceId: workspace.id,
            conversationId: conversacion.id,
            channelId: conversacion.channelId,
            contactId: candidato.contactId,
            kind: "stage_changed",
            actorUserId: null,
            origen: "descarte-automatico",
            text: `Descartado automáticamente: ${DIAS_SIN_RESPUESTA} días sin respuesta del cliente después de ${INSISTENCIAS_MINIMAS} mensajes nuestros. Motivo: Sin respuesta.`,
          });
        }

        descartados += 1;
      } catch (error) {
        console.error("[descarte-automatico] no se pudo descartar", {
          contactId: candidato.contactId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (descartados > 0) {
    console.log("[descarte-automatico] leads descartados", { descartados, revisados });
  }

  return { descartados, revisados };
}
