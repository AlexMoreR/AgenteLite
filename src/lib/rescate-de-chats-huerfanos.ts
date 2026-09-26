import { prisma } from "@/lib/prisma";
import { autoAssignConversationToCollaborator } from "@/lib/reparto-de-leads";

/**
 * LA RED: un cliente esperando y sin nadie a cargo.
 *
 * Desde el 25-09-2026 los leads se reparten cuando el agente levanta la mano, no al entrar. Es lo
 * que evita que una asesora cargue con decenas de chats que escriben una vez y desaparecen.
 *
 * Pero deja un hueco: si el agente NO levanta la mano —porque no entendió y tampoco escaló, o
 * porque el servidor tuvo un hipo— ese chat se queda sin dueño y sin respuesta, y nadie lo ve en
 * "Mías". Paso de verdad el mismo día, dos veces, con "Pestañas" y con una clienta que solo dijo
 * su nombre y su ciudad.
 *
 * Esto lo tapa: cada vuelta busca chats donde el último que habló fue el cliente, nadie contestó
 * en media hora y no tienen dueño. Los reparte por turnos, igual que el resto.
 *
 * No manda ningún mensaje al cliente: solo pone a alguien a cargo. Quien decide qué decirle es la
 * asesora que lo recibe.
 */

/** Cuánto se espera antes de rescatar. Menos que esto es no darle tiempo al agente a trabajar. */
const ESPERA_MINUTOS = 30;

/** Un chat de ayer no es un rescate: es otra conversación. */
const VENTANA_MAXIMA_HORAS = 12;

/** Por vuelta: el cron corre cada minuto, así que un atraso se drena solo. */
const CUANTOS_POR_VUELTA = 15;

export async function rescatarChatsHuerfanos(ahora = new Date()): Promise<{ repartidos: number; revisados: number }> {
  const candidatas = await prisma.conversation.findMany({
    where: {
      assignedToUserId: null,
      status: { notIn: ["CLOSED", "ARCHIVED"] },
      channelId: { not: null },
      lastMessageAt: {
        lte: new Date(ahora.getTime() - ESPERA_MINUTOS * 60_000),
        gte: new Date(ahora.getTime() - VENTANA_MAXIMA_HORAS * 3_600_000),
      },
    },
    select: { id: true, channelId: true, workspaceId: true },
    orderBy: { lastMessageAt: "desc" },
    take: CUANTOS_POR_VUELTA * 3,
  });

  let repartidos = 0;
  let revisados = 0;

  for (const conversacion of candidatas) {
    if (repartidos >= CUANTOS_POR_VUELTA) {
      break;
    }
    revisados += 1;

    /*
      Que el cliente esté esperando de verdad: el último mensaje tiene que ser suyo.

      Las notas del sistema no cuentan como hablar —el agente deja una después de cada respuesta—,
      así que mirarlas haría creer que el último en hablar fuimos nosotros.
    */
    const ultimo = await prisma.message.findFirst({
      where: { conversationId: conversacion.id, type: { not: "SYSTEM" } },
      orderBy: { createdAt: "desc" },
      select: { direction: true },
    });
    if (!ultimo || ultimo.direction !== "INBOUND" || !conversacion.channelId) {
      continue;
    }

    try {
      await autoAssignConversationToCollaborator({
        conversationId: conversacion.id,
        channelId: conversacion.channelId,
        workspaceId: conversacion.workspaceId,
      });
      repartidos += 1;
    } catch (error) {
      console.error("[rescate] no se pudo repartir el chat", {
        conversationId: conversacion.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { repartidos, revisados };
}
