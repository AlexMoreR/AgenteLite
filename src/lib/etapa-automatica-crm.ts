import { CRM_STAGE_META } from "@/features/crm/domain/crm-config";
import type { CrmStage } from "@/features/crm/types";
import { createFollowsFromRulesForSource } from "@/features/seguimientos/services/follows";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { decidirEtapaDeAgente, type ResultadoEtapaDeAgente } from "@/lib/crm-stage-sync";
import { recordOfficialApiStageActivity } from "@/lib/official-api-crm-stage";
import { prisma } from "@/lib/prisma";

/**
 * ETAPA AUTOMÁTICA DEL CRM: el lead avanza solo en los momentos obvios.
 *
 * Medido el 22-oct-2026: 1.900 leads en NUEVO ("---"). Solo el día anterior entraron 90 y ninguno
 * pasó a otra etapa. El bot ya movía etapas leyendo la conversación (crm-stage-sync.ts), pero lo que
 * hace la asesora no movía nada: se le asignaba el chat, cotizaba, le ponía el total del envío, y el
 * lead seguía en NUEVO. Sin eso no se puede medir el embudo ni supervisar a nadie.
 *
 * Tres momentos, y solo hacia adelante:
 *  - Se le asigna el chat a una asesora      -> Frío (CALIFICADO), solo si estaba en NUEVO.
 *  - Se crea una cotización en Gestión       -> Caliente (NEGOCIACION).
 *  - La asesora pone el panel de envío con el total en el chat -> Caliente (NEGOCIACION).
 *
 * Las protecciones son las del bot, no unas nuevas: pasa por `decidirEtapaDeAgente`, así que nunca
 * pone Ganado ni Perdido, nunca baja a un lead y no toca uno ya cerrado. Un lead "fuera del CRM" o
 * de la línea administrativa tampoco se mueve.
 *
 * Nunca lanza: un error acá no puede frenar la asignación, la cotización ni el panel.
 */

/** Interruptor por negocio en AppSetting. Viene prendido: solo "off" lo apaga. */
export const CLAVE_ETAPA_AUTOMATICA = "crm:etapa-automatica:";

export type MotivoDeEtapa =
  | { tipo: "asignado"; asesora: string }
  | { tipo: "cotizacion"; codigo: string }
  | { tipo: "panel-de-envio" };

export type ChatDeEtapa = { source: "agent" | "official"; conversationId: string };

export type DecisionDeEtapa = {
  destino: CrmStage | null;
  /** Por qué no se movió: lo propio de acá, o lo que dijo el candado del bot. */
  motivo?: "apagado" | "fuera-del-crm" | "no-era-nuevo" | ResultadoEtapaDeAgente["motivo"];
};

/** La decisión, sin base de datos (la prueba es scripts/check-etapa-automatica.mjs). */
export function decidirEtapaAutomatica(input: {
  motivo: MotivoDeEtapa;
  etapaActual: CrmStage;
  fueraDelCrm: boolean;
  prendido: boolean;
}): DecisionDeEtapa {
  if (!input.prendido) {
    return { destino: null, motivo: "apagado" };
  }
  if (input.fueraDelCrm) {
    return { destino: null, motivo: "fuera-del-crm" };
  }
  // Asignar solo saca de NUEVO: un lead que ya estaba en Tibio sigue en Tibio.
  if (input.motivo.tipo === "asignado") {
    if (input.etapaActual !== "NUEVO") {
      return { destino: null, motivo: "no-era-nuevo" };
    }
    return decidirEtapaDeAgente("calificado", input.etapaActual);
  }
  return decidirEtapaDeAgente("negociacion", input.etapaActual);
}

/** "Etapa movida por el sistema: Frio (se asignó a Laura)". */
export function textoDeLaNota(destino: CrmStage, motivo: MotivoDeEtapa): string {
  const etapa = CRM_STAGE_META[destino]?.label ?? destino;
  const porque =
    motivo.tipo === "asignado"
      ? `se asignó a ${motivo.asesora}`
      : motivo.tipo === "cotizacion"
        ? `se creó la cotización ${motivo.codigo}`
        : "se puso en el chat el panel de envío con el total";
  return `Etapa movida por el sistema: ${etapa} (${porque})`;
}

async function estaPrendida(workspaceId: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({
    where: { key: `${CLAVE_ETAPA_AUTOMATICA}${workspaceId}` },
    select: { value: true },
  });
  return fila?.value?.trim().toLowerCase() !== "off";
}

type ChatLeido = {
  contactId: string | null;
  /** Canal viejo: la nota va a Message. */
  channelId: string | null;
  /** API oficial: la nota va a OfficialApiMessage. */
  configId: string | null;
  lineaAdministrativa: boolean;
};

async function leerChat(workspaceId: string, chat: ChatDeEtapa): Promise<ChatLeido | null> {
  if (chat.source === "official") {
    const fila = await prisma.officialApiConversation.findFirst({
      where: { id: chat.conversationId, config: { workspaceId } },
      select: { configId: true, contact: { select: { crmContactId: true } } },
    });
    return fila
      ? { contactId: fila.contact.crmContactId, channelId: null, configId: fila.configId, lineaAdministrativa: false }
      : null;
  }
  const fila = await prisma.conversation.findFirst({
    where: { id: chat.conversationId, workspaceId },
    select: { contactId: true, channelId: true, channel: { select: { purpose: true } } },
  });
  return fila
    ? {
        contactId: fila.contactId,
        channelId: fila.channelId,
        configId: null,
        lineaAdministrativa: fila.channel?.purpose === "ADMIN",
      }
    : null;
}

/**
 * Mueve la etapa del lead del chat si corresponde. Devuelve la etapa nueva, o null si no movió.
 *
 * Mismas consecuencias que mover la tarjeta a mano: arrancan los seguimientos de la etapa y queda
 * la nota en el chat.
 */
export async function moverEtapaAutomatica(input: {
  workspaceId: string;
  chat: ChatDeEtapa;
  motivo: MotivoDeEtapa;
}): Promise<CrmStage | null> {
  try {
    const chat = await leerChat(input.workspaceId, input.chat);
    if (!chat?.contactId) {
      return null;
    }
    const [contacto, prendido] = await Promise.all([
      prisma.contact.findFirst({
        where: { id: chat.contactId, workspaceId: input.workspaceId },
        select: { crmStage: true, excludedFromCrm: true },
      }),
      estaPrendida(input.workspaceId),
    ]);
    if (!contacto) {
      return null;
    }

    const etapaActual = contacto.crmStage as CrmStage;
    const { destino } = decidirEtapaAutomatica({
      motivo: input.motivo,
      etapaActual,
      // La línea administrativa no alimenta el CRM: es lo mismo que un número fuera del CRM.
      fueraDelCrm: contacto.excludedFromCrm || chat.lineaAdministrativa,
      prendido,
    });
    if (!destino) {
      return null;
    }

    // Solo si sigue en la etapa que se leyó: si alguien la movió a mano en el medio, manda eso.
    const cambiados = await prisma.$executeRaw`
      UPDATE "Contact"
      SET "crmStage" = ${destino}::"CrmStage",
          "updatedAt" = NOW()
      WHERE "id" = ${chat.contactId}
        AND "crmStage" = ${etapaActual}::"CrmStage"
    `;
    if (cambiados === 0) {
      return null;
    }

    await createFollowsFromRulesForSource({
      workspaceId: input.workspaceId,
      contactId: chat.contactId,
      sourceType: "CRM_STAGE",
      sourceId: destino,
    }).catch((error: unknown) => {
      console.warn("[etapa-automatica] no se pudieron crear los seguimientos de la etapa", {
        contactId: chat.contactId,
        destino,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    const texto = textoDeLaNota(destino, input.motivo);
    if (chat.configId) {
      await recordOfficialApiStageActivity({
        configId: chat.configId,
        conversationId: input.chat.conversationId,
        stageLabel: CRM_STAGE_META[destino]?.label ?? destino,
        text: texto,
      }).catch(() => {});
    } else {
      await recordConversationActivity({
        workspaceId: input.workspaceId,
        conversationId: input.chat.conversationId,
        channelId: chat.channelId,
        contactId: chat.contactId,
        kind: "stage_changed",
        origen: "etapa-automatica",
        text: texto,
      });
    }

    return destino;
  } catch (error) {
    console.warn("[etapa-automatica] no se pudo mover la etapa", {
      conversationId: input.chat.conversationId,
      motivo: input.motivo.tipo,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Para el motivo "asignado": el nombre de la asesora como se muestra en el chat. */
export async function nombreDeAsesora(userId: string): Promise<string> {
  const usuario = await prisma.user
    .findUnique({ where: { id: userId }, select: { name: true, email: true } })
    .catch(() => null);
  return usuario?.name?.trim() || usuario?.email || "una asesora";
}
