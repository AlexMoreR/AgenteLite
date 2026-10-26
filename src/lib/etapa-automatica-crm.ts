import { prisma } from "@/lib/prisma";
import { registrarCambioDeEtapa } from "@/lib/historial-etapa";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { decidirEtapaDeAgente } from "@/lib/crm-stage-sync";
import { recordOfficialApiStageActivity } from "@/lib/official-api-crm-stage";
import { createFollowsFromRulesForSource } from "@/features/seguimientos/services/follows";
import { textoEnviadoTraeElTotal } from "@/lib/etapa-automatica-texto";
import type { CrmStage } from "@/features/crm/types";

/**
 * ETAPA AUTOMÁTICA DEL CRM: que un lead no se quede en "---" cuando ya tiene trabajo encima.
 *
 * El 22-oct-2026 había 1.900 leads en NUEVO y los 90 que entraron ese día seguían ahí: el embudo
 * no se podía medir ni se podía supervisar a las asesoras. Tres momentos mueven la etapa solos:
 *
 *  - se le asigna el chat a una asesora y el lead está en NUEVO  -> Frío (CALIFICADO);
 *  - se crea una cotización en Gestión desde el chat             -> Caliente (NEGOCIACION);
 *  - se ENVÍA al cliente el mensaje del panel de envío con total -> Caliente (NEGOCIACION).
 *
 * Usa el mismo candado que el bot (decidirEtapaDeAgente): solo avanza, nunca baja, nunca pone
 * Ganado ni Perdido (eso lo decide una persona) y no toca leads cerrados. Tampoco toca contactos
 * "fuera del CRM" ni de la línea administrativa.
 *
 * Interruptor: AppSetting `crm:etapa-automatica:<negocio>` = `off` lo apaga. Viene prendido.
 * NUNCA lanza: si falla, la asignación, la cotización o el envío siguen como si nada.
 */

export { textoEnviadoTraeElTotal };

export type MotivoDeEtapaAutomatica =
  | { tipo: "asignacion"; asesoraId: string }
  | { tipo: "cotizacion"; numero?: string | null }
  | { tipo: "panel-de-envio" };

/** Etapa a la que lleva cada motivo, en las palabras que entiende decidirEtapaDeAgente. */
const DESTINO_POR_MOTIVO: Record<MotivoDeEtapaAutomatica["tipo"], { etapa: CrmStage; palabra: string; etiqueta: string }> = {
  asignacion: { etapa: "CALIFICADO", palabra: "frio", etiqueta: "Frío" },
  cotizacion: { etapa: "NEGOCIACION", palabra: "caliente", etiqueta: "Caliente" },
  "panel-de-envio": { etapa: "NEGOCIACION", palabra: "caliente", etiqueta: "Caliente" },
};

export function claveDeEtapaAutomatica(workspaceId: string): string {
  return `crm:etapa-automatica:${workspaceId}`;
}

/**
 * La decisión, sin base de datos: a qué etapa pasa un lead según el motivo, o null si se queda.
 * Va aparte para poder probarla sin tocar producción.
 */
export function decidirEtapaAutomatica(input: {
  tipo: MotivoDeEtapaAutomatica["tipo"];
  etapaActual: CrmStage;
  fueraDelCrm?: boolean;
}): CrmStage | null {
  if (input.fueraDelCrm) return null;
  const { palabra } = DESTINO_POR_MOTIVO[input.tipo];
  // Ganado/Perdido, retroceder y etapas desconocidas los resuelve el candado del bot.
  const { destino } = decidirEtapaDeAgente(palabra, input.etapaActual);
  return destino;
}

async function etapaAutomaticaPrendida(workspaceId: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({
    where: { key: claveDeEtapaAutomatica(workspaceId) },
    select: { value: true },
  });
  return fila?.value?.trim().toLowerCase() !== "off";
}

async function nombreDeLaAsesora(userId: string): Promise<string> {
  const usuaria = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  return usuaria?.name?.trim() || usuaria?.email || "una asesora";
}

function textoDelMotivo(motivo: MotivoDeEtapaAutomatica, asesora: string | null): string {
  if (motivo.tipo === "asignacion") return `se asignó a ${asesora ?? "una asesora"}`;
  if (motivo.tipo === "cotizacion") return motivo.numero ? `se creó la cotización ${motivo.numero}` : "se creó la cotización";
  return "se envió el panel de envío con el total";
}

export type ChatResuelto = {
  contactId: string;
  channelId: string | null;
  configId: string | null;
  lineaAdministrativa: boolean;
};

export async function resolverChat(input: {
  workspaceId: string;
  conversationId: string;
  linea: "agent" | "official";
}): Promise<ChatResuelto | null> {
  if (input.linea === "official") {
    const filas = await prisma.$queryRaw<Array<{ configId: string; crmContactId: string | null }>>`
      SELECT c."configId" AS "configId", ct."crmContactId" AS "crmContactId"
      FROM "OfficialApiConversation" c
      INNER JOIN "OfficialApiContact" ct ON ct."id" = c."contactId"
      INNER JOIN "OfficialApiClientConfig" cfg ON cfg."id" = c."configId"
      WHERE c."id" = ${input.conversationId} AND cfg."workspaceId" = ${input.workspaceId}
      LIMIT 1
    `;
    const fila = filas[0];
    // Sin ficha en el CRM (chats anteriores al puente) no hay a quién moverle la etapa.
    if (!fila?.crmContactId) return null;
    return { contactId: fila.crmContactId, channelId: null, configId: fila.configId, lineaAdministrativa: false };
  }
  const conversacion = await prisma.conversation.findFirst({
    where: { id: input.conversationId, workspaceId: input.workspaceId },
    select: { contactId: true, channelId: true, channel: { select: { purpose: true } } },
  });
  if (!conversacion?.contactId) return null;
  return {
    contactId: conversacion.contactId,
    channelId: conversacion.channelId,
    configId: null,
    lineaAdministrativa: Boolean(conversacion.channel?.purpose && conversacion.channel.purpose !== "SALES"),
  };
}

/**
 * Mueve la etapa del lead de este chat si el motivo lo pide. Devuelve la etapa nueva, o null si
 * no se movió. Nunca lanza.
 */
export async function aplicarEtapaAutomatica(input: {
  workspaceId: string;
  conversationId: string;
  linea: "agent" | "official";
  motivo: MotivoDeEtapaAutomatica;
}): Promise<CrmStage | null> {
  try {
    if (!(await etapaAutomaticaPrendida(input.workspaceId))) return null;

    const chat = await resolverChat(input);
    if (!chat || chat.lineaAdministrativa) return null;

    const contacto = await prisma.contact.findFirst({
      where: { id: chat.contactId, workspaceId: input.workspaceId },
      select: { crmStage: true, excludedFromCrm: true },
    });
    if (!contacto) return null;

    const etapaActual = contacto.crmStage as CrmStage;
    const destino = decidirEtapaAutomatica({
      tipo: input.motivo.tipo,
      etapaActual,
      fueraDelCrm: contacto.excludedFromCrm,
    });
    if (!destino) return null;

    // Solo se guarda si el lead sigue en la etapa que se leyó: si dos cambios llegan a la vez
    // entra uno, y si una persona lo movió a mano en el medio, gana la persona.
    const guardado = await prisma.contact.updateMany({
      where: { id: chat.contactId, workspaceId: input.workspaceId, crmStage: etapaActual },
      data: { crmStage: destino },
    });
    if (guardado.count === 0) return null;

    const asesora = input.motivo.tipo === "asignacion" ? await nombreDeLaAsesora(input.motivo.asesoraId) : null;
    const razon = textoDelMotivo(input.motivo, asesora);

    await registrarCambioDeEtapa({
      workspaceId: input.workspaceId,
      contactId: chat.contactId,
      conversationId: input.conversationId,
      etapaAnterior: etapaActual,
      etapaNueva: destino,
      origen: "AUTOMATICO",
      nota: `etapa automática: ${razon}`,
    });

    // Las mismas consecuencias que mover la tarjeta a mano (reglas de seguimiento por etapa).
    await createFollowsFromRulesForSource({
      workspaceId: input.workspaceId,
      contactId: chat.contactId,
      sourceType: "CRM_STAGE",
      sourceId: destino,
    }).catch(() => {});

    const etiqueta = DESTINO_POR_MOTIVO[input.motivo.tipo].etiqueta;
    const nota = `Etapa movida por el sistema: ${etiqueta} (${razon})`;
    if (input.linea === "official") {
      if (chat.configId) {
        await recordOfficialApiStageActivity({
          configId: chat.configId,
          conversationId: input.conversationId,
          stageLabel: etiqueta,
          texto: nota,
        }).catch(() => {});
      }
    } else {
      await recordConversationActivity({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        channelId: chat.channelId,
        contactId: chat.contactId,
        kind: "stage_changed",
        text: nota,
      });
    }
    return destino;
  } catch (error) {
    console.warn("[etapa-automatica] no se pudo mover la etapa", {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
