import { randomUUID } from "node:crypto";
import { CRM_STAGE_META } from "@/features/crm/domain/crm-config";
import type { CrmStage } from "@/features/crm/types";
import { createFollowsFromRulesForSource } from "@/features/seguimientos/services/follows";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { decidirEtapaDeAgente } from "@/lib/crm-stage-sync";
import {
  CLAVE_ETAPA_AUTOMATICA,
  etapaPedidaPorMotivo,
  notaDelChat,
  notaDelHistorial,
  type MotivoEtapaAutomatica,
} from "@/lib/etapa-automatica-reglas";
import { registrarCambioDeEtapa } from "@/lib/historial-etapa";
import { prisma } from "@/lib/prisma";

export { textoConservaElTotal, type MotivoEtapaAutomatica } from "@/lib/etapa-automatica-reglas";

/**
 * ETAPA AUTOMÁTICA DEL CRM: que un lead no se quede en "---" cuando ya hay trabajo hecho con él.
 *
 * Medido el 22-oct-2026: 1.900 leads en NUEVO, y de los 90 que entraron ese día ninguno avanzó. Sin
 * etapa no se puede medir el embudo ni supervisar a las asesoras. Tres momentos mueven al lead:
 *  - se le asigna el chat a una asesora (NUEVO -> Frío);
 *  - se crea la cotización en Gestión desde el chat (-> Caliente);
 *  - se ENVÍA al cliente el mensaje del panel de envío con el total (-> Caliente).
 *
 * Candados (los mismos del bot, `decidirEtapaDeAgente`): solo avanza, nunca baja a un lead, nunca
 * pone Ganado ni Perdido (eso es decisión humana) y no toca leads cerrados. Además no mueve leads
 * "fuera del CRM" ni los de la línea administrativa.
 *
 * El cambio solo se guarda si el lead SIGUE en la etapa que se leyó: si dos cambios llegan a la
 * vez entra uno solo, y si una persona lo movió a mano en el medio, gana la persona.
 *
 * Interruptor: AppSetting `crm:etapa-automatica:<negocio>` = `off`. Viene prendido.
 *
 * NUNCA lanza: asignar, cotizar o enviar ya ocurrieron y no se pueden frenar por esto.
 */

export type ResultadoEtapaAutomatica = {
  /** Etapa a la que quedó, o null si no se movió. */
  etapa: CrmStage | null;
  motivo?: "apagada" | "sin-chat" | "sin-contacto" | "linea-administrativa" | "no-aplica" | "cambio-en-el-medio";
};

export async function etapaAutomaticaEstaPrendida(workspaceId: string): Promise<boolean> {
  const ajuste = await prisma.appSetting.findUnique({
    where: { key: `${CLAVE_ETAPA_AUTOMATICA}${workspaceId}` },
    select: { value: true },
  });
  return (ajuste?.value ?? "").trim().toLowerCase() !== "off";
}

/** Los datos del chat que hacen falta: a qué ficha del CRM apunta y por dónde dejar la nota. */
async function leerChat(input: {
  workspaceId: string;
  conversationId: string;
  canal: "agent" | "official";
}): Promise<
  | { ok: true; contactId: string; channelId: string | null; configId: string | null }
  | { ok: false; motivo: "sin-chat" | "sin-contacto" | "linea-administrativa" }
> {
  if (input.canal === "official") {
    const filas = await prisma.$queryRaw<Array<{ crmContactId: string | null; configId: string }>>`
      SELECT ct."crmContactId" AS "crmContactId", c."configId" AS "configId"
      FROM "OfficialApiConversation" c
      INNER JOIN "OfficialApiContact" ct ON ct."id" = c."contactId"
      WHERE c."id" = ${input.conversationId}
      LIMIT 1
    `;
    const fila = filas[0];
    if (!fila) return { ok: false, motivo: "sin-chat" };
    if (!fila.crmContactId) return { ok: false, motivo: "sin-contacto" };
    return { ok: true, contactId: fila.crmContactId, channelId: null, configId: fila.configId };
  }

  const conversacion = await prisma.conversation.findFirst({
    where: { id: input.conversationId, workspaceId: input.workspaceId },
    select: { contactId: true, channelId: true, channel: { select: { purpose: true } } },
  });
  if (!conversacion) return { ok: false, motivo: "sin-chat" };
  // La línea administrativa (proveedores, logística) no entra al embudo de ventas.
  if (conversacion.channel?.purpose === "ADMIN") return { ok: false, motivo: "linea-administrativa" };
  return { ok: true, contactId: conversacion.contactId, channelId: conversacion.channelId, configId: null };
}

/** La nota en el chat de la API oficial: mensaje SYSTEM marcado como actividad (lo dibuja como chip). */
async function dejarNotaEnChatOficial(input: { configId: string; conversationId: string; texto: string }) {
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

export async function moverEtapaAutomatica(input: {
  workspaceId: string;
  conversationId: string;
  /** "agent" = WhatsApp viejo (Conversation); "official" = API oficial (OfficialApiConversation). */
  canal: "agent" | "official";
  motivo: MotivoEtapaAutomatica;
}): Promise<ResultadoEtapaAutomatica> {
  try {
    if (!(await etapaAutomaticaEstaPrendida(input.workspaceId))) {
      return { etapa: null, motivo: "apagada" };
    }

    const chat = await leerChat(input);
    if (!chat.ok) {
      return { etapa: null, motivo: chat.motivo };
    }

    const contacto = await prisma.contact.findFirst({
      where: { id: chat.contactId, workspaceId: input.workspaceId },
      select: { crmStage: true, excludedFromCrm: true },
    });
    if (!contacto || contacto.excludedFromCrm) {
      return { etapa: null, motivo: "sin-contacto" };
    }

    const actual = contacto.crmStage as CrmStage;
    // El candado del bot: solo hacia adelante, nada de Ganado/Perdido, nada de leads cerrados.
    const { destino } = decidirEtapaDeAgente(etapaPedidaPorMotivo(input.motivo), actual);
    if (!destino) {
      return { etapa: null, motivo: "no-aplica" };
    }

    // Solo se guarda si el lead sigue en la etapa que se leyó: dos cambios a la vez, entra uno.
    const guardado = await prisma.contact.updateMany({
      where: { id: chat.contactId, workspaceId: input.workspaceId, crmStage: actual, excludedFromCrm: false },
      data: { crmStage: destino },
    });
    if (guardado.count === 0) {
      return { etapa: null, motivo: "cambio-en-el-medio" };
    }

    await registrarCambioDeEtapa({
      workspaceId: input.workspaceId,
      contactId: chat.contactId,
      conversationId: input.conversationId,
      etapaAnterior: actual,
      etapaNueva: destino,
      origen: "AUTOMATICO",
      nota: notaDelHistorial(input.motivo),
    });

    // Mismas consecuencias que mover la tarjeta a mano (reglas de seguimiento por etapa).
    await createFollowsFromRulesForSource({
      workspaceId: input.workspaceId,
      contactId: chat.contactId,
      sourceType: "CRM_STAGE",
      sourceId: destino,
    }).catch(() => {});

    const texto = notaDelChat(CRM_STAGE_META[destino]?.label ?? destino, input.motivo);
    if (input.canal === "official" && chat.configId) {
      await dejarNotaEnChatOficial({ configId: chat.configId, conversationId: input.conversationId, texto }).catch(
        () => {},
      );
    } else {
      await recordConversationActivity({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        channelId: chat.channelId,
        contactId: chat.contactId,
        kind: "stage_changed",
        origen: "etapa-automatica",
        text: texto,
      }).catch(() => {});
    }

    return { etapa: destino };
  } catch (error) {
    // Nunca frena la asignación, la cotización ni el envío que lo llamó.
    console.warn("[etapa-automatica] no se pudo mover la etapa", {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { etapa: null };
  }
}
