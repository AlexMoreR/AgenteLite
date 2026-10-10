import { prisma } from "@/lib/prisma";
import { createFollow } from "@/features/seguimientos/services/follows";
import { dentroDelHorario } from "@/lib/anti-bloqueo/reglas";
import { leerConfigAntiBloqueo } from "@/lib/anti-bloqueo/servicio";
import { revisarFrenoDeAutomatico } from "@/lib/freno-de-automaticos";
import type { CrmStage } from "@/features/crm/types";

/**
 * CAMPAÑAS: elegir un grupo de leads hoy y mandarles un mensaje, una vez.
 *
 * Dos decisiones que sostienen todo lo de abajo:
 *
 * 1. NO se manda todo junto. WhatsApp bloquea numeros por mandar muchos mensajes parecidos a
 *    gente que hace rato no escribe, y el numero que se cae es el que da de comer. Por eso la
 *    campaña avanza de a tandas, con una espera entre cada una, y eso NO se puede desactivar.
 *
 * 2. El publico se congela al iniciar. Si se recalculara en cada tanda, un lead que cambia de
 *    etapa a mitad de camino podria recibir el mensaje dos veces —o no recibirlo nunca—, y en el
 *    medio hay un cliente real leyendo.
 *
 * El ENVIO no se reimplementa: cada destinatario se convierte en un Follow y lo manda el motor
 * de seguimientos, que ya resuelve el canal, el gateway, los reintentos y deja el mensaje escrito
 * en el chat. Un segundo camino de envio seria un segundo lugar donde se rompen los envios.
 *
 * 3. Solo a quien esta "vivo" con nosotros (Alex, 02-10-2026), por el mismo riesgo de bloqueo:
 *    - el publico es solo de contactos que nos ESCRIBIERON en los ultimos 30 dias;
 *    - y a cada uno, justo antes de mandarle, se le aplica el freno de automaticos: si no leyo
 *      nuestro ultimo mensaje, o ya lleva 2 automaticos seguidos sin contestar, no se le manda
 *      (ver lib/freno-de-automaticos). Queda anotado como frenado, con el motivo.
 */

/** Hasta cuanto atras tiene que haber escrito un contacto para entrar en una campaña. */
export const DIAS_DESDE_SU_ULTIMO_MENSAJE = 30;

/** Prefijo del error de un destinatario que no se mando por un freno (no es una falla). */
export const PREFIJO_FRENADO = "Frenado:";

const MOTIVO_DEL_FRENO: Record<string, string> = {
  no_leido: `${PREFIJO_FRENADO} no leyó nuestro último mensaje`,
  dos_sin_respuesta: `${PREFIJO_FRENADO} ya tiene 2 mensajes automáticos sin contestar`,
  sin_mensajes_recientes: `${PREFIJO_FRENADO} no nos escribe hace más de ${DIAS_DESDE_SU_ULTIMO_MENSAJE} días`,
};

function haceTreintaDias(ahora = new Date()) {
  return new Date(ahora.getTime() - DIAS_DESDE_SU_ULTIMO_MENSAJE * 86_400_000);
}

/**
 * La parte del publico que no depende de la etapa: sin ocultos, con telefono y que nos haya
 * escrito hace poco. La usa tambien la pantalla para el conteo por etapa, y asi el numero que se
 * ve antes de crear la campaña es el mismo que despues se congela.
 */
export function publicoBaseDeCampana(workspaceId: string, ahora = new Date()) {
  return {
    workspaceId,
    excludedFromCrm: false,
    // Sin telefono no hay a quien mandarle: se excluye del conteo para que el numero que se ve
    // antes de disparar sea el numero real de mensajes que van a salir.
    phoneNumber: { not: "" },
    messages: { some: { direction: "INBOUND" as const, createdAt: { gte: haceTreintaDias(ahora) } } },
  };
}

export type CampaignAudienceFilter = {
  /** Por ahora la unica condicion: la etapa del CRM. */
  crmStage?: string | null;
};

function buildAudienceWhere(workspaceId: string, filtro: CampaignAudienceFilter) {
  return {
    ...publicoBaseDeCampana(workspaceId),
    ...(filtro.crmStage ? { crmStage: filtro.crmStage as CrmStage } : {}),
  };
}

/**
 * ¿Le puede salir la campaña a este contacto AHORA?
 *
 * Se vuelve a mirar en cada tanda, no solo al congelar el publico: una campaña dura dias, y en el
 * medio alguien pudo dejar de escribir hace 30 dias o dejar sin leer lo ultimo que le mandamos.
 */
async function motivoParaNoMandar(input: {
  contactId: string;
  channelId: string | null;
  ahora: Date;
}): Promise<string | null> {
  const reciente = await prisma.message.findFirst({
    where: { contactId: input.contactId, direction: "INBOUND", createdAt: { gte: haceTreintaDias(input.ahora) } },
    select: { id: true },
  });
  if (!reciente) {
    return MOTIVO_DEL_FRENO.sin_mensajes_recientes;
  }
  const freno = await revisarFrenoDeAutomatico({ contactId: input.contactId, channelId: input.channelId });
  return freno.enviar ? null : MOTIVO_DEL_FRENO[freno.motivo];
}

/** Cuantos leads caen en la condicion, para poder verlo ANTES de mandar nada. */
export async function contarPublico(input: {
  workspaceId: string;
  filtro: CampaignAudienceFilter;
}): Promise<number> {
  return prisma.contact.count({ where: buildAudienceWhere(input.workspaceId, input.filtro) });
}

/**
 * Congela el publico y pone la campaña a andar.
 *
 * La primera tanda NO sale aca: sale en el cron. Asi el boton "Iniciar" nunca dispara mensajes en
 * el mismo click —da tiempo a pausar si uno se arrepiende— y el ritmo lo marca un solo lugar.
 */
export async function iniciarCampana(input: {
  workspaceId: string;
  campaignId: string;
}): Promise<{ ok: boolean; total: number; error?: string }> {
  const campana = await prisma.campaign.findFirst({
    where: { id: input.campaignId, workspaceId: input.workspaceId },
    select: { id: true, status: true, crmStage: true, content: true },
  });

  if (!campana) {
    return { ok: false, total: 0, error: "La campaña no existe" };
  }
  if (campana.status === "RUNNING") {
    return { ok: false, total: 0, error: "La campaña ya está andando" };
  }
  if (!campana.content?.trim()) {
    return { ok: false, total: 0, error: "La campaña no tiene mensaje" };
  }

  // Reanudar una campaña pausada no vuelve a armar el publico: los que ya recibieron no tienen
  // que recibir de nuevo.
  if (campana.status === "PAUSED") {
    await prisma.campaign.update({
      where: { id: campana.id },
      data: { status: "RUNNING" },
    });
    const total = await prisma.campaignRecipient.count({ where: { campaignId: campana.id } });
    return { ok: true, total };
  }

  const leads = await prisma.contact.findMany({
    where: buildAudienceWhere(input.workspaceId, { crmStage: campana.crmStage }),
    select: { id: true },
  });

  if (leads.length === 0) {
    return { ok: false, total: 0, error: "No hay leads que cumplan la condición" };
  }

  await prisma.campaignRecipient.createMany({
    data: leads.map((lead) => ({ campaignId: campana.id, contactId: lead.id })),
    skipDuplicates: true,
  });

  await prisma.campaign.update({
    where: { id: campana.id },
    data: {
      status: "RUNNING",
      totalRecipients: leads.length,
      startedAt: new Date(),
      finishedAt: null,
    },
  });

  console.log("[campanas] iniciada", { campaignId: campana.id, total: leads.length });
  return { ok: true, total: leads.length };
}

export async function pausarCampana(input: { workspaceId: string; campaignId: string }) {
  await prisma.campaign.updateMany({
    where: { id: input.campaignId, workspaceId: input.workspaceId, status: "RUNNING" },
    data: { status: "PAUSED" },
  });
}

/**
 * Manda la siguiente tanda de cada campaña que ya cumplio su espera.
 *
 * Corre desde el cron. Una tanda por campaña y por corrida: si una campaña se atrasa, no se
 * "pone al dia" mandando varias tandas juntas, que es exactamente lo que dispara un bloqueo.
 */
export async function procesarTandasDeCampanas(): Promise<{ enviados: number; frenados: number }> {
  const ahora = new Date();
  const campanas = await prisma.campaign.findMany({
    where: { status: "RUNNING" },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      channelId: true,
      messageType: true,
      content: true,
      mediaUrl: true,
      batchSize: true,
      intervalMinutes: true,
      lastBatchAt: true,
      sentCount: true,
    },
  });

  let enviados = 0;
  let frenados = 0;

  for (const campana of campanas) {
    try {
      const esperaMs = Math.max(1, campana.intervalMinutes) * 60_000;
      if (campana.lastBatchAt && ahora.getTime() - campana.lastBatchAt.getTime() < esperaMs) {
        continue;
      }

      /*
        Anti-bloqueo, horario (apagado por defecto): fuera del horario la tanda no se arma. Los
        destinatarios siguen PENDIENTES y salen en la primera vuelta dentro del horario; no se
        pierde ninguno. El espaciado entre mensajes lo pone el motor de seguimientos.
      */
      const antiBloqueo = await leerConfigAntiBloqueo(campana.workspaceId);
      if (antiBloqueo.horario.activo && !dentroDelHorario(ahora, antiBloqueo.horario)) {
        continue;
      }

      const tanda = await prisma.campaignRecipient.findMany({
        where: { campaignId: campana.id, status: "PENDING" },
        select: { id: true, contactId: true },
        take: Math.max(1, campana.batchSize),
        orderBy: { createdAt: "asc" },
      });

      if (tanda.length === 0) {
        await prisma.campaign.update({
          where: { id: campana.id },
          data: { status: "DONE", finishedAt: ahora },
        });
        console.log("[campanas] terminada", { campaignId: campana.id, enviados: campana.sentCount });
        continue;
      }

      let enviadosEnLaTanda = 0;
      let frenadosEnLaTanda = 0;
      for (const destinatario of tanda) {
        try {
          const motivo = await motivoParaNoMandar({
            contactId: destinatario.contactId,
            channelId: campana.channelId,
            ahora,
          });
          if (motivo) {
            // No es una falla: se decidio no mandarle. Queda en FAILED con el motivo porque el
            // estado no tiene un valor propio y agregarlo pediria migrar; PREFIJO_FRENADO lo separa.
            await prisma.campaignRecipient.update({
              where: { id: destinatario.id },
              data: { status: "FAILED", error: motivo },
            });
            frenadosEnLaTanda += 1;
            continue;
          }

          const follow = await createFollow({
            workspaceId: campana.workspaceId,
            contactId: destinatario.contactId,
            name: `Campaña: ${campana.name}`,
            channelId: campana.channelId,
            timeType: "MINUTES",
            timeValue: 1,
            messageType: campana.messageType,
            content: campana.content,
            mediaUrl: campana.mediaUrl,
            // Sale igual aunque el cliente escriba entremedio: la campaña es un mensaje que
            // alguien decidio mandar, no una reaccion al silencio. Cancelarlo por actividad
            // dejaria la campaña incompleta sin que nadie se entere.
            cancelOnActivity: false,
            executeAt: ahora,
          });

          await prisma.campaignRecipient.update({
            where: { id: destinatario.id },
            data: {
              status: follow ? "SENT" : "FAILED",
              followId: follow?.id ?? null,
              sentAt: follow ? ahora : null,
              error: follow ? null : "No se pudo agendar el envío",
            },
          });

          if (follow) {
            enviadosEnLaTanda += 1;
          }
        } catch (error) {
          await prisma.campaignRecipient
            .update({
              where: { id: destinatario.id },
              data: {
                status: "FAILED",
                error: error instanceof Error ? error.message.slice(0, 300) : "Error desconocido",
              },
            })
            .catch(() => {});
        }
      }

      await prisma.campaign.update({
        where: { id: campana.id },
        data: {
          lastBatchAt: ahora,
          sentCount: { increment: enviadosEnLaTanda },
        },
      });

      enviados += enviadosEnLaTanda;
      frenados += frenadosEnLaTanda;
      console.log("[campanas] tanda", {
        campaignId: campana.id,
        enviados: enviadosEnLaTanda,
        frenados: frenadosEnLaTanda,
        pedidos: tanda.length,
      });
    } catch (error) {
      console.error("[campanas] error procesando", campana.id, error);
    }
  }

  return { enviados, frenados };
}
