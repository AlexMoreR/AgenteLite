import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { registrarCambioDeEtapa } from "@/lib/historial-etapa";
import { PRODUCT_FUNNEL_STAGES } from "@/lib/product-funnel-stages";
import { registrarEventos } from "@/features/embudo/servicios/eventos";
import { cancelPendingFollowsByContact } from "@/features/seguimientos/services/follows";
import { avisoSiNoSePuedeDescartar } from "@/features/crm/services/candado-descarte-sin-respuesta";
import {
  ETIQUETA_LLAMAR,
  MOTIVO_SIN_RESPUESTA,
  NOTA_HISTORIAL_DESCARTE,
  NOTA_LLAMAR,
  NOTA_REABRE,
  ORIGEN_NOTA,
  HORAS_DE_ESPERA,
  correrVuelta,
  type Candidato,
  type HechosDelLead,
  type Puerto,
  type ResultadoDeVuelta,
} from "@/features/crm/domain/descarte-tras-seguimientos";

/**
 * Pone en marcha la regla de `domain/descarte-tras-seguimientos.ts` contra la base.
 *
 * El seguimiento de 3 días es un dato del embudo (ProductStageFollowUp del paso Bienvenida), no
 * código. Mientras no exista, ningún lead tiene el evento SEGUIMIENTO_ENVIADO de ese seguimiento y
 * esto no encuentra a nadie: no hace nada.
 *
 * "Salió de verdad" = existe el evento SEGUIMIENTO_ENVIADO con el followId de un Follow del paso
 * Bienvenida que espera 3 días. Si el anti-bloqueo lo frenó o falló, no hay evento y ese lead queda
 * como hoy (lado seguro).
 */

const CLAVE_BANDERA = "crm:descarte-tras-seguimientos:";
const PREFIJO_FOLLOW = `Etapa ${PRODUCT_FUNNEL_STAGES[0].label} · `;
const MINUTOS_DE_3_DIAS = 3 * 1440;

/** Prendido de fábrica (decisión del dueño); se apaga poniendo "off". */
export async function descarteTrasSeguimientosEncendido(workspaceId: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE_BANDERA}${workspaceId}` } });
  return fila?.value !== "off";
}

type Fila = { contactId: string; etapa: string; enviadoEn: Date };

/** Los leads cuyo seguimiento de 3 días salió hace 24 h o más y siguen sin respuesta de nadie. */
async function buscarCandidatos(workspaceId: string, limite: number): Promise<Candidato[]> {
  const filas = await prisma.$queryRaw<Fila[]>`
    WITH enviados AS (
      SELECT DISTINCT ON (f."contactId") f."contactId", e."createdAt" AS enviado_en
      FROM "Follow" f
      JOIN "EmbudoEvento" e ON e."tipo" = 'SEGUIMIENTO_ENVIADO' AND e."datos"->>'followId' = f."id"
      WHERE f."workspaceId" = ${workspaceId}
        AND f."status"::text = 'EXECUTED'
        AND f."name" LIKE ${`${PREFIJO_FOLLOW}%`}
        AND f."timeValue" * (CASE f."timeType"::text WHEN 'MINUTES' THEN 1 WHEN 'HOURS' THEN 60 ELSE 1440 END) = ${MINUTOS_DE_3_DIAS}
      ORDER BY f."contactId", e."createdAt" DESC
    )
    SELECT c."id" AS "contactId", c."crmStage"::text AS etapa, en.enviado_en AS "enviadoEn"
    FROM enviados en
    JOIN "Contact" c ON c."id" = en."contactId"
    WHERE c."workspaceId" = ${workspaceId}
      AND c."excludedFromCrm" = false
      AND c."crmStage"::text NOT IN ('GANADO', 'PERDIDO')
      AND en.enviado_en <= NOW() - (${HORAS_DE_ESPERA} || ' hours')::interval
      AND NOT EXISTS (
        SELECT 1 FROM "Message" m JOIN "Conversation" cv ON cv."id" = m."conversationId"
         WHERE cv."contactId" = c."id" AND m."direction" = 'INBOUND' AND m."isStatusBroadcast" = false
           AND m."createdAt" > en.enviado_en)
      AND NOT EXISTS (
        SELECT 1 FROM "OfficialApiMessage" om JOIN "OfficialApiContact" oc ON oc."id" = om."contactId"
         WHERE oc."crmContactId" = c."id" AND om."direction" = 'INBOUND' AND om."createdAt" > en.enviado_en)
      AND NOT EXISTS (
        SELECT 1 FROM "Message" m JOIN "Conversation" cv ON cv."id" = m."conversationId"
         WHERE cv."contactId" = c."id" AND m."direction" = 'OUTBOUND'
           AND COALESCE(m."rawPayload"->>'source', '') IN ('manual', 'instance')
           AND m."type"::text <> 'SYSTEM' AND m."createdAt" > en.enviado_en)
      AND NOT EXISTS (
        SELECT 1 FROM "ContactTag" ct JOIN "Tag" t ON t."id" = ct."tagId"
         WHERE ct."contactId" = c."id" AND t."slug" = ${ETIQUETA_LLAMAR.slug})
      AND NOT EXISTS (
        SELECT 1 FROM "Message" m JOIN "Conversation" cv ON cv."id" = m."conversationId"
         WHERE cv."contactId" = c."id" AND m."rawPayload"->>'origen' = ${ORIGEN_NOTA})
    ORDER BY en.enviado_en ASC
    LIMIT ${limite}
  `;
  return filas.map((fila) => ({ contactId: fila.contactId, etapa: fila.etapa, enviadoEn: new Date(fila.enviadoEn) }));
}

async function leerHechos(candidato: Candidato): Promise<HechosDelLead> {
  const { contactId, enviadoEn } = candidato;
  const [contacto, mensajes, oficiales, manual, evento, aviso] = await Promise.all([
    prisma.contact.findUnique({ where: { id: contactId }, select: { crmStage: true } }),
    prisma.message.findMany({
      where: { conversation: { contactId }, direction: "INBOUND", isStatusBroadcast: false },
      select: { content: true, transcripcion: true, createdAt: true },
    }),
    prisma.officialApiMessage.findMany({
      where: { direction: "INBOUND", contact: { crmContactId: contactId } },
      select: { createdAt: true },
    }),
    prisma.message.count({
      where: {
        conversation: { contactId },
        direction: "OUTBOUND",
        type: { not: "SYSTEM" },
        createdAt: { gt: enviadoEn },
        OR: [{ rawPayload: { path: ["source"], equals: "manual" } }, { rawPayload: { path: ["source"], equals: "instance" } }],
      },
    }),
    prisma.embudoEvento.count({ where: { contactId, tipo: { in: ["COTIZACION", "ANTICIPO"] } } }),
    avisoSiNoSePuedeDescartar({ contactId, lostReason: MOTIVO_SIN_RESPUESTA }),
  ]);
  const escribioDespues =
    mensajes.some((m) => m.createdAt > enviadoEn) || oficiales.some((m) => m.createdAt > enviadoEn);
  return {
    etapa: contacto?.crmStage ?? candidato.etapa,
    enviadoEn,
    ahora: new Date(),
    escribioDespues,
    asesoraEscribioDespues: manual > 0,
    mensajesDelCliente: mensajes.map((m) => ({ texto: m.content?.trim() ? m.content : m.transcripcion, creadoEn: m.createdAt })),
    // El candado dice "no se puede descartar" cuando hay cotización en curso.
    conCotizacionOAnticipo: aviso !== null || evento > 0,
  };
}

async function conversacionDe(workspaceId: string, contactId: string) {
  return prisma.conversation.findFirst({
    where: { workspaceId, contactId },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true, channelId: true },
  });
}

async function anotar(workspaceId: string, contactId: string, text: string, kind: "stage_changed" | "tag_added" | "note") {
  const conversacion = await conversacionDe(workspaceId, contactId);
  if (!conversacion) return;
  await recordConversationActivity({
    workspaceId,
    conversationId: conversacion.id,
    channelId: conversacion.channelId,
    contactId,
    kind,
    actorUserId: null,
    origen: ORIGEN_NOTA,
    text,
  });
}

async function registrarEvento(workspaceId: string, contactId: string, accion: string, extra: Record<string, unknown>) {
  const conversacion = await conversacionDe(workspaceId, contactId);
  if (!conversacion) return;
  await registrarEventos({ workspaceId, conversationId: conversacion.id, contactId, channelId: conversacion.channelId }, [
    {
      tipo: "DESCARTE_TRAS_SEGUIMIENTOS",
      origen: "reloj",
      paso: "PRESENTACION",
      datos: { accion, ...extra },
      claveUnica: `DESCARTE_TRAS_SEG:${accion}:${contactId}:${Date.now()}`,
    },
  ]);
}

function puertoDe(workspaceId: string): Puerto {
  return {
    encendido: () => descarteTrasSeguimientosEncendido(workspaceId),
    buscarCandidatos: (limite) => buscarCandidatos(workspaceId, limite),
    hechos: leerHechos,

    async descartar(candidato) {
      // Con el WHERE de la etapa otra vez: si alguien lo movió a mano mientras tanto, no se pisa.
      const movidos = await prisma.$executeRaw`
        UPDATE "Contact"
        SET "crmStage" = 'PERDIDO', "lostReason" = ${MOTIVO_SIN_RESPUESTA}, "wonAt" = NULL, "wonQuoteRef" = NULL, "updatedAt" = NOW()
        WHERE "id" = ${candidato.contactId} AND "workspaceId" = ${workspaceId} AND "crmStage"::text NOT IN ('GANADO', 'PERDIDO')
      `;
      if (movidos === 0) return false;
      await registrarCambioDeEtapa({
        workspaceId,
        contactId: candidato.contactId,
        etapaAnterior: candidato.etapa,
        etapaNueva: "PERDIDO",
        origen: "AUTOMATICO",
        nota: NOTA_HISTORIAL_DESCARTE,
      });
      await anotar(
        workspaceId,
        candidato.contactId,
        "Descartado automáticamente: no contestó los seguimientos (el último hace más de 24 horas). Motivo: Sin respuesta.",
        "stage_changed",
      );
      await registrarEvento(workspaceId, candidato.contactId, "descartado", { etapaAnterior: candidato.etapa });
      await cancelPendingFollowsByContact({ workspaceId, contactId: candidato.contactId, reason: "Descartado por no responder los seguimientos" });
      return true;
    },

    async ponerLlamar(candidato) {
      const etiqueta =
        (await prisma.tag.findFirst({ where: { workspaceId, slug: ETIQUETA_LLAMAR.slug }, select: { id: true } })) ??
        (await prisma.tag.create({
          data: { id: randomUUID(), workspaceId, ...ETIQUETA_LLAMAR, updatedAt: new Date() },
          select: { id: true },
        }));
      const { count } = await prisma.contactTag.createMany({
        data: [{ contactId: candidato.contactId, tagId: etiqueta.id, workspaceId }],
        skipDuplicates: true,
      });
      if (count === 0) return false;
      await anotar(workspaceId, candidato.contactId, NOTA_LLAMAR, "note");
      await registrarEvento(workspaceId, candidato.contactId, "llamar", { etapa: candidato.etapa });
      return true;
    },

    async reabrir(limite) {
      // Descartados por esta regla (la última fila del historial lo dice) cuyo cliente escribió después.
      const filas = await prisma.$queryRaw<{ contactId: string; etapaAnterior: string | null }[]>`
        SELECT c."id" AS "contactId", h."etapaAnterior"
        FROM "Contact" c
        JOIN LATERAL (
          SELECT * FROM "HistorialEtapa" x WHERE x."contactId" = c."id" ORDER BY x."creadoEn" DESC LIMIT 1
        ) h ON true
        WHERE c."workspaceId" = ${workspaceId}
          AND c."crmStage"::text = 'PERDIDO' AND c."lostReason" = ${MOTIVO_SIN_RESPUESTA}
          AND h."etapaNueva" = 'PERDIDO' AND h."origen" = 'AUTOMATICO' AND h."nota" = ${NOTA_HISTORIAL_DESCARTE}
          AND (
            EXISTS (SELECT 1 FROM "Message" m JOIN "Conversation" cv ON cv."id" = m."conversationId"
                     WHERE cv."contactId" = c."id" AND m."direction" = 'INBOUND' AND m."isStatusBroadcast" = false
                       AND m."createdAt" > h."creadoEn")
            OR EXISTS (SELECT 1 FROM "OfficialApiMessage" om JOIN "OfficialApiContact" oc ON oc."id" = om."contactId"
                        WHERE oc."crmContactId" = c."id" AND om."direction" = 'INBOUND' AND om."createdAt" > h."creadoEn")
          )
        LIMIT ${limite}
      `;
      let reabiertos = 0;
      for (const fila of filas) {
        const vuelve = fila.etapaAnterior && fila.etapaAnterior !== "PERDIDO" ? fila.etapaAnterior : "NUEVO";
        const movidos = await prisma.$executeRaw`
          UPDATE "Contact" SET "crmStage" = ${vuelve}::"CrmStage", "lostReason" = NULL, "updatedAt" = NOW()
          WHERE "id" = ${fila.contactId} AND "crmStage"::text = 'PERDIDO' AND "lostReason" = ${MOTIVO_SIN_RESPUESTA}
        `;
        if (movidos === 0) continue;
        await registrarCambioDeEtapa({
          workspaceId,
          contactId: fila.contactId,
          etapaAnterior: "PERDIDO",
          etapaNueva: vuelve,
          origen: "AUTOMATICO",
          nota: "reapertura tras seguimientos",
        });
        await anotar(workspaceId, fila.contactId, NOTA_REABRE, "stage_changed");
        await registrarEvento(workspaceId, fila.contactId, "reabierto", { etapa: vuelve });
        reabiertos += 1;
      }
      return reabiertos;
    },
  };
}

export async function ejecutarDescarteTrasSeguimientos(): Promise<ResultadoDeVuelta> {
  const total: ResultadoDeVuelta = { descartados: 0, aLlamar: 0, reabiertos: 0, revisados: 0 };
  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  for (const workspace of workspaces) {
    try {
      const r = await correrVuelta(puertoDe(workspace.id));
      total.descartados += r.descartados;
      total.aLlamar += r.aLlamar;
      total.reabiertos += r.reabiertos;
      total.revisados += r.revisados;
    } catch (error) {
      console.error("[descarte-tras-seguimientos] error", { workspaceId: workspace.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (total.descartados + total.aLlamar + total.reabiertos > 0) {
    console.log("[descarte-tras-seguimientos] vuelta", total);
  }
  return total;
}
