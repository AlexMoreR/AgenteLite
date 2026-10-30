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
 * Segundo caso (Alex, 30-10-2026): el cliente que respondió la bienvenida y quedó sin asesora aunque
 * el último mensaje del chat sea nuestro. El reparto corre en `after()` del webhook, cuando el bot
 * ya contestó; si ese reparto falló o se saltó, el último mensaje es la respuesta del bot y el caso
 * de arriba nunca lo ve (el 29-10 quedaron 9 así). Por eso aquí se mira el chat entero: sin asesora,
 * línea de ventas, movimiento en las últimas 48 h y `respondioLaBienvenida` (cualquier mensaje del
 * cliente después del primero nuestro, incluso "ok"). Sin la espera de 30 minutos: el bot ya habló.
 *
 * No manda ningún mensaje al cliente: solo pone a alguien a cargo. Quien decide qué decirle es la
 * asesora que lo recibe.
 */

/** Cuánto se espera antes de rescatar. Menos que esto es no darle tiempo al agente a trabajar. */
const ESPERA_MINUTOS = 30;

/** Un chat de ayer no es un rescate: es otra conversación. */
const VENTANA_MAXIMA_HORAS = 12;

/** Segundo caso: cuánto atrás se buscan clientes que respondieron la bienvenida y siguen sin asesora. */
const VENTANA_BIENVENIDA_HORAS = 48;

/** Cuántos mensajes se leen por chat para saber si respondió la bienvenida (los primeros bastan). */
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

  const candidatasDeHoy = await prisma.conversation.findMany({
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

  // Segundo caso: línea de ventas, sin espera, hasta 48 h atrás (se confirma con los mensajes abajo).
  const candidatasDeBienvenida = await prisma.conversation.findMany({
    where: {
      assignedToUserId: null,
      status: { notIn: ["CLOSED", "ARCHIVED"] },
      channelId: { not: null },
      channel: { is: { purpose: "SALES" } },
      lastMessageAt: { gte: new Date(ahora.getTime() - VENTANA_BIENVENIDA_HORAS * 3_600_000) },
    },
    select: seleccion,
    orderBy: { lastMessageAt: "desc" },
    take: CUANTOS_POR_VUELTA * 3,
  });

  // Los dos casos juntos, sin repetir id; el caso de hoy va primero.
  const porId = new Map<string, (typeof candidatasDeHoy)[number]>();
  for (const conversacion of [...candidatasDeHoy, ...candidatasDeBienvenida]) {
    if (!porId.has(conversacion.id)) {
      porId.set(conversacion.id, conversacion);
    }
  }
  const idsDeHoy = new Set(candidatasDeHoy.map((conversacion) => conversacion.id));
  const idsDeBienvenida = new Set(candidatasDeBienvenida.map((conversacion) => conversacion.id));
  const candidatas = [...porId.values()];

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
    const ultimo = await prisma.message.findFirst({
      where: { conversationId: conversacion.id, type: { not: "SYSTEM" } },
      orderBy: { createdAt: "desc" },
      select: { direction: true },
    });
    if (!conversacion.channelId) {
      continue;
    }
    const esperaDeHoy = idsDeHoy.has(conversacion.id) && ultimo?.direction === "INBOUND";
    if (!esperaDeHoy) {
      // El segundo caso es solo de líneas de ventas: los demás candidatos no entran por aquí.
      if (!idsDeBienvenida.has(conversacion.id)) {
        continue;
      }
      // Segundo caso: el último fue nuestro, pero ¿el cliente ya había respondido la bienvenida?
      const mensajes = await prisma.message.findMany({
        where: { conversationId: conversacion.id, type: { not: "SYSTEM" }, deletedAt: null },
        orderBy: { createdAt: "asc" },
        take: MENSAJES_A_MIRAR,
        select: { direction: true, type: true, createdAt: true },
      });
      if (!respondioLaBienvenida(mensajes)) {
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
