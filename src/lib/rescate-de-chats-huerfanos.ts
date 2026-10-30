import { leerMarcaExterior } from "@/features/seguimiento-inteligente/dominio/exterior";
import { ventanaDeMadrugada } from "@/lib/en-linea-reglas";
import { prisma } from "@/lib/prisma";
import { autoAssignConversationToCollaborator } from "@/lib/reparto-de-leads";
import { respondioLaBienvenida } from "@/lib/turno-con-contenido";

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
 * SEGUNDO CASO (Alex, 30-10-2026): la clienta que respondió la bienvenida y quedó sin asesora.
 * El reparto por turno asigna apenas la clienta responde la bienvenida, pero corre cuando el bot
 * ya le contestó: si se escapa, el último mensaje del chat es del bot y el primer caso nunca lo
 * ve (así quedaron 9 chats el 29-oct). Por eso también se revisan los chats de líneas de VENTAS
 * sin asesora con movimiento en las últimas 48 h, sin esperar los 30 minutos, y se rescata el que
 * cumple `respondioLaBienvenida`.
 *
 * No manda ningún mensaje al cliente: solo pone a alguien a cargo. Quien decide qué decirle es la
 * asesora que lo recibe.
 */

/** Cuánto se espera antes de rescatar. Menos que esto es no darle tiempo al agente a trabajar. */
const ESPERA_MINUTOS = 30;

/** Un chat de ayer no es un rescate: es otra conversación. */
const VENTANA_MAXIMA_HORAS = 12;

/** Segundo caso: hasta cuántas horas atrás se buscan chats de ventas que respondieron la bienvenida. */
const VENTANA_BIENVENIDA_HORAS = 48;

/** Cuántos mensajes se leen por chat para saber si respondió la bienvenida (los primeros alcanzan). */
const MENSAJES_A_MIRAR = 60;

/** Por vuelta: el cron corre cada minuto, así que un atraso se drena solo. */
const CUANTOS_POR_VUELTA = 15;

export async function rescatarChatsHuerfanos(ahora = new Date()): Promise<{ repartidos: number; revisados: number }> {
  const seleccion = {
    id: true,
    channelId: true,
    workspaceId: true,
    lastMessageAt: true,
    contact: { select: { metadata: true } },
  } as const;

  const primerCaso = await prisma.conversation.findMany({
    where: {
      assignedToUserId: null,
      status: { notIn: ["CLOSED", "ARCHIVED"] },
      channelId: { not: null },
      lastMessageAt: {
        lte: new Date(ahora.getTime() - ESPERA_MINUTOS * 60_000),
        gte: new Date(ahora.getTime() - VENTANA_MAXIMA_HORAS * 3_600_000),
      },
    },
    select: seleccion,
    orderBy: { lastMessageAt: "desc" },
    take: CUANTOS_POR_VUELTA * 3,
  });

  // Segundo caso: solo líneas de ventas (las administrativas no se reparten), sin esperar 30 min.
  const segundoCaso = await prisma.conversation.findMany({
    where: {
      assignedToUserId: null,
      status: { notIn: ["CLOSED", "ARCHIVED"] },
      channelId: { not: null },
      channel: { is: { purpose: "SALES" } },
      lastMessageAt: { gte: new Date(ahora.getTime() - VENTANA_BIENVENIDA_HORAS * 3_600_000) },
    },
    select: seleccion,
    orderBy: { lastMessageAt: "desc" },
    take: CUANTOS_POR_VUELTA * 6,
  });

  // Los dos casos juntos, sin repetir id; el primero va delante.
  const vistos = new Set<string>();
  const candidatas: Array<(typeof primerCaso)[number] & { porBienvenida: boolean }> = [];
  for (const c of primerCaso) {
    vistos.add(c.id);
    candidatas.push({ ...c, porBienvenida: false });
  }
  for (const c of segundoCaso) {
    if (!vistos.has(c.id)) {
      vistos.add(c.id);
      candidatas.push({ ...c, porBienvenida: true });
    }
  }

  let repartidos = 0;
  let revisados = 0;

  for (const conversacion of candidatas) {
    if (repartidos >= CUANTOS_POR_VUELTA) {
      break;
    }
    // Fuera de Colombia (seguimiento inteligente): no se le pasa a ninguna asesora.
    if (leerMarcaExterior(conversacion.contact?.metadata)) {
      continue;
    }
    revisados += 1;

    /*
      Que el cliente esté esperando de verdad: el último mensaje tiene que ser suyo.

      Las notas del sistema no cuentan como hablar —el agente deja una después de cada respuesta—,
      así que mirarlas haría creer que el último en hablar fuimos nosotros.
    */
    if (!conversacion.channelId) {
      continue;
    }
    if (conversacion.porBienvenida) {
      // Segundo caso: da igual quién habló último; basta que ya haya respondido la bienvenida.
      const mensajes = await prisma.message.findMany({
        where: { conversationId: conversacion.id, type: { not: "SYSTEM" }, deletedAt: null },
        orderBy: { createdAt: "asc" },
        take: MENSAJES_A_MIRAR,
        select: { direction: true, type: true, createdAt: true },
      });
      if (!respondioLaBienvenida(mensajes)) {
        continue;
      }
    } else {
      const ultimo = await prisma.message.findFirst({
        where: { conversationId: conversacion.id, type: { not: "SYSTEM" } },
        orderBy: { createdAt: "desc" },
        select: { direction: true },
      });
      if (!ultimo || ultimo.direction !== "INBOUND") {
        continue;
      }
    }

    try {
      /*
        Cuenta solo lo repartido de verdad: null = nadie en turno, o ya lo tomó alguien.

        La madrugada (Alex, 08-10-2026): de noche, sin nadie en línea, NO se reparte (ni al
        respaldo): queda marcado para la mañana. Si el cliente escribió de noche, se reparte como
        chat de madrugada (con tope de 7 a 8, ver en-linea-reglas.ts), no al respaldo a las 7:00.
      */
      const noche = ventanaDeMadrugada(ahora);
      const escribioDeNoche = Boolean(
        conversacion.lastMessageAt && conversacion.lastMessageAt >= noche.desde && conversacion.lastMessageAt < noche.hasta,
      );
      const elegida = await autoAssignConversationToCollaborator({
        conversationId: conversacion.id,
        channelId: conversacion.channelId,
        workspaceId: conversacion.workspaceId,
        ahora,
        ...(escribioDeNoche ? { deMadrugada: true } : {}),
      });
      if (elegida) {
        repartidos += 1;
      }
    } catch (error) {
      console.error("[rescate] no se pudo repartir el chat", {
        conversationId: conversacion.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { repartidos, revisados };
}
