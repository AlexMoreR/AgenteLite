import { leerMarcaExterior } from "@/features/seguimiento-inteligente/dominio/exterior";
import { prisma } from "@/lib/prisma";

import { avisarAsesorPorWhatsApp } from "./avisos";

/**
 * UN CLIENTE LLEVA RATO ESPERANDO Y NADIE LE CONTESTÓ: se le avisa a una asesora.
 *
 * Esto es lo que quedó de los "seguimientos inteligentes". Aquella versión, además de avisar,
 * le escribía al cliente un texto redactado por la IA a los 15 minutos, 1 hora, 1 día y 3 días.
 * Alex la quitó el 28-09-2026: lo que servía era el aviso, no que el agente insistiera solo.
 *
 * Acá el agente NO le escribe nada al cliente. Solo levanta la mano.
 *
 * Cuándo avisa: el último mensaje del chat es del CLIENTE, pasaron 15 minutos y nadie —ni el
 * agente ni una asesora— le respondió. Si el chat no tiene dueño, el aviso lo reparte primero
 * (eso lo hace `avisarAsesorPorWhatsApp`) y después avisa a quien le tocó.
 */

/** Cuánto se espera antes de levantar la mano. */
const MINUTOS_DE_ESPERA = 15;

/**
 * Hasta dónde se mira hacia atrás.
 *
 * Un cliente que preguntó hace tres días y nadie contestó no se arregla despertándole el teléfono
 * a la asesora: eso es un lead frío y para eso está el tablero. El aviso sirve mientras todavía
 * se pueda contestar a tiempo.
 */
const AVISO_HASTA_MINUTOS = 3 * 60;

/** Por vuelta. Si hay atraso se drena de a poco en vez de vaciar la cola de golpe. */
const CUANTOS_POR_VUELTA = 5;

const CLAVE = "agente-v3:esperando:";

/**
 * Desde cuándo trabaja esto.
 *
 * Sin la marca, la primera vuelta saldría a avisar por todos los chats que quedaron esperando en
 * las últimas horas, de golpe y todos juntos. Se guarda la hora del primer arranque y solo se
 * miran los silencios que empezaron después.
 */
const CLAVE_ARRANQUE = "agente-v3:esperando:arranque";

async function desdeCuandoTrabaja(ahora: Date): Promise<Date> {
  const fila = await prisma.appSetting.findUnique({ where: { key: CLAVE_ARRANQUE } });
  const guardado = fila?.value ? Date.parse(fila.value) : Number.NaN;
  if (Number.isFinite(guardado)) {
    return new Date(guardado);
  }
  const valor = ahora.toISOString();
  await prisma.appSetting
    .upsert({ where: { key: CLAVE_ARRANQUE }, create: { key: CLAVE_ARRANQUE, value: valor }, update: { value: valor } })
    .catch(() => {});
  return ahora;
}

/**
 * Un aviso por espera, no uno por vuelta del reloj.
 *
 * La marca se ata a la hora del mensaje del cliente: si vuelve a escribir es otra espera y se
 * puede avisar de nuevo, pero mientras sea la misma no se insiste. Se guarda aparte del estado
 * del agente porque el motor reescribe ese estado al terminar el turno y pisaría la marca.
 */
async function yaSeAviso(conversationId: string, desde: string): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE}${conversationId}` } });
  return fila?.value === desde;
}

async function marcarAvisado(conversationId: string, desde: string): Promise<void> {
  const key = `${CLAVE}${conversationId}`;
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: desde }, update: { value: desde } });
}

export async function avisarClientesEsperando(ahora = new Date()): Promise<{ avisados: number; revisados: number }> {
  const canales = await prisma.whatsAppChannel.findMany({
    where: { metadata: { path: ["agenteV3"], equals: true } },
    select: { id: true, workspaceId: true },
  });

  let avisados = 0;
  let revisados = 0;

  const arranque = await desdeCuandoTrabaja(ahora);

  for (const canal of canales) {
    const conversaciones = await prisma.conversation.findMany({
      where: {
        channelId: canal.id,
        // Un chat resuelto o archivado no está esperando nada.
        status: "OPEN",
        lastMessageAt: {
          lte: new Date(ahora.getTime() - MINUTOS_DE_ESPERA * 60_000),
          gte: new Date(ahora.getTime() - AVISO_HASTA_MINUTOS * 60_000),
        },
      },
      select: {
        id: true,
        contactId: true,
        contact: { select: { phoneNumber: true, name: true, crmStage: true, metadata: true } },
      },
      orderBy: { lastMessageAt: "desc" },
      take: CUANTOS_POR_VUELTA * 4,
    });

    for (const conversacion of conversaciones) {
      if (avisados >= CUANTOS_POR_VUELTA) {
        break;
      }

      const telefono = conversacion.contact?.phoneNumber?.trim();
      if (!telefono) {
        continue;
      }
      // Fuera de Colombia (seguimiento inteligente): no se le avisa a ninguna asesora.
      if (leerMarcaExterior(conversacion.contact?.metadata)) {
        continue;
      }

      const etapa = conversacion.contact?.crmStage;
      if (etapa === "GANADO" || etapa === "PERDIDO") {
        continue;
      }

      revisados += 1;

      /*
        Las notas del sistema no cuentan como hablar: el V3 deja una después de cada respuesta, y
        si contaran, el último mensaje del chat sería casi siempre una nota nuestra.
      */
      const ultimo = await prisma.message.findFirst({
        where: { conversationId: conversacion.id, type: { not: "SYSTEM" } },
        orderBy: { createdAt: "desc" },
        select: { direction: true, createdAt: true },
      });

      // Si el último en hablar fuimos nosotros, el cliente no está esperando: está pensando.
      if (!ultimo || ultimo.direction !== "INBOUND") {
        continue;
      }

      if (ultimo.createdAt < arranque) {
        continue;
      }

      const minutosEsperando = Math.floor((ahora.getTime() - ultimo.createdAt.getTime()) / 60_000);
      if (minutosEsperando < MINUTOS_DE_ESPERA || minutosEsperando > AVISO_HASTA_MINUTOS) {
        continue;
      }

      const desde = ultimo.createdAt.toISOString();
      if (await yaSeAviso(conversacion.id, desde)) {
        continue;
      }

      const cuantos = await avisarAsesorPorWhatsApp({
        workspaceId: canal.workspaceId,
        conversationId: conversacion.id,
        motivo: `El cliente escribió hace ${minutosEsperando} minutos y nadie le ha respondido`,
        cliente: conversacion.contact?.name?.trim() || telefono,
        telefonoDelCliente: telefono,
      });

      // Se marca aunque no haya salido: si no hay a quién avisar, insistir cada vuelta no ayuda.
      await marcarAvisado(conversacion.id, desde);
      if (cuantos > 0) {
        avisados += 1;
        console.log("[agente-v3] cliente esperando, asesora avisada", {
          conversationId: conversacion.id,
          minutosEsperando,
        });
      }
    }
  }

  return { avisados, revisados };
}
