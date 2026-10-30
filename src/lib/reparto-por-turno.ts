import { prisma } from "@/lib/prisma";
import { autoAssignConversationToCollaborator } from "@/lib/reparto-de-leads";
import { respondioLaBienvenida } from "@/lib/turno-con-contenido";

/**
 * EL REPARTO: la clienta recibe asesora apenas responde la bienvenida.
 *
 * Regla de Alex (30-10-2026, pisa la del 02-10 y el interruptor `exigirPrecioOFotos` del 12-10).
 * Se asigna cuando se cumplen tres cosas: el chat no tiene asesora, la línea es de ventas
 * (`purpose = SALES`) y la clienta ya mandó un mensaje DESPUÉS del primer mensaje nuestro
 * (`respondioLaBienvenida`, en turno-con-contenido.ts). Cuenta cualquier respuesta, hasta un "ok":
 * ya no se filtra por contenido. El primer mensaje de la clienta sigue sin asignar.
 *
 * Se mira todo el historial y no "lo último": esta revisión corre en `after()`, cuando el bot ya
 * contestó, y por eso antes la respuesta de la clienta quedaba como "ya atendida" y nadie la recibía.
 * El chat se reparte por la misma rueda de siempre (reparto-de-leads.ts): colaboradoras de la línea,
 * menos las pausadas y las fuera de horario.
 *
 * Lo que NO hace:
 *  - No toca un chat que ya tiene asesora, ni las asignaciones viejas.
 *  - No corre en la línea administrativa.
 *  - No cambia al agente ni manda mensajes: asignar no lo pausa.
 */

/** Cuántos mensajes (los primeros del chat) se leen: sobran para ver nuestro primer mensaje y una respuesta. */
const MENSAJES_A_MIRAR = 60;

export async function repartirSiElTurnoLoAmerita(input: {
  conversationId: string;
  channelId: string;
  workspaceId: string;
}): Promise<{ asignada: boolean }> {
  const [conversacion, canal] = await Promise.all([
    prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: { assignedToUserId: true },
    }),
    prisma.whatsAppChannel.findUnique({
      where: { id: input.channelId },
      select: { purpose: true },
    }),
  ]);
  if (!conversacion || conversacion.assignedToUserId || canal?.purpose !== "SALES") {
    return { asignada: false };
  }

  const mensajes = await prisma.message.findMany({
    where: { conversationId: input.conversationId, type: { not: "SYSTEM" }, deletedAt: null },
    orderBy: { createdAt: "asc" },
    take: MENSAJES_A_MIRAR,
    select: { direction: true, type: true, content: true, createdAt: true },
  });

  if (!respondioLaBienvenida(mensajes)) {
    return { asignada: false };
  }

  const elegida = await autoAssignConversationToCollaborator({
    conversationId: input.conversationId,
    channelId: input.channelId,
    workspaceId: input.workspaceId,
  });
  if (elegida) {
    console.log("[reparto-por-turno] asignada", {
      conversationId: input.conversationId,
      channelId: input.channelId,
      userId: elegida,
    });
  }
  return { asignada: Boolean(elegida) };
}
