import { prisma } from "@/lib/prisma";
import { autoAssignConversationToCollaborator } from "@/lib/reparto-de-leads";
import { SALUDOS_DEL_V3_DE_RESPALDO, turnoMereceAsesora } from "@/lib/turno-con-contenido";
import { leerLibro } from "@/features/agente-v3/servicios/almacen";

/**
 * EL REPARTO POR TURNO: la clienta que conversa bien con el bot también recibe asesora.
 *
 * Regla de Alex (02-10-2026). Hasta hoy una asesora recibía el chat solo cuando el agente pedía
 * ayuda, o cuando el chat llevaba media hora sin dueño con la clienta esperando. Si el bot iba
 * contestando bien, nadie lo recibía nunca: una clienta escribió 5 veces desde las 4:24 p. m. y
 * estuvo toda la tarde sola con el bot.
 *
 * Ahora, cada vez que la clienta escribe, se mira su TURNO (lo que escribió desde nuestra última
 * respuesta). Si antes le había contestado el agente o un flujo y el turno dice algo —no solo
 * saludo, emoji, "ok" o "gracias"; ver turno-con-contenido.ts—, el chat se reparte por la misma
 * rueda de siempre (reparto-de-leads.ts): colaboradoras de la línea, menos las pausadas y las que
 * están fuera de su horario. El dueño saca o mete a alguien desde Mi empresa → Equipo, sin código.
 *
 * Lo que NO hace:
 *  - No toca un chat que ya tiene asesora, ni las asignaciones viejas.
 *  - No corre en la línea administrativa: solo en las de ventas (`purpose = SALES`).
 *  - No cambia al agente: asignar no lo pausa. Sigue contestando hasta que la asesora escribe
 *    (escribir, desde el CRM o desde el celular, es lo que pausa la IA).
 */

/** El libro cambia poco: se lee como mucho cada 5 minutos, no en cada mensaje. */
const VIDA_DE_LOS_SALUDOS_MS = 5 * 60_000;
const saludosEnMemoria = new Map<string, { frases: string[]; leidoEn: number }>();

/**
 * Los saludos de la regla "Solo saluda sin decir qué busca" del libro del Agente V3, para que
 * "saludo" quiera decir lo mismo para el agente y para el reparto. Si el libro no responde, se usa
 * la copia de respaldo.
 */
async function saludosDelV3(workspaceId: string): Promise<string[]> {
  const guardado = saludosEnMemoria.get(workspaceId);
  if (guardado && Date.now() - guardado.leidoEn < VIDA_DE_LOS_SALUDOS_MS) {
    return guardado.frases;
  }
  let frases = SALUDOS_DEL_V3_DE_RESPALDO;
  try {
    const libro = await leerLibro(workspaceId);
    const delLibro = libro.reglas
      .filter((regla) => regla.cuando.tipo === "frase" && /saluda/i.test(regla.nombre ?? ""))
      .flatMap((regla) => (regla.cuando.tipo === "frase" ? regla.cuando.frases : []))
      .filter((frase): frase is string => typeof frase === "string" && frase.trim().length > 0);
    if (delLibro.length > 0) {
      frases = [...new Set([...delLibro, ...SALUDOS_DEL_V3_DE_RESPALDO])];
    }
  } catch {
    // Sin libro se reparte con la copia: es la misma lista al 02-10-2026.
  }
  saludosEnMemoria.set(workspaceId, { frases, leidoEn: Date.now() });
  return frases;
}

/** Cuántos mensajes hacia atrás se miran para encontrar el turno y nuestra última respuesta. */
const MENSAJES_A_MIRAR = 30;

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
    orderBy: { createdAt: "desc" },
    take: MENSAJES_A_MIRAR,
    select: { direction: true, type: true, content: true },
  });

  if (!turnoMereceAsesora(mensajes, await saludosDelV3(input.workspaceId))) {
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
