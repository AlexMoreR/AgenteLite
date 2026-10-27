import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { registrarCambioDeEtapa } from "@/lib/historial-etapa";
import { decidirEtapaDeAgente } from "@/lib/crm-stage-sync";
import { createFollowsFromRulesForSource } from "@/features/seguimientos/services/follows";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { CRM_STAGE_META } from "@/features/crm/domain/crm-config";
import { NOTA_ETAPA_AUTOMATICA, textoEnviadoTraeElTotal } from "@/lib/etapa-automatica-reglas";
import type { CrmStage } from "@/features/crm/types";

/**
 * ETAPA AUTOMÁTICA DEL CRM: sacar a los leads de "---" sin esperar a que alguien los arrastre.
 *
 * El 22-oct-2026 había 1.900 leads en NUEVO y los 90 que entraron ese día seguían ahí: el embudo
 * no se podía medir ni supervisar a las asesoras. Tres momentos mueven la etapa solos:
 *
 *  - se asigna el chat a una asesora y el lead está en NUEVO  -> Frío (CALIFICADO)
 *  - se crea una cotización desde el chat                      -> Caliente (NEGOCIACION)
 *  - se ENVÍA al cliente el panel de envío con el total        -> Caliente (NEGOCIACION)
 *
 * Usa el mismo candado que el bot (decidirEtapaDeAgente): solo avanza, nunca baja un lead, y nunca
 * pone Ganado ni Perdido (eso lo decide una persona, y Ganado pide número de cotización).
 *
 * Interruptor: AppSetting `crm:etapa-automatica:<negocio>` = `off` lo apaga. Viene prendido.
 * Nunca lanza: la asignación, la cotización o el envío ya ocurrieron y no se pueden romper por esto.
 */

export { textoEnviadoTraeElTotal };

export type FuenteDelChat = "agent" | "official";

export const CLAVE_ETAPA_AUTOMATICA = (workspaceId: string) => `crm:etapa-automatica:${workspaceId}`;

const ETIQUETA_PEDIDA: Record<"CALIFICADO" | "NEGOCIACION", string> = {
  CALIFICADO: "frio",
  NEGOCIACION: "caliente",
};

/** La decisión, sin base: a qué etapa pasa el lead, o null si no se mueve. */
export function decidirEtapaAutomatica(
  destino: "CALIFICADO" | "NEGOCIACION",
  actual: CrmStage,
): CrmStage | null {
  // Al asignar solo se sale de "sin etapa": un lead que ya está en Tibio o más arriba no baja.
  if (destino === "CALIFICADO" && actual !== "NUEVO") {
    return null;
  }
  return decidirEtapaDeAgente(ETIQUETA_PEDIDA[destino], actual).destino;
}

async function estaPrendida(workspaceId: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({
    where: { key: CLAVE_ETAPA_AUTOMATICA(workspaceId) },
    select: { value: true },
  });
  return fila?.value?.trim().toLowerCase() !== "off";
}

async function dejarNotaEnElChat(input: {
  fuente: FuenteDelChat;
  workspaceId: string;
  conversationId: string;
  channelId: string | null;
  contactId: string;
  configId: string | null;
  texto: string;
}) {
  if (input.fuente === "agent") {
    await recordConversationActivity({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      channelId: input.channelId,
      contactId: input.contactId,
      kind: "stage_changed",
      text: input.texto,
    });
    return;
  }
  if (!input.configId) {
    return;
  }
  // Canal oficial: la nota vive en su propia tabla, como mensaje SYSTEM marcado como actividad.
  const ahora = new Date();
  await prisma.$executeRaw`
    INSERT INTO "OfficialApiMessage" (
      "id", "configId", "conversationId", "direction", "type", "status",
      "content", "rawPayload", "createdAt", "updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${input.configId},
      ${input.conversationId},
      'OUTBOUND'::"OfficialApiMessageDirection",
      'SYSTEM'::"OfficialApiMessageType",
      'SENT'::"OfficialApiMessageStatus",
      ${input.texto},
      ${JSON.stringify({ source: "activity", kind: "stage_changed" })},
      ${ahora},
      ${ahora}
    )
  `;
}

/** Ficha del CRM y datos del chat, según la línea. null si no hay a quién moverle la etapa. */
async function resolverChat(fuente: FuenteDelChat, conversationId: string, workspaceId: string) {
  if (fuente === "agent") {
    const conversacion = await prisma.conversation.findFirst({
      where: { id: conversationId, workspaceId },
      select: { contactId: true, channelId: true, channel: { select: { purpose: true } } },
    });
    if (!conversacion?.contactId) return null;
    // La línea administrativa no entra al embudo de ventas.
    if (conversacion.channel?.purpose === "ADMIN") return null;
    return { contactId: conversacion.contactId, channelId: conversacion.channelId, configId: null };
  }
  const conversacion = await prisma.officialApiConversation.findFirst({
    where: { id: conversationId, config: { workspaceId } },
    select: { configId: true, contact: { select: { crmContactId: true } } },
  });
  const contactId = conversacion?.contact?.crmContactId;
  if (!conversacion || !contactId) return null;
  return { contactId, channelId: null, configId: conversacion.configId };
}

export type ResultadoEtapaAutomatica = { etapa: CrmStage | null };

/**
 * Mueve la etapa si corresponde. Devuelve la etapa nueva o null (no se movió o falló).
 *
 * `motivo` es el texto de la nota: "se asignó a Laura", "se creó la cotización COT-123"...
 */
export async function moverEtapaAutomatica(input: {
  fuente: FuenteDelChat;
  workspaceId: string;
  conversationId: string;
  destino: "CALIFICADO" | "NEGOCIACION";
  motivo: string;
}): Promise<ResultadoEtapaAutomatica> {
  try {
    if (!(await estaPrendida(input.workspaceId))) {
      return { etapa: null };
    }
    const chat = await resolverChat(input.fuente, input.conversationId, input.workspaceId);
    if (!chat) {
      return { etapa: null };
    }

    const contacto = await prisma.contact.findFirst({
      where: { id: chat.contactId, workspaceId: input.workspaceId },
      select: { crmStage: true, excludedFromCrm: true },
    });
    // Un número marcado fuera del CRM no es un lead.
    if (!contacto || contacto.excludedFromCrm) {
      return { etapa: null };
    }

    const actual = contacto.crmStage as CrmStage;
    const nueva = decidirEtapaAutomatica(input.destino, actual);
    if (!nueva) {
      return { etapa: null };
    }

    // Solo se guarda si el lead sigue en la etapa que se leyó: si otro cambio llegó en el medio
    // (otra tanda, o una persona lo movió a mano), gana ese y este no pisa nada.
    const cambiadas = await prisma.$executeRaw`
      UPDATE "Contact"
      SET "crmStage" = ${nueva}::"CrmStage",
          "updatedAt" = NOW()
      WHERE "id" = ${chat.contactId}
        AND "crmStage" = ${actual}::"CrmStage"
    `;
    if (!cambiadas) {
      return { etapa: null };
    }

    await registrarCambioDeEtapa({
      workspaceId: input.workspaceId,
      contactId: chat.contactId,
      conversationId: input.conversationId,
      etapaAnterior: actual,
      etapaNueva: nueva,
      origen: "AUTOMATICO",
      nota: `${NOTA_ETAPA_AUTOMATICA}: ${input.motivo}`,
    });

    // Mismas consecuencias que el cambio manual del kanban.
    await createFollowsFromRulesForSource({
      workspaceId: input.workspaceId,
      contactId: chat.contactId,
      sourceType: "CRM_STAGE",
      sourceId: nueva,
    }).catch(() => {});

    const etiqueta = CRM_STAGE_META[nueva]?.label ?? nueva;
    await dejarNotaEnElChat({
      fuente: input.fuente,
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      channelId: chat.channelId,
      contactId: chat.contactId,
      configId: chat.configId,
      texto: `Etapa movida por el sistema: ${etiqueta} (${input.motivo})`,
    }).catch(() => {});

    return { etapa: nueva };
  } catch (error) {
    console.error("[etapa-automatica] no se pudo mover la etapa", {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { etapa: null };
  }
}

/** Se asignó el chat a una asesora: si el lead está en NUEVO, pasa a Frío. */
export function etapaAlAsignarChat(input: {
  fuente: FuenteDelChat;
  workspaceId: string;
  conversationId: string;
  nombreAsesora: string | null;
}) {
  return moverEtapaAutomatica({
    fuente: input.fuente,
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    destino: "CALIFICADO",
    motivo: `se asignó a ${input.nombreAsesora?.trim() || "una asesora"}`,
  });
}

/** Se creó una cotización desde el chat: el lead pasa a Caliente. */
export function etapaAlCotizar(input: {
  fuente: FuenteDelChat;
  workspaceId: string;
  conversationId: string;
  numeroCotizacion: string | null;
}) {
  return moverEtapaAutomatica({
    fuente: input.fuente,
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    destino: "NEGOCIACION",
    motivo: input.numeroCotizacion ? `se creó la cotización ${input.numeroCotizacion}` : "se creó la cotización",
  });
}

/** El panel de envío con el total salió al cliente: el lead pasa a Caliente. */
export function etapaAlEnviarPanel(input: { fuente: FuenteDelChat; workspaceId: string; conversationId: string }) {
  return moverEtapaAutomatica({
    fuente: input.fuente,
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    destino: "NEGOCIACION",
    motivo: "se envió el panel de envío con el total",
  });
}
