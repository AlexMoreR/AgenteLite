import { prisma } from "@/lib/prisma";
import { createFollow } from "@/features/seguimientos/services/follows";
import { PRODUCT_FUNNEL_STAGES } from "@/lib/product-funnel-stages";

/**
 * EL SEGUIMIENTO DE LA ETAPA: "si no contesta, escribile esto a los N dias".
 *
 * Se agenda cuando el lead ENTRA a una etapa del embudo del producto, con el mensaje que alguien
 * escribio para esa etapa en el Playbook. La diferencia con una regla suelta del modulo
 * Seguimientos es cual mensaje sale: no es lo mismo que el cliente se calle en la presentacion
 * —ni sabemos que quiere— que en el cierre, donde ya sabe el precio y lo esta pensando.
 *
 * No manda nada por su cuenta: crea un Follow y lo envia el motor que ya existe
 * (executePendingFollows, en el cron). Asi hereda gratis el envio, el bloqueo por si dos procesos
 * lo agarran a la vez, y sobre todo la CANCELACION: el webhook ya llama a
 * cancelPendingFollowsByContact en cada mensaje entrante, o sea que si el cliente contesta antes,
 * el seguimiento no sale. Ese es todo el sentido de "si no contesta".
 */

const ETIQUETA_POR_ETAPA = new Map(
  PRODUCT_FUNNEL_STAGES.map((etapa) => [etapa.stage as string, etapa.label]),
);

export async function agendarSeguimientoDeEtapa(input: {
  workspaceId: string;
  contactId: string;
  productId: string;
  stage: string;
  channelId: string | null;
}): Promise<{ agendado: boolean; dias?: number }> {
  try {
    const etapa = await prisma.productFunnelStage.findFirst({
      where: {
        stage: input.stage,
        playbook: { workspaceId: input.workspaceId, productId: input.productId },
      },
      select: { followUpDays: true, followUpMessage: true, playbook: { select: { productId: true } } },
    });

    const dias = etapa?.followUpDays ?? null;
    const mensaje = etapa?.followUpMessage?.trim() || "";
    if (!dias || !mensaje) {
      return { agendado: false };
    }

    /**
     * Un solo seguimiento pendiente por lead.
     *
     * Sin esto se apilarian: el lead avanza de etapa, se agenda el de la etapa nueva y el de la
     * anterior sigue vivo, asi que el cliente recibiria dos mensajes distintos por el mismo
     * silencio. En la practica casi nunca hay uno pendiente en este punto —la etapa solo cambia
     * cuando el cliente escribe, y al escribir el webhook ya cancelo lo pendiente— pero el
     * candado tiene que estar igual: el dia que eso cambie, el que recibe los mensajes de mas es
     * un cliente.
     */
    const pendiente = await prisma.follow.findFirst({
      where: { workspaceId: input.workspaceId, contactId: input.contactId, status: "PENDING" },
      select: { id: true },
    });
    if (pendiente) {
      return { agendado: false };
    }

    const etiqueta = ETIQUETA_POR_ETAPA.get(input.stage) ?? input.stage;
    const creado = await createFollow({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      // Sin followRuleId: este seguimiento no nace de una regla del modulo Seguimientos sino del
      // Playbook del producto. La columna acepta null justamente para esto.
      name: `Etapa ${etiqueta}`,
      channelId: input.channelId,
      timeType: "DAYS",
      timeValue: dias,
      messageType: "TEXT",
      content: mensaje,
      cancelOnActivity: true,
    });

    if (!creado) {
      return { agendado: false };
    }

    console.log("[stage-follow-up] agendado", {
      contactId: input.contactId,
      etapa: input.stage,
      dias,
    });
    return { agendado: true, dias };
  } catch (error) {
    console.error("[stage-follow-up] error agendando", input.contactId, error);
    return { agendado: false };
  }
}
