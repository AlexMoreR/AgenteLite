import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { decidirEtapaDeAgente } from "@/lib/crm-stage-sync";
import { registrarCambioDeEtapa } from "@/lib/historial-etapa";
import { recordConversationActivity } from "@/lib/conversation-activity";
import type { CrmStage } from "@/features/crm/types";

/**
 * ETAPA AUTOMÁTICA DEL CRM: sacar a los leads de "---" sin que nadie tenga que acordarse.
 *
 * El 22-oct-2026 había 1.900 leads en NUEVO ("---") y los 90 que entraron ese día seguían ahí: el
 * embudo no se podía medir ni supervisar a las asesoras. Reglas (decisión de Alex):
 *
 *  1. Se le asigna el chat a una asesora y el lead está en NUEVO  -> Frío (CALIFICADO).
 *  2. Se crea la cotización en Gestión desde el chat, o se ENVÍA al cliente el panel de envío con
 *     el total                                                    -> Caliente (NEGOCIACION).
 *  3. Nunca Ganado ni Perdido: cerrar es decisión humana.
 *  4. Nunca baja a un lead que ya está en una etapa más alta.
 *  5. Cada cambio deja una nota en el chat: "Etapa movida por el sistema: ...".
 *
 * El candado es el mismo del bot (`decidirEtapaDeAgente`): una sola regla de negocio, no dos.
 *
 * Interruptor: AppSetting `crm:etapa-automatica:<negocio>` = `off` lo apaga (viene prendido).
 *
 * Nunca lanza: va después de la asignación, la cotización o el envío, que ya ocurrieron, y no
 * pueden fallar por esto.
 */

export { textoTraeElTotal } from "@/lib/texto-trae-el-total";

export const CLAVE_ETAPA_AUTOMATICA = "crm:etapa-automatica:";

/** Las etapas con el nombre que se les dice en el negocio (lo que entiende el candado del bot). */
const FRIO = "Frío";
const CALIENTE = "Caliente";

export type MotivoDeEtapaAutomatica =
  | { tipo: "asignacion"; asesoraId: string }
  | { tipo: "cotizacion"; codigo: string }
  | { tipo: "panel-envio" };

/** A qué etapa lleva cada motivo (en palabras del negocio). */
export function etapaPedidaPorMotivo(motivo: MotivoDeEtapaAutomatica["tipo"]): string {
  return motivo === "asignacion" ? FRIO : CALIENTE;
}

/**
 * La decisión, sin base de datos: ¿a qué etapa pasa el lead? null = no se mueve.
 * Reutiliza el candado del bot: nunca Ganado/Perdido, nunca baja, nunca toca un lead cerrado.
 */
export function decidirEtapaAutomatica(motivo: MotivoDeEtapaAutomatica["tipo"], etapaActual: CrmStage): CrmStage | null {
  return decidirEtapaDeAgente(etapaPedidaPorMotivo(motivo), etapaActual).destino;
}

function textoDeLaNota(etapaNueva: CrmStage, motivo: MotivoDeEtapaAutomatica, asesora: string | null): string {
  const etapa = etapaNueva === "CALIFICADO" ? FRIO : CALIENTE;
  const porque =
    motivo.tipo === "asignacion"
      ? `se asignó a ${asesora || "una asesora"}`
      : motivo.tipo === "cotizacion"
        ? `se creó la cotización ${motivo.codigo}`
        : "se envió el panel de envío con el total";
  return `Etapa movida por el sistema: ${etapa} (${porque})`;
}

/** La nota en el chat de la API oficial: mensaje SYSTEM marcado como actividad (ver official-api-crm-stage). */
async function notaEnChatOficial(input: { configId: string; conversationId: string; texto: string }) {
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

/**
 * Mueve la etapa del lead de ese chat según el motivo. Devuelve la etapa nueva, o null si no se
 * movió (apagado, línea administrativa, fuera del CRM, ya estaba más arriba, o falló algo).
 */
export async function moverEtapaAutomatica(input: {
  workspaceId: string;
  source: "agent" | "official";
  conversationId: string;
  motivo: MotivoDeEtapaAutomatica;
}): Promise<CrmStage | null> {
  try {
    const apagado = await prisma.appSetting.findUnique({
      where: { key: `${CLAVE_ETAPA_AUTOMATICA}${input.workspaceId}` },
      select: { value: true },
    });
    if (apagado?.value?.trim().toLowerCase() === "off") {
      return null;
    }

    let contactId: string | null = null;
    let channelId: string | null = null;
    let configId: string | null = null;
    if (input.source === "official") {
      const chat = await prisma.officialApiConversation.findFirst({
        where: { id: input.conversationId, config: { workspaceId: input.workspaceId } },
        select: { configId: true, contact: { select: { crmContactId: true } } },
      });
      contactId = chat?.contact?.crmContactId ?? null;
      configId = chat?.configId ?? null;
    } else {
      const chat = await prisma.conversation.findFirst({
        where: { id: input.conversationId, workspaceId: input.workspaceId },
        select: { channelId: true, contactId: true, channel: { select: { purpose: true } } },
      });
      // La línea administrativa no es embudo de ventas.
      if (chat?.channel?.purpose === "ADMIN") {
        return null;
      }
      contactId = chat?.contactId ?? null;
      channelId = chat?.channelId ?? null;
    }
    if (!contactId) {
      return null;
    }

    const contacto = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId: input.workspaceId },
      select: { crmStage: true, excludedFromCrm: true },
    });
    if (!contacto || contacto.excludedFromCrm) {
      return null;
    }

    const actual = contacto.crmStage as CrmStage;
    const destino = decidirEtapaAutomatica(input.motivo.tipo, actual);
    if (!destino) {
      return null;
    }

    // Solo se guarda si el lead sigue en la etapa que se leyó: si dos cambios llegan a la vez entra
    // uno solo, y si una persona lo movió en el medio, gana la persona.
    const guardado = await prisma.contact.updateMany({
      where: { id: contactId, workspaceId: input.workspaceId, crmStage: actual },
      data: { crmStage: destino },
    });
    if (guardado.count === 0) {
      return null;
    }

    let asesora: string | null = null;
    if (input.motivo.tipo === "asignacion") {
      const persona = await prisma.user.findUnique({
        where: { id: input.motivo.asesoraId },
        select: { name: true, email: true },
      });
      asesora = persona?.name?.trim() || persona?.email || null;
    }
    const texto = textoDeLaNota(destino, input.motivo, asesora);

    await registrarCambioDeEtapa({
      workspaceId: input.workspaceId,
      contactId,
      conversationId: input.conversationId,
      etapaAnterior: actual,
      etapaNueva: destino,
      origen: "AUTOMATICO",
      nota: `etapa automática: ${texto.replace("Etapa movida por el sistema: ", "")}`,
    });

    if (input.source === "official" && configId) {
      await notaEnChatOficial({ configId, conversationId: input.conversationId, texto }).catch(() => {});
    } else {
      await recordConversationActivity({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        channelId,
        contactId,
        kind: "stage_changed",
        text: texto,
        origen: "etapa-automatica",
      }).catch(() => {});
    }

    return destino;
  } catch (error) {
    console.error("[etapa-automatica] no se pudo mover la etapa (el chat sigue igual)", {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
