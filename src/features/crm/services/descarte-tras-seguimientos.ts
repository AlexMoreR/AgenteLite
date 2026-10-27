import { Prisma } from "@prisma/client";

import { avisoSiNoSePuedeDescartar } from "@/features/crm/services/candado-descarte-sin-respuesta";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { registrarCambioDeEtapa } from "@/lib/historial-etapa";
import { prisma } from "@/lib/prisma";

import {
  DIAS_DEL_ULTIMO_SEGUIMIENTO,
  ETAPAS_DESCARTABLES,
  MARGEN_HORAS_POR_DEFECTO,
  MOTIVO_DESCARTE,
  SENALES_DE_COMPRA,
  TEXTO_DEL_MOTIVO,
  decidirDescarte,
} from "./descarte-tras-seguimientos-reglas";

/**
 * DESCARTE TRAS LOS SEGUIMIENTOS: el lead que recibió los 5 seguimientos del paso (15 min, 1 h,
 * 1 día, 3 días y 7 días con las redes) y nunca contestó pasa solo a Descartado.
 *
 * Es otra puerta automática que escribe PERDIDO, igual que `descarte-automatico.ts` y con la misma
 * autorización de Alex (ver el aviso largo de ese archivo): por camino aparte, a la vista, con
 * bandera y APAGADA de entrada. No pasa por el candado del agente, que sigue rechazando cierres.
 *
 * Las condiciones (decisión del dueño, 26-10-2026):
 *  - El seguimiento de 7 días ya salió y pasó el margen (24 h por defecto).
 *  - El cliente no escribió nada después del primer seguimiento.
 *  - Está en Nuevo, Frío o Tibio (Caliente, Ganado y Perdido quedan afuera).
 *  - Con señal de compra (precio, envío, ciudad...) NO se descarta: queda para la lista LLAMAR de su
 *    asesora, que arma la Recuperación 72 h (seguimiento-inteligente). Acá solo se lo deja pasar.
 *  - Con cotización en curso lo frena el candado de siempre.
 * Si el cliente responde en cualquier momento, el webhook ya canceló los seguimientos pendientes
 * (`cancelOnActivity`) y esta regla ya no lo ve como candidato.
 */

/** Por corrida: mover cientos de golpe le cambiaría el tablero a las asesoras delante de sus ojos. */
const TOPE_POR_CORRIDA = 50;

const CLAVE_BANDERA = "crm:descarte-tras-seguimientos:";
const CLAVE_MARGEN = "crm:descarte-tras-seguimientos:margen-horas:";

/** Los seguimientos del paso se llaman "Etapa <paso> · N" (ver stage-follow-up.ts). */
const PREFIJO_DEL_SEGUIMIENTO = "Etapa %";

const ETAPAS_SQL = Prisma.join(ETAPAS_DESCARTABLES.map((etapa) => Prisma.sql`${etapa}`));

export type CandidatoTrasSeguimientos = {
  contactId: string;
  nombre: string;
  etapa: string;
  sieteEn: Date;
  asesora: string | null;
  /** True si tiene señal de compra: no se descarta, se queda para llamar. */
  conSenal: boolean;
};

/** APAGADO salvo que se prenda a mano: esto cierra leads, el defecto es no hacer nada. */
export async function descarteTrasSeguimientosEncendido(workspaceId: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE_BANDERA}${workspaceId}` } });
  return fila?.value === "on";
}

export async function guardarBanderaDescarteTrasSeguimientos(workspaceId: string, encendido: boolean): Promise<void> {
  const key = `${CLAVE_BANDERA}${workspaceId}`;
  const value = encendido ? "on" : "off";
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

async function margenDeHoras(workspaceId: string): Promise<number> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE_MARGEN}${workspaceId}` } });
  const horas = Number(fila?.value);
  return Number.isFinite(horas) && horas >= 0 ? horas : MARGEN_HORAS_POR_DEFECTO;
}

type FilaCruda = {
  contactId: string;
  nombre: string;
  etapa: string;
  sieteEn: Date;
  primeroEn: Date | null;
  ultimoClienteEn: Date | null;
  senales: string[] | null;
  asesora: string | null;
};

/**
 * Quiénes cumplen, SIN tocar nada. La misma consulta sirve a la vista previa y a la ejecución, para
 * que el número que se mira antes de prender sea el que se va a mover.
 */
async function buscar(workspaceId: string, margenHoras: number, tope: number, soloDescartables: boolean) {
  const filas = await prisma.$queryRaw<FilaCruda[]>(Prisma.sql`
    SELECT c."id" AS "contactId",
           coalesce(nullif(trim(c."name"), ''), c."phoneNumber") AS nombre,
           c."crmStage"::text AS etapa,
           f7."executedAt" AS "sieteEn",
           (SELECT min(p."executedAt") FROM "Follow" p
             WHERE p."contactId" = c."id" AND p."status" = 'EXECUTED' AND p."name" LIKE ${PREFIJO_DEL_SEGUIMIENTO}
               AND p."executedAt" >= f7."executedAt" - interval '8 days'
               AND p."executedAt" <= f7."executedAt") AS "primeroEn",
           (SELECT max(m."createdAt") FROM "Message" m
             WHERE m."contactId" = c."id" AND m."direction" = 'INBOUND') AS "ultimoClienteEn",
           (SELECT coalesce(array_agg(DISTINCT s.tipo), ARRAY[]::text[])
              FROM "EmbudoLead" el,
                   LATERAL (SELECT t AS tipo FROM unnest(${SENALES_DE_COMPRA}::text[]) t
                             WHERE el."senales" @> jsonb_build_array(jsonb_build_object('tipo', t))) s
             WHERE el."contactId" = c."id") AS senales,
           (SELECT coalesce(u."name", u."email") FROM "Conversation" cv
              LEFT JOIN "User" u ON u."id" = cv."assignedToUserId"
             WHERE cv."contactId" = c."id" AND cv."assignedToUserId" IS NOT NULL
             LIMIT 1) AS asesora
    FROM "Contact" c
    JOIN LATERAL (
      SELECT f."executedAt" FROM "Follow" f
       WHERE f."contactId" = c."id" AND f."status" = 'EXECUTED' AND f."name" LIKE ${PREFIJO_DEL_SEGUIMIENTO}
         AND f."timeType" = 'DAYS' AND f."timeValue" = ${DIAS_DEL_ULTIMO_SEGUIMIENTO} AND f."executedAt" IS NOT NULL
       ORDER BY f."executedAt" DESC LIMIT 1
    ) f7 ON true
    WHERE c."workspaceId" = ${workspaceId}
      AND c."excludedFromCrm" = false
      AND c."crmStage"::text IN (${ETAPAS_SQL})
      AND f7."executedAt" <= NOW() - (${margenHoras} || ' hours')::interval
      AND f7."executedAt" > NOW() - interval '60 days'
    ORDER BY f7."executedAt" ASC
    LIMIT ${tope * (soloDescartables ? 4 : 1)}
  `);

  const ahora = new Date();
  const salida: Array<{ candidato: CandidatoTrasSeguimientos; primeroEn: Date | null }> = [];
  for (const fila of filas) {
    const decision = decidirDescarte(
      { etapa: fila.etapa, sieteEn: fila.sieteEn, primeroEn: fila.primeroEn, ultimoClienteEn: fila.ultimoClienteEn, senales: fila.senales ?? [] },
      ahora,
      margenHoras,
    );
    if (decision.tipo === "no") continue;
    if (soloDescartables && decision.tipo !== "descartar") continue;
    salida.push({
      candidato: {
        contactId: fila.contactId,
        nombre: fila.nombre,
        etapa: fila.etapa,
        sieteEn: fila.sieteEn,
        asesora: fila.asesora,
        conSenal: decision.tipo === "llamar",
      },
      primeroEn: fila.primeroEn,
    });
    if (salida.length >= tope) break;
  }
  return salida;
}

/** Para mirar el número antes de prender la bandera. No mueve nada. Incluye los que van a LLAMAR. */
export async function contarCandidatosTrasSeguimientos(workspaceId: string): Promise<CandidatoTrasSeguimientos[]> {
  const margen = await margenDeHoras(workspaceId);
  return (await buscar(workspaceId, margen, 5000, false)).map((x) => x.candidato);
}

export async function ejecutarDescarteTrasSeguimientos(): Promise<{ descartados: number; revisados: number }> {
  const workspaces = await prisma.workspace.findMany({ select: { id: true } });

  let descartados = 0;
  let revisados = 0;

  for (const workspace of workspaces) {
    if (!(await descarteTrasSeguimientosEncendido(workspace.id))) continue;

    const margen = await margenDeHoras(workspace.id);
    const candidatos = await buscar(workspace.id, margen, TOPE_POR_CORRIDA, true);
    revisados += candidatos.length;

    for (const { candidato, primeroEn } of candidatos) {
      try {
        // El candado de cotización: con una cotización en curso, "Sin respuesta" no se permite.
        const aviso = await avisoSiNoSePuedeDescartar({ contactId: candidato.contactId, lostReason: MOTIVO_DESCARTE });
        if (aviso) continue;

        /*
          Se vuelve a mirar la etapa y los mensajes del cliente en el mismo UPDATE: si entre la
          consulta y este momento alguien movió el lead o el cliente escribió, no se pisa.
          Correrlo dos veces no cambia nada: la segunda ya no lo encuentra en una etapa descartable.
        */
        const movidos = await prisma.$executeRaw`
          UPDATE "Contact"
          SET "crmStage" = 'PERDIDO',
              "lostReason" = ${MOTIVO_DESCARTE},
              "wonAt" = NULL,
              "wonQuoteRef" = NULL,
              "updatedAt" = NOW()
          WHERE "id" = ${candidato.contactId}
            AND "crmStage"::text IN (${ETAPAS_SQL})
            AND NOT EXISTS (
              SELECT 1 FROM "Message" m
               WHERE m."contactId" = ${candidato.contactId} AND m."direction" = 'INBOUND'
                 AND m."createdAt" > ${primeroEn ?? candidato.sieteEn}
            )
        `;
        if (movidos === 0) continue;

        await registrarCambioDeEtapa({
          workspaceId: workspace.id,
          contactId: candidato.contactId,
          etapaAnterior: candidato.etapa,
          etapaNueva: "PERDIDO",
          origen: "AUTOMATICO",
          nota: "descarte tras seguimientos",
        });

        // La nota en la tarjeta, sin autor: no lo hizo nadie, y así se puede auditar.
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
            origen: "descarte-tras-seguimientos",
            text: `Descartado automáticamente: no respondió a los 5 seguimientos (el último, el de ${DIAS_DEL_ULTIMO_SEGUIMIENTO} días). Motivo: ${TEXTO_DEL_MOTIVO}.`,
          });
        }

        descartados += 1;
      } catch (error) {
        console.error("[descarte-tras-seguimientos] no se pudo descartar", {
          contactId: candidato.contactId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (descartados > 0) {
    console.log("[descarte-tras-seguimientos] leads descartados", { descartados, revisados });
  }

  return { descartados, revisados };
}
