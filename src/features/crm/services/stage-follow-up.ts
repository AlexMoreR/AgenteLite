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
  /**
   * Solo los seguimientos que esperan al menos esto (en minutos).
   *
   * El Agente V3 ya manda sus propios recordatorios de 15 min y 1 h desde el libro; si ademas se
   * agendaran los del embudo de esos mismos plazos, la clienta recibiria dos casi iguales. Lo
   * destapo un chat real el 03-10-2026 (se cancelo solo porque ella contesto antes). El V3 pide
   * desde 1 dia: el del dia 1 y el del dia 3, que nadie mas cubre.
   */
  desdeMinutos?: number;
}): Promise<{ agendados: number }> {
  try {
    const etapa = await prisma.productFunnelStage.findFirst({
      where: {
        stage: input.stage,
        playbook: { workspaceId: input.workspaceId, productId: input.productId },
      },
      select: {
        followUps: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
          select: { timeType: true, timeValue: true, content: true, flowId: true, cancelOnActivity: true },
        },
      },
    });

    // Un seguimiento sale con su texto o con su flujo; sin ninguno de los dos no hay nada que mandar.
    const MINUTOS_POR_UNIDAD: Record<string, number> = { MINUTES: 1, HOURS: 60, DAYS: 1440 };
    const seguimientos = (etapa?.followUps ?? []).filter(
      (seguimiento) =>
        seguimiento.timeValue > 0 &&
        ((seguimiento.content ?? "").trim() || (seguimiento.flowId ?? "").trim()) &&
        seguimiento.timeValue * (MINUTOS_POR_UNIDAD[String(seguimiento.timeType)] ?? 1) >= (input.desdeMinutos ?? 0),
    );
    if (seguimientos.length === 0) {
      return { agendados: 0 };
    }

    /**
     * Si ya hay algo pendiente, no se agenda la tanda.
     *
     * Sin esto se apilarian: el lead avanza de etapa, se agenda la secuencia de la etapa nueva y
     * la de la anterior sigue viva, asi que el cliente recibiria mensajes cruzados por el mismo
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
      return { agendados: 0 };
    }

    const etiqueta = ETIQUETA_POR_ETAPA.get(input.stage) ?? input.stage;
    let agendados = 0;
    for (const [indice, seguimiento] of seguimientos.entries()) {
      const flowId = seguimiento.flowId?.trim() || null;
      const creado = await createFollow({
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        // Sin followRuleId: este seguimiento no nace de una regla del modulo Seguimientos sino del
        // Playbook del producto. La columna acepta null justamente para esto.
        name: `Etapa ${etiqueta} · ${indice + 1}`,
        channelId: input.channelId,
        timeType: seguimiento.timeType,
        timeValue: seguimiento.timeValue,
        messageType: "TEXT",
        content: flowId ? "Flujo del embudo" : (seguimiento.content ?? "").trim(),
        // Con flujo, la accion lleva el id y el motor lo arma al enviar (ver follows.ts).
        ...(flowId ? { actions: [{ messageType: "TEXT" as const, content: "Flujo del embudo", flowId }] } : {}),
        cancelOnActivity: seguimiento.cancelOnActivity,
      });
      if (creado) {
        agendados += 1;
      }
    }

    if (agendados > 0) {
      console.log("[stage-follow-up] agendado", {
        contactId: input.contactId,
        etapa: input.stage,
        cantidad: agendados,
      });
    }
    return { agendados };
  } catch (error) {
    console.error("[stage-follow-up] error agendando", input.contactId, error);
    return { agendados: 0 };
  }
}
