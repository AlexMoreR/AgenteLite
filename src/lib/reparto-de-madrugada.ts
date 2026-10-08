import { madrugadaConTope, respaldoAtiende, ventanaDeMadrugada, PAUSA_SOLA_SIN_ABRIR_MS } from "@/lib/en-linea-reglas";
import { prisma } from "@/lib/prisma";
import { autoAssignConversationToCollaborator, chatsDeMadrugadaPendientes } from "@/lib/reparto-de-leads";

/**
 * EL REPARTO DE LA MAÑANA (Alex, 08-10-2026): los chats que llegaron de noche sin nadie en línea.
 *
 * Corre en el reloj de cada minuto (cron/follows), solo dentro de la franja del respaldo. Desde
 * las 7:00 los reparte a las que estén en línea, más antiguos primero, con tope de 3 por asesora
 * mientras se conectan las demás; desde las 8:00, lo que quede va por la rueda normal o al
 * respaldo. Las reglas están en en-linea-reglas.ts (decidirReparto).
 *
 * Carga: una consulta chica por negocio (PresenciaEnLinea) y las notas de la noche por índice
 * (workspaceId, createdAt). Cuando un negocio ya no tiene nada pendiente de esa noche, no se vuelve
 * a mirar hasta la noche siguiente (después de las 7:00 no aparecen chats nuevos de esa noche).
 */

const CUANTOS_POR_VUELTA = 15;
const nochesTerminadas = new Set<string>();

export async function repartirChatsDeMadrugada(ahora = new Date()): Promise<{ repartidos: number; pendientes: number }> {
  if (!respaldoAtiende(ahora)) {
    return { repartidos: 0, pendientes: 0 };
  }
  const ventana = ventanaDeMadrugada(ahora);
  const noche = ventana.desde.toISOString();
  const negocios = await prisma.presenciaEnLinea.findMany({ distinct: ["workspaceId"], select: { workspaceId: true } });

  let repartidos = 0;
  let pendientes = 0;
  for (const { workspaceId } of negocios) {
    const clave = `${workspaceId}:${noche}`;
    if (nochesTerminadas.has(clave)) {
      continue;
    }
    // Entre las 7 y las 8 sin nadie en línea no hay a quién darle nada: ni se buscan los chats.
    if (madrugadaConTope(ahora)) {
      const enLinea = await prisma.presenciaEnLinea.count({
        where: {
          workspaceId,
          enLineaDesde: { not: null },
          ultimoLatido: { gte: new Date(ahora.getTime() - PAUSA_SOLA_SIN_ABRIR_MS) },
        },
      });
      if (enLinea === 0) {
        continue;
      }
    }

    const chats = await chatsDeMadrugadaPendientes(workspaceId, ventana);
    if (chats.length === 0) {
      nochesTerminadas.add(clave);
      if (nochesTerminadas.size > 200) {
        nochesTerminadas.clear();
        nochesTerminadas.add(clave);
      }
      continue;
    }

    for (const chat of chats) {
      if (repartidos >= CUANTOS_POR_VUELTA) {
        break;
      }
      try {
        const elegida = await autoAssignConversationToCollaborator({
          conversationId: chat.id,
          channelId: chat.channelId,
          workspaceId,
          deMadrugada: true,
          ahora,
        });
        if (elegida) {
          repartidos += 1;
        } else {
          pendientes += 1;
          // Entre las 7 y las 8, si el más antiguo no tuvo a quién (todas en el tope), los
          // siguientes tampoco: se espera a la próxima vuelta sin gastar consultas.
          if (madrugadaConTope(ahora)) {
            break;
          }
        }
      } catch (error) {
        console.error("[reparto-de-madrugada] no se pudo repartir el chat", {
          conversationId: chat.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return { repartidos, pendientes };
}
