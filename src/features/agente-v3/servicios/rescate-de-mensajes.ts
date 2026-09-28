import { prisma } from "@/lib/prisma";

import { leerUltimaDecision } from "./decisiones";
import { retomarConversacionV3 } from "./retomar";

/**
 * EL MENSAJE QUE NADIE MIRÓ: se lo vuelve a pasar al motor.
 *
 * Nació de un caso medido (28-09-2026): una clienta escribió a las 14:38:50 y el agente nunca le
 * contestó. No fue el agente —a las 14:29 respondía en 14 segundos—: el contenedor se estaba
 * reemplazando por un despliegue y arrancó a las 14:38:30. El aviso de WhatsApp le llegó al
 * contenedor viejo, que alcanzó a guardar el mensaje y lo mataron durante los 10 segundos que el
 * motor espera para juntar los mensajes seguidos. WhatsApp no reintenta: ese lead se perdió.
 *
 * Esto es la red. Cada vuelta busca conversaciones donde el cliente escribió y el motor NUNCA
 * decidió nada, y le vuelve a pasar el mensaje.
 *
 * Las cuatro condiciones son de Alex, y ninguna es decorativa:
 *
 * 1. Solo si el motor no registró NINGUNA decisión sobre ese mensaje. Si decidió —aunque haya
 *    decidido no responder— no se toca. Sin la huella que dejó `decisiones.ts` esto no se podría
 *    distinguir, y el rescate terminaría contestando cosas que el agente ya había resuelto callar.
 * 2. No manda nada si el chat ya tiene asesora o si la IA está pausada ahí. Es el mismo principio
 *    de siempre: el agente no le escribe por encima a una persona.
 * 3. Queda nota en el chat de cada mensaje rescatado, para poder auditarlo después.
 * 4. Detrás de una bandera que se apaga desde la pantalla del Agente V3.
 */

/**
 * Cuánto se espera antes de dar por perdido un mensaje.
 *
 * El motor junta los mensajes que llegan seguidos y espera 10 segundos antes de contestar, así que
 * antes de eso "sin decisión" es lo normal, no una falla. Tres minutos dejan margen de sobra sin
 * que el cliente se quede esperando.
 */
const ESPERA_MINUTOS = 3;

/**
 * Hasta dónde se mira hacia atrás.
 *
 * Pasada la media hora ya no es un rescate: el aviso de los 15 minutos ya le puso una asesora
 * encima, y contestarle a alguien media hora después como si nada es peor que no contestar.
 */
const VENTANA_MAXIMA_MINUTOS = 30;

/** Por vuelta. Si algo sale mal, que salga mal de a poco. */
const CUANTOS_POR_VUELTA = 3;

const CLAVE_BANDERA = "agente-v3:rescate:";

/**
 * Un intento por mensaje, pase lo que pase.
 *
 * La huella de la decision solo la escribe el motor, y al motor se puede no llegar: si
 * `retomarConversacionV3` corta antes -la linea no usa V3, el chat no tiene telefono, el ultimo
 * mensaje quedo sin texto- no queda huella, la condicion 1 vuelve a dar verdadero y esto lo
 * reintentaria cada 60 segundos durante media hora, dejando treinta notas en el chat.
 *
 * Se guarda la hora del mensaje que se intento: si el cliente escribe otro, es otro intento.
 */
const CLAVE_INTENTO = "agente-v3:rescate-intentado:";

/** Encendido salvo que se apague a mano. La bandera existe para poder frenarlo sin desplegar. */
export async function rescateEncendido(workspaceId: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE_BANDERA}${workspaceId}` } });
  return fila?.value !== "off";
}

export async function guardarBanderaDeRescate(workspaceId: string, encendido: boolean): Promise<void> {
  const key = `${CLAVE_BANDERA}${workspaceId}`;
  const value = encendido ? "on" : "off";
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function rescatarMensajesSinDecidir(
  ahora = new Date(),
): Promise<{ rescatados: number; revisados: number }> {
  const canales = await prisma.whatsAppChannel.findMany({
    where: { metadata: { path: ["agenteV3"], equals: true } },
    select: { id: true, workspaceId: true },
  });

  let rescatados = 0;
  let revisados = 0;

  // Se pregunta una vez por workspace y no por conversación: son dos o tres canales, no mil.
  const banderaPorWorkspace = new Map<string, boolean>();

  for (const canal of canales) {
    if (!banderaPorWorkspace.has(canal.workspaceId)) {
      banderaPorWorkspace.set(canal.workspaceId, await rescateEncendido(canal.workspaceId));
    }
    if (!banderaPorWorkspace.get(canal.workspaceId)) {
      continue;
    }

    const conversaciones = await prisma.conversation.findMany({
      where: {
        channelId: canal.id,
        // Condición 2, la mitad que se puede preguntar en la consulta.
        automationPaused: false,
        assignedToUserId: null,
        status: "OPEN",
        lastMessageAt: {
          lte: new Date(ahora.getTime() - ESPERA_MINUTOS * 60_000),
          gte: new Date(ahora.getTime() - VENTANA_MAXIMA_MINUTOS * 60_000),
        },
      },
      select: { id: true },
      orderBy: { lastMessageAt: "desc" },
      take: CUANTOS_POR_VUELTA * 5,
    });

    for (const conversacion of conversaciones) {
      if (rescatados >= CUANTOS_POR_VUELTA) {
        break;
      }
      revisados += 1;

      /*
        El último que habló tiene que ser el CLIENTE.

        Las notas del sistema no cuentan: el V3 deja una después de cada respuesta, y mirarlas
        haría creer que el último en hablar fuimos nosotros.
      */
      const ultimo = await prisma.message.findFirst({
        where: { conversationId: conversacion.id, type: { not: "SYSTEM" } },
        orderBy: { createdAt: "desc" },
        select: { id: true, direction: true, createdAt: true },
      });
      if (!ultimo || ultimo.direction !== "INBOUND") {
        continue;
      }

      /*
        CONDICIÓN 1: solo lo que el motor nunca miró.

        La huella guarda el momento en que empezó cada vuelta. Si esa hora es POSTERIOR al mensaje,
        el motor ya lo tuvo delante y decidió —aunque haya decidido callarse—, y entonces no se
        toca. Solo se rescata lo que quedó de este lado: sin huella, o con una huella anterior al
        mensaje, que es lo que pasa cuando el proceso se muere antes de decidir.
      */
      const decision = await leerUltimaDecision(conversacion.id);
      if (decision && Date.parse(decision.cuando) >= ultimo.createdAt.getTime()) {
        continue;
      }

      // Ya se intento con ESTE mensaje: no se insiste (ver CLAVE_INTENTO).
      const claveDelIntento = `${CLAVE_INTENTO}${conversacion.id}`;
      const intento = await prisma.appSetting.findUnique({ where: { key: claveDelIntento } });
      if (intento?.value === ultimo.createdAt.toISOString()) {
        continue;
      }
      await prisma.appSetting
        .upsert({
          where: { key: claveDelIntento },
          create: { key: claveDelIntento, value: ultimo.createdAt.toISOString() },
          update: { value: ultimo.createdAt.toISOString() },
        })
        .catch(() => {});

      const resultado = await retomarConversacionV3({ conversationId: conversacion.id, workspaceId: canal.workspaceId }).catch((error) => {
        console.error("[rescate-v3] no se pudo retomar", {
          conversationId: conversacion.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });

      /*
        CONDICIÓN 3: queda registro, haya contestado o no.

        También cuando NO contesta: saber que el rescate lo miró y decidió callarse es la mitad de
        lo que sirve para auditarlo. La nota es de sistema, así que vive en el chat y no le llega
        a nadie.

        `retomarConversacionV3` ya deja su propia nota cuando responde; esta dice por qué se
        volvió a mirar, que es lo que no se podría reconstruir después.
      */
      const minutos = Math.floor((ahora.getTime() - ultimo.createdAt.getTime()) / 60_000);
      console.log("[rescate-v3] mensaje sin decidir", {
        conversationId: conversacion.id,
        messageId: ultimo.id,
        minutosSinRespuesta: minutos,
        atendido: resultado?.atendido ?? false,
        motivo: resultado?.motivo ?? null,
      });

      await prisma.message
        .create({
          data: {
            workspaceId: canal.workspaceId,
            conversationId: conversacion.id,
            channelId: canal.id,
            direction: "OUTBOUND",
            type: "SYSTEM",
            status: "SENT",
            content: resultado?.atendido
              ? `Agente V3: se rescató un mensaje que quedó sin respuesta ${minutos} min (el agente nunca lo llegó a mirar).`
              : `Agente V3: se revisó un mensaje sin respuesta de ${minutos} min y no hubo nada que contestar.`,
            rawPayload: { source: "activity", kind: "note", actorUserId: null, rescate: true } as never,
          },
        })
        .catch(() => {});

      if (resultado?.atendido) {
        rescatados += 1;
      }
    }
  }

  return { rescatados, revisados };
}
