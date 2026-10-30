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
 * El segundo caso (Alex, 30-10-2026): la clienta ya respondió la bienvenida y el chat de ventas
 * sigue sin asesora. Desde ese día se asigna apenas responde (reparto-por-turno.ts), pero esa
 * revisión corre cuando el bot YA contestó, así que si falla o no había nadie en turno, el último
 * mensaje queda siendo del bot y el primer caso nunca lo ve: el 29-10 quedaron 9 así. Por eso aquí
 * se mira todo el chat (`respondioLaBienvenida`), sin la espera de media hora y hasta 48 h atrás.
 *
 * No manda ningún mensaje al cliente: solo pone a alguien a cargo. Quien decide qué decirle es la
 * asesora que lo recibe.
 */

/** Cuánto se espera antes de rescatar. Menos que esto es no darle tiempo al agente a trabajar. */
const ESPERA_MINUTOS = 30;

/** Un chat de ayer no es un rescate: es otra conversación. */
const VENTANA_MAXIMA_HORAS = 12;

/** Hasta dónde se buscan chats de ventas que respondieron la bienvenida y quedaron sin asesora. */
const VENTANA_BIENVENIDA_HORAS = 48;

/** Cuántos chats de ventas sin asesora se revisan por vuelta en el segundo caso. */
const CANDIDATAS_BIENVENIDA = 200;

/** Cuántos mensajes (los primeros del chat) se leen: sobran para ver nuestro primer mensaje y una respuesta. */
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
  const [esperando, deBienvenida] = await Promise.all([
    // Caso 1: el último en hablar fue el cliente y lleva media hora esperando.
    prisma.conversation.findMany({
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
    }),
    // Caso 2: chat de ventas sin asesora en las últimas 48 h (si respondió la bienvenida se ve abajo).
    prisma.conversation.findMany({
      where: {
        assignedToUserId: null,
        status: { notIn: ["CLOSED", "ARCHIVED"] },
        channelId: { not: null },
        channel: { is: { purpose: "SALES" } },
        lastMessageAt: { gte: new Date(ahora.getTime() - VENTANA_BIENVENIDA_HORAS * 3_600_000) },
      },
      select: seleccion,
      orderBy: { lastMessageAt: "desc" },
      take: CANDIDATAS_BIENVENIDA,
    }),
  ]);

  // Los dos casos juntos, sin repetir chat. Primero los del caso 1, en el mismo orden de siempre.
  const idsDeBienvenida = new Set(deBienvenida.map((c) => c.id));
  const candidatas = new Map<string, { conversacion: (typeof esperando)[number]; esperando: boolean; deBienvenida: boolean }>();
  for (const conversacion of esperando) {
    candidatas.set(conversacion.id, { conversacion, esperando: true, deBienvenida: idsDeBienvenida.has(conversacion.id) });
  }
  for (const conversacion of deBienvenida) {
    if (!candidatas.has(conversacion.id)) {
      candidatas.set(conversacion.id, { conversacion, esperando: false, deBienvenida: true });
    }
  }

  let repartidos = 0;
  let revisados = 0;

  for (const candidata of candidatas.values()) {
    const { conversacion } = candidata;
    if (repartidos >= CUANTOS_POR_VUELTA) {
      break;
    }
    // Fuera de Colombia (seguimiento inteligente): no se le pasa a ninguna asesora.
    if (leerMarcaExterior(conversacion.contact?.metadata)) {
      continue;
    }
    if (!conversacion.channelId) {
      continue;
    }
    revisados += 1;

    // Caso 1 o caso 2 (ver la cabecera). El caso 2 solo se lee si el 1 no alcanzó.
    const toca =
      (candidata.esperando && (await ultimoEsDelCliente(conversacion.id))) ||
      (candidata.deBienvenida && (await yaRespondioLaBienvenida(conversacion.id)));
    if (!toca) {
      continue;
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

/*
  Caso 1: que el cliente esté esperando de verdad: el último mensaje tiene que ser suyo.

  Las notas del sistema no cuentan como hablar —el agente deja una después de cada respuesta—,
  así que mirarlas haría creer que el último en hablar fuimos nosotros.
*/
async function ultimoEsDelCliente(conversationId: string): Promise<boolean> {
  const ultimo = await prisma.message.findFirst({
    where: { conversationId, type: { not: "SYSTEM" } },
    orderBy: { createdAt: "desc" },
    select: { direction: true },
  });
  return ultimo?.direction === "INBOUND";
}

/*
  Caso 2: la clienta mandó algo DESPUÉS de nuestro primer mensaje, aunque el bot ya le haya vuelto
  a contestar. Misma lectura que el reparto por turno (reparto-por-turno.ts).
*/
async function yaRespondioLaBienvenida(conversationId: string): Promise<boolean> {
  const mensajes = await prisma.message.findMany({
    where: { conversationId, type: { not: "SYSTEM" }, deletedAt: null },
    orderBy: { createdAt: "asc" },
    take: MENSAJES_A_MIRAR,
    select: { direction: true, type: true, createdAt: true },
  });
  return respondioLaBienvenida(mensajes);
}
