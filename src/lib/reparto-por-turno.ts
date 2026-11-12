import { prisma } from "@/lib/prisma";
import { autoAssignConversationToCollaborator } from "@/lib/reparto-de-leads";
import { chatNecesitaAsesora } from "@/lib/reparto-cuando-lo-necesita";

/**
 * EL REPARTO: la clienta recibe asesora cuando el chat la NECESITA (Alex, 11-nov-2026).
 *
 * Desde el 11-11-2026 decide `chatNecesitaAsesora` (reparto-cuando-lo-necesita.ts): nadie antes de
 * que el bot mande las fotos, y después solo si el agente pidió asesora o la clienta habla de
 * precio, pago, envío, contraentrega o ciudad. Lo de abajo es la historia de la regla anterior.
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

/** Cuántos mensajes (los últimos del chat, con las notas) se leen: un chat sin asesora es casi siempre nuevo. */
const MENSAJES_A_MIRAR = 80;

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

  // Con las notas del sistema: la de "El agente pide un asesor" es una de las dos razones para asignar.
  const mensajes = await prisma.message.findMany({
    where: { conversationId: input.conversationId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: MENSAJES_A_MIRAR,
    select: { direction: true, type: true, content: true, createdAt: true },
  });

  const decision = chatNecesitaAsesora(mensajes);
  if (!decision.asignar) {
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
      motivo: decision.motivo,
      detalle: decision.detalle,
    });
  }
  return { asignada: Boolean(elegida) };
}
