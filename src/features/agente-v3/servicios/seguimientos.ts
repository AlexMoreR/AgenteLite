import { prisma } from "@/lib/prisma";
import { sendEvolutionTextMessageWithReconnect } from "@/lib/evolution";

import { guardarEstado, leerEstado } from "../motor/estado";
import { leerLibro } from "./almacen";

/**
 * EL RELOJ DE LOS SEGUIMIENTOS DEL V3.
 *
 * Las reglas "si no contesta a los 15 minutos" estaban escritas en el libro desde el primer día,
 * pero nunca salieron: el motor solo se despierta cuando el cliente escribe, y un cliente callado
 * justamente no escribe (Alex lo notó el 22-sep-2026, viendo un chat de hacía una hora y veinte).
 *
 * Esto es lo que faltaba: cada minuto mira las conversaciones donde el último que habló fuimos
 * nosotros y ya pasó el tiempo de alguna regla. Cuelga del cron que ya existe, para no montar otro.
 *
 * Tres cuidados, que son los que evitan que esto se convierta en spam:
 * 1. Cada regla sale UNA vez por silencio. Al volver a escribir el cliente, el contador se limpia.
 * 2. Si se acumuló atraso -la app estuvo caída, por ejemplo- sale SOLO el recordatorio más
 *    avanzado, no la ráfaga de todos los que vencieron.
 * 3. Nada sale de noche: a un cliente no se le escribe a las 3am, y a WhatsApp no le gusta.
 */

/** Franja en la que se permite escribir, hora de Bogotá. Fuera de esto, el reloj espera. */
const DESDE_LA_HORA = 7;
const HASTA_LA_HORA = 21;

/** Un chat en el que el cliente lleva días callado ya no es un seguimiento: es otra cosa. */
const VENTANA_MAXIMA_HORAS = 24;

const CUANTOS_POR_VUELTA = 40;

function horaDeBogota(ahora: Date): number {
  const texto = ahora.toLocaleString("en-US", { timeZone: "America/Bogota", hour: "2-digit", hour12: false });
  return Number.parseInt(texto, 10);
}

export async function ejecutarSeguimientosV3(ahora = new Date()): Promise<{ enviados: number; revisados: number }> {
  const hora = horaDeBogota(ahora);
  if (Number.isNaN(hora) || hora < DESDE_LA_HORA || hora >= HASTA_LA_HORA) {
    return { enviados: 0, revisados: 0 };
  }

  const canales = await prisma.whatsAppChannel.findMany({
    where: { metadata: { path: ["agenteV3"], equals: true } },
    select: { id: true, workspaceId: true, evolutionInstanceName: true },
  });

  let enviados = 0;
  let revisados = 0;

  for (const canal of canales) {
    if (!canal.evolutionInstanceName) {
      continue;
    }

    const libro = await leerLibro(canal.workspaceId);
    const reglas = libro.reglas
      .filter((regla) => regla.activa && regla.cuando.tipo === "sin_respuesta")
      .map((regla) => ({ regla, minutos: regla.cuando.tipo === "sin_respuesta" ? regla.cuando.minutos : 0 }))
      .filter((fila) => fila.minutos > 0)
      .sort((a, b) => b.minutos - a.minutos);

    if (reglas.length === 0) {
      continue;
    }

    const elMasCorto = reglas[reglas.length - 1].minutos;
    const conversaciones = await prisma.conversation.findMany({
      where: {
        channelId: canal.id,
        automationPaused: false,
        lastMessageAt: {
          lte: new Date(ahora.getTime() - elMasCorto * 60_000),
          gte: new Date(ahora.getTime() - VENTANA_MAXIMA_HORAS * 3_600_000),
        },
      },
      select: { id: true, lastMessageAt: true, contactId: true, contact: { select: { phoneNumber: true } } },
      orderBy: { lastMessageAt: "desc" },
      take: CUANTOS_POR_VUELTA,
    });

    for (const conversacion of conversaciones) {
      revisados += 1;
      const telefono = conversacion.contact?.phoneNumber?.trim();
      if (!telefono || !conversacion.lastMessageAt) {
        continue;
      }

      /*
        Solo se persigue a quien NO contestó. Si el último mensaje es del cliente, o es una nota del
        sistema, acá no hay nada que recordar -y si es del cliente y quedó sin responder, ese es
        otro problema, no este.
      */
      const ultimo = await prisma.message.findFirst({
        where: { conversationId: conversacion.id },
        orderBy: { createdAt: "desc" },
        select: { direction: true, type: true },
      });
      if (!ultimo || ultimo.direction !== "OUTBOUND" || ultimo.type === "SYSTEM") {
        continue;
      }

      const minutosCallado = Math.floor((ahora.getTime() - conversacion.lastMessageAt.getTime()) / 60_000);
      const estado = await leerEstado(conversacion.id);
      const yaSalieron = estado.seguimientosEnviados ?? [];

      // El más avanzado que venció y todavía no salió. Los otros se dan por vistos.
      const toca = reglas.find((fila) => fila.minutos <= minutosCallado && !yaSalieron.includes(fila.minutos));
      if (!toca) {
        continue;
      }

      const textos = toca.regla.entonces
        .filter((accion): accion is { tipo: "mensaje"; texto: string } => accion.tipo === "mensaje")
        .map((accion) => accion.texto.trim())
        .filter(Boolean);
      if (textos.length === 0) {
        continue;
      }

      try {
        for (const texto of textos) {
          const resultado = await sendEvolutionTextMessageWithReconnect({
            instanceName: canal.evolutionInstanceName,
            phoneNumber: telefono,
            text: texto,
          });

          await prisma.message.create({
            data: {
              workspaceId: canal.workspaceId,
              conversationId: conversacion.id,
              channelId: canal.id,
              contactId: conversacion.contactId,
              direction: "OUTBOUND",
              type: "TEXT",
              status: "SENT",
              content: texto,
              sentAt: new Date(),
              rawPayload: { source: "agente-v3-seguimiento", evolution: resultado } as never,
            },
          });
        }

        await prisma.message.create({
          data: {
            workspaceId: canal.workspaceId,
            conversationId: conversacion.id,
            channelId: canal.id,
            contactId: conversacion.contactId,
            direction: "OUTBOUND",
            type: "SYSTEM",
            status: "SENT",
            content: `Agente V3: seguimiento "${toca.regla.nombre}" (${toca.minutos} min sin respuesta)`,
            sentAt: new Date(),
          },
        });

        // Los vencidos quedan marcados aunque haya salido solo el último: no se persigue hacia atrás.
        const marcados = reglas.filter((fila) => fila.minutos <= minutosCallado).map((fila) => fila.minutos);
        await guardarEstado(conversacion.id, {
          ...estado,
          seguimientosEnviados: [...new Set([...yaSalieron, ...marcados])],
        });
        enviados += 1;
      } catch (error) {
        console.error("[agente-v3] no se pudo enviar el seguimiento", {
          conversationId: conversacion.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { enviados, revisados };
}
