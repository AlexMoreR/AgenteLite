import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { registrarCambioDeEtapa } from "@/lib/historial-etapa";
import { decidirEtapaDeAgente } from "@/lib/crm-stage-sync";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { createFollowsFromRulesForSource } from "@/features/seguimientos/services/follows";
import type { CrmStage } from "@/features/crm/types";

export { textoTraeElTotal } from "@/lib/etapa-automatica-crm-texto";

/**
 * ETAPA AUTOMÁTICA DEL CRM (22-oct-2026).
 *
 * Había ~1.900 leads en NUEVO ("---"): solo ese día entraron 90 y ninguno avanzó, así que el embudo
 * no se podía medir ni supervisar. Este "motor" mueve la etapa en dos momentos:
 *  - se le asigna el chat a una asesora y el lead está en NUEVO  -> Frío (CALIFICADO);
 *  - se crea la cotización en Gestión desde el chat, o sale al cliente el mensaje del panel de
 *    envío con el total                                          -> Caliente (NEGOCIACION).
 *
 * Usa el mismo candado que el bot (`decidirEtapaDeAgente`): nunca pone Ganado ni Perdido (eso lo
 * decide una persona, y Ganado pide número de cotización), nunca baja a un lead y no toca los
 * cerrados. Tampoco toca contactos "fuera del CRM" ni los de la línea administrativa.
 *
 * El cambio solo se guarda si el lead SIGUE en la etapa que se leyó: si alguien lo movió a mano en
 * el medio, o dos cambios llegan a la vez, entra uno solo. Cada cambio deja la nota "Etapa movida
 * por el sistema: ..." en el chat y una fila en el historial de etapas (origen AUTOMATICO).
 *
 * Interruptor: AppSetting `crm:etapa-automatica:<negocio>` = `off`. Viene prendido.
 * NUNCA lanza: la asignación, la cotización o el envío ya ocurrieron y no se pueden romper por esto.
 */

export type MotivoDeEtapaAutomatica =
  | { tipo: "asignado"; asesora?: string | null }
  | { tipo: "cotizacion"; referencia?: string | null }
  | { tipo: "panel-de-envio" };

const ETIQUETA: Partial<Record<CrmStage, string>> = {
  CALIFICADO: "Frío",
  NEGOCIACION: "Caliente",
};

/** Prefijo de la nota del historial: así el embudo y la lista de Llamadas reconocen estos cambios. */
export const NOTA_ETAPA_AUTOMATICA = "etapa automática";

export function claveInterruptorEtapaAutomatica(workspaceId: string): string {
  return `crm:etapa-automatica:${workspaceId}`;
}

export async function etapaAutomaticaPrendida(workspaceId: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({
    where: { key: claveInterruptorEtapaAutomatica(workspaceId) },
    select: { value: true },
  });
  return fila?.value?.trim().toLowerCase() !== "off";
}

/** "se asignó a Laura", "se creó la cotización COT-123", "se envió el panel de envío con el total". */
export function textoDelMotivo(motivo: MotivoDeEtapaAutomatica): string {
  if (motivo.tipo === "asignado") {
    return motivo.asesora?.trim() ? `se asignó a ${motivo.asesora.trim()}` : "se asignó a una asesora";
  }
  if (motivo.tipo === "cotizacion") {
    return motivo.referencia?.trim() ? `se creó la cotización ${motivo.referencia.trim()}` : "se creó la cotización";
  }
  return "se envió el panel de envío con el total";
}

/** Texto de la nota que se ve en el chat. */
export function notaDelChat(destino: CrmStage, motivo: MotivoDeEtapaAutomatica): string {
  return `Etapa movida por el sistema: ${ETIQUETA[destino] ?? destino} (${textoDelMotivo(motivo)})`;
}

type Destino = "CALIFICADO" | "NEGOCIACION";

type Entrada = {
  workspaceId: string;
  /** "agent" = línea de WhatsApp de siempre; "official" = API oficial. */
  source: "agent" | "official";
  conversationId: string;
  destino: Destino;
  motivo: MotivoDeEtapaAutomatica;
};

async function dejarNotaOficial(input: { configId: string; conversationId: string; texto: string }) {
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
      ${JSON.stringify({ source: "activity", kind: "stage_changed", origen: "etapa-automatica" })},
      ${ahora},
      ${ahora}
    )
  `;
}

/** Devuelve la etapa a la que quedó el lead, o null si no se movió. Nunca lanza. */
export async function moverEtapaAutomatica(entrada: Entrada): Promise<CrmStage | null> {
  try {
    if (!(await etapaAutomaticaPrendida(entrada.workspaceId))) return null;

    let contactId: string | null = null;
    let channelId: string | null = null;
    let configId: string | null = null;

    if (entrada.source === "agent") {
      const conversacion = await prisma.conversation.findFirst({
        where: { id: entrada.conversationId, workspaceId: entrada.workspaceId },
        select: { contactId: true, channelId: true, channel: { select: { purpose: true } } },
      });
      if (!conversacion) return null;
      // La línea administrativa no es del embudo de ventas.
      if (conversacion.channel && conversacion.channel.purpose !== "SALES") return null;
      contactId = conversacion.contactId;
      channelId = conversacion.channelId;
    } else {
      const conversacion = await prisma.officialApiConversation.findUnique({
        where: { id: entrada.conversationId },
        select: { configId: true, contact: { select: { crmContactId: true } } },
      });
      contactId = conversacion?.contact?.crmContactId ?? null;
      configId = conversacion?.configId ?? null;
    }
    if (!contactId) return null;

    const contacto = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId: entrada.workspaceId },
      select: { crmStage: true, excludedFromCrm: true },
    });
    if (!contacto || contacto.excludedFromCrm) return null;

    const actual = contacto.crmStage as CrmStage;
    const { destino } = decidirEtapaDeAgente(entrada.destino, actual);
    if (!destino) return null;

    // Solo si sigue en la etapa leída: si alguien lo movió en el medio, gana la persona.
    const guardado = await prisma.contact.updateMany({
      where: { id: contactId, workspaceId: entrada.workspaceId, crmStage: actual },
      data: { crmStage: destino },
    });
    if (guardado.count === 0) return null;

    await registrarCambioDeEtapa({
      workspaceId: entrada.workspaceId,
      contactId,
      conversationId: entrada.conversationId,
      etapaAnterior: actual,
      etapaNueva: destino,
      origen: "AUTOMATICO",
      nota: `${NOTA_ETAPA_AUTOMATICA}: ${textoDelMotivo(entrada.motivo)}`,
    });

    // Las mismas consecuencias que mover la tarjeta a mano (hoy no hay reglas de seguimiento por etapa).
    await createFollowsFromRulesForSource({
      workspaceId: entrada.workspaceId,
      contactId,
      sourceType: "CRM_STAGE",
      sourceId: destino,
    }).catch(() => {});

    const texto = notaDelChat(destino, entrada.motivo);
    try {
      if (entrada.source === "agent") {
        await recordConversationActivity({
          workspaceId: entrada.workspaceId,
          conversationId: entrada.conversationId,
          channelId,
          contactId,
          kind: "stage_changed",
          text: texto,
        });
      } else if (configId) {
        await dejarNotaOficial({ configId, conversationId: entrada.conversationId, texto });
      }
    } catch (error) {
      console.warn("[etapa-automatica] la etapa cambió pero no se pudo dejar la nota en el chat", {
        conversationId: entrada.conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return destino;
  } catch (error) {
    console.warn("[etapa-automatica] no se pudo mover la etapa", {
      conversationId: entrada.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Atajo: se le asignó el chat a una asesora. */
export function etapaAlAsignar(input: {
  workspaceId: string;
  source: "agent" | "official";
  conversationId: string;
  asesora?: string | null;
}): Promise<CrmStage | null> {
  return moverEtapaAutomatica({
    workspaceId: input.workspaceId,
    source: input.source,
    conversationId: input.conversationId,
    destino: "CALIFICADO",
    motivo: { tipo: "asignado", asesora: input.asesora },
  });
}

/** Atajo: pasa a Caliente por una cotización creada o por el panel de envío enviado. */
export function etapaCaliente(input: {
  workspaceId: string;
  source: "agent" | "official";
  conversationId: string;
  motivo: Exclude<MotivoDeEtapaAutomatica, { tipo: "asignado" }>;
}): Promise<CrmStage | null> {
  return moverEtapaAutomatica({
    workspaceId: input.workspaceId,
    source: input.source,
    conversationId: input.conversationId,
    destino: "NEGOCIACION",
    motivo: input.motivo,
  });
}
