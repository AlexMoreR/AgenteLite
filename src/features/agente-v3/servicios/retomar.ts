import { moverEtapaDesdeAgente } from "@/lib/crm-stage-sync";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { setConversationAutomationPaused } from "@/lib/conversation-automation";
import { sendAndPersistEvolutionFlowStepResilient } from "@/lib/evolution-envio";
import { prisma } from "@/lib/prisma";
import { sendChatPushToWorkspace } from "@/lib/web-push";

import { atenderConAgenteV3 } from "../motor/ejecutar";

/**
 * VOLVER A ENCENDER el agente en un chat y que retome donde se quedó.
 *
 * Pedido de Alex (25-09-2026), y nace de un caso concreto: una clienta contestó "Pestañas" a la
 * pregunta de qué servicios ofrece, ninguna regla reconocía esa palabra y el agente se quedó
 * mudo. Se corrigió la regla, pero ese chat quedó congelado igual, porque el agente solo
 * reacciona a mensajes NUEVOS y el de ella ya había pasado.
 *
 * Con esto, apagar y volver a encender el agente en ese chat es la forma de decirle "mirá otra
 * vez": si el último mensaje es del cliente y quedó sin respuesta, lo atiende.
 *
 * La regla que puso Alex, y es la que evita que esto moleste: **solo si el último mensaje es del
 * cliente**. Si el último lo escribió una asesora, el agente no dice nada — está esperando a que
 * el cliente conteste, y meter un mensaje ahí sería hablarle encima a la asesora.
 */
export async function retomarConversacionV3(input: {
  conversationId: string;
  workspaceId: string;
}): Promise<{ atendido: boolean; motivo?: string; regla?: string | null }> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, workspaceId: input.workspaceId },
    select: {
      id: true,
      contact: { select: { id: true, name: true, phoneNumber: true } },
      channel: {
        select: {
          id: true,
          workspaceId: true,
          agentId: true,
          evolutionInstanceName: true,
          metadata: true,
        },
      },
    },
  });

  const channel = conversation?.channel;
  const contact = conversation?.contact;
  if (!conversation || !channel || !contact?.phoneNumber) {
    return { atendido: false, motivo: "No se encontró el chat" };
  }

  const usaV3 =
    channel.metadata !== null &&
    typeof channel.metadata === "object" &&
    !Array.isArray(channel.metadata) &&
    (channel.metadata as Record<string, unknown>).agenteV3 === true;
  if (!usaV3 || !channel.evolutionInstanceName) {
    return { atendido: false, motivo: "Esta línea no usa el Agente V3" };
  }

  /*
    Los últimos mensajes de verdad: las notas del sistema ("Ganó tal regla", "movió la etapa") no
    son cosas que alguien haya dicho, y contarlas haría creer que el último en hablar fuimos
    nosotros cuando en realidad fue el cliente.
  */
  const ultimos = await prisma.message.findMany({
    where: { conversationId: conversation.id, type: { not: "SYSTEM" } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { direction: true, content: true },
  });

  const ultimo = ultimos[0];
  if (!ultimo) {
    return { atendido: false, motivo: "El chat no tiene mensajes" };
  }
  if (ultimo.direction !== "INBOUND") {
    return { atendido: false, motivo: "El último mensaje es nuestro: el agente espera al cliente" };
  }

  const texto = (ultimo.content ?? "").trim();
  if (!texto) {
    return { atendido: false, motivo: "El último mensaje del cliente no tiene texto" };
  }

  const instancia = channel.evolutionInstanceName;
  const telefono = contact.phoneNumber;

  const resultado = await atenderConAgenteV3({
    workspaceId: channel.workspaceId,
    conversationId: conversation.id,
    mensaje: texto,
    historial: ultimos
      .slice()
      .reverse()
      .filter((mensaje) => (mensaje.content ?? "").trim())
      .map((mensaje) => ({
        de: mensaje.direction === "INBOUND" ? ("cliente" as const) : ("negocio" as const),
        texto: (mensaje.content ?? "").slice(0, 300),
      })),
    herramientas: {
      enviarPaso: (paso) =>
        sendAndPersistEvolutionFlowStepResilient({
          step: paso,
          workspaceId: channel.workspaceId,
          conversationId: conversation.id,
          channelId: channel.id,
          contactId: contact.id,
          agentId: channel.agentId ?? undefined,
          instanceName: instancia,
          phoneNumber: telefono,
        }),
      avisarAsesor: async (motivo) => {
        await recordConversationActivity({
          workspaceId: channel.workspaceId,
          conversationId: conversation.id,
          channelId: channel.id,
          contactId: contact.id,
          kind: "note",
          text: `El agente pide un asesor: ${motivo}`,
        }).catch(() => {});

        await sendChatPushToWorkspace({
          workspaceId: channel.workspaceId,
          payload: {
            title: `Asesor requerido: ${contact.name?.trim() || telefono}`,
            body: motivo,
            tag: `advisor-request:${conversation.id}`,
            url: `/cliente/chats?chatKey=agent:${conversation.id}&assigned=all`,
          },
        });
      },
      cambiarEtapa: async (etapa) => {
        await moverEtapaDesdeAgente({
          workspaceId: channel.workspaceId,
          contactId: contact.id,
          conversationId: conversation.id,
          channelId: channel.id,
          etapa,
        }).catch(() => {});
      },
      pausarIa: async () => {
        await setConversationAutomationPaused({ conversationId: conversation.id, paused: true }).catch(() => {});
      },
      responderConIa: async (guia) => {
        console.log("[retomar] v3_responder_con_ia_pendiente", { conversationId: conversation.id, guia });
      },
    },
  }).catch((error) => {
    console.error("[retomar] v3_error", {
      conversationId: conversation.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  if (!resultado?.atendido) {
    return { atendido: false, motivo: resultado?.porque ?? "Ninguna regla encajó con ese mensaje" };
  }

  await recordConversationActivity({
    workspaceId: channel.workspaceId,
    conversationId: conversation.id,
    channelId: channel.id,
    contactId: contact.id,
    kind: "note",
    text: `El agente retomó la conversación al volver a encenderse: ${resultado.regla ?? "sin regla"}`,
  }).catch(() => {});

  return { atendido: true, regla: resultado.regla };
}
