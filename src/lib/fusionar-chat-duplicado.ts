import { prisma } from "@/lib/prisma";

/**
 * Une un chat duplicado del mismo cliente dentro del chat real y borra el duplicado.
 *
 * Por que existen: los leads de anuncios llegaban con el numero oculto (un LID como
 * "102572543217753") y evogo les abria una ficha con ese LID como telefono. Cuando despues
 * aparecia el numero real, nacia OTRO chat. El primer mensaje del cliente -el del anuncio- quedaba
 * en el duplicado, y "Cargar historial" en el chat real no lo traia porque ya estaba guardado en el
 * canal (juancho, 14-sep-2026). Hay cientos asi en Ventas 1.
 *
 * Solo se llama desde "Cargar historial", y solo cuando WAHA devolvio, PARA ESTE CHAT, un mensaje
 * que en la base esta en el otro: es WhatsApp mismo diciendo que son la misma persona. Decision de
 * Alex: se arreglan de a uno, a medida que se usan, no todos de golpe.
 *
 * Se mueve todo -mensajes, notas, llamadas, etiquetas, seguimientos- y se descartan los mensajes
 * que ya estaban en los dos (misma id de WhatsApp, o mismo mensaje con segundos de diferencia cuando
 * uno de los dos no tiene id). La ficha duplicada se borra solo si no le queda ningun otro chat.
 *
 * Devuelve cuantos mensajes pasaron al chat real (0 si no se unio nada).
 */
export async function fusionarChatDuplicado(input: {
  workspaceId: string;
  channelId: string;
  conversacionReal: string;
  conversacionDuplicada: string;
}): Promise<number> {
  if (input.conversacionReal === input.conversacionDuplicada) {
    return 0;
  }

  return prisma.$transaction(
    async (tx) => {
      const campos = {
        id: true,
        workspaceId: true,
        channelId: true,
        contactId: true,
        assignedToUserId: true,
        lastMessageAt: true,
        startedAt: true,
        createdAt: true,
      } as const;
      const [real, duplicada] = await Promise.all([
        tx.conversation.findUnique({ where: { id: input.conversacionReal }, select: campos }),
        tx.conversation.findUnique({ where: { id: input.conversacionDuplicada }, select: campos }),
      ]);

      // Nunca se cruzan negocios ni canales: el mismo cliente en Ventas 1 y en Admin son dos chats de verdad.
      const mismoLugar = (conversacion: typeof real) =>
        conversacion?.workspaceId === input.workspaceId && conversacion.channelId === input.channelId;
      if (!real || !duplicada || !mismoLugar(real) || !mismoLugar(duplicada)) {
        return 0;
      }

      const camposDeMensaje = {
        id: true,
        externalId: true,
        direction: true,
        type: true,
        createdAt: true,
        content: true,
      } as const;
      const [mensajesReales, mensajesDuplicados] = await Promise.all([
        tx.message.findMany({ where: { conversationId: real.id }, select: camposDeMensaje }),
        tx.message.findMany({ where: { conversationId: duplicada.id }, select: camposDeMensaje }),
      ]);

      const crudoDe = (id: string | null) => (id ? (id.split("_").pop() ?? id) : "");
      const crudosReales = new Set(mensajesReales.map((mensaje) => crudoDe(mensaje.externalId)).filter(Boolean));
      const repetidos = mensajesDuplicados
        .filter((mensaje) => {
          const crudo = crudoDe(mensaje.externalId);
          if (crudo && crudosReales.has(crudo)) {
            return true;
          }
          // El mismo envio guardado dos veces, una sin id (lo que se mandaba desde el CRM): mismo
          // tipo y texto con segundos de diferencia.
          return mensajesReales.some(
            (otro) =>
              (!otro.externalId || !mensaje.externalId) &&
              otro.direction === mensaje.direction &&
              otro.type === mensaje.type &&
              (otro.content ?? "").trim() === (mensaje.content ?? "").trim() &&
              Math.abs(otro.createdAt.getTime() - mensaje.createdAt.getTime()) <= 10_000,
          );
        })
        .map((mensaje) => mensaje.id);

      if (repetidos.length) {
        await tx.message.deleteMany({ where: { id: { in: repetidos } } });
      }
      const movidos = await tx.message.updateMany({
        where: { conversationId: duplicada.id },
        data: { conversationId: real.id, contactId: real.contactId },
      });

      await tx.contactMatch.updateMany({
        where: { conversationId: duplicada.id },
        data: { conversationId: real.id, contactId: real.contactId },
      });

      // La lectura de IA es una por chat: se queda la del real; si no tenia, hereda la del duplicado.
      const lecturaReal = await tx.conversationInsight.findUnique({
        where: { conversationId: real.id },
        select: { id: true },
      });
      if (lecturaReal) {
        await tx.conversationInsight.deleteMany({ where: { conversationId: duplicada.id } });
      } else {
        await tx.conversationInsight.updateMany({
          where: { conversationId: duplicada.id },
          data: { conversationId: real.id },
        });
      }

      const masViejo = (a: Date, b: Date) => (a < b ? a : b);
      const ultimoMensaje =
        real.lastMessageAt && duplicada.lastMessageAt
          ? real.lastMessageAt > duplicada.lastMessageAt
            ? real.lastMessageAt
            : duplicada.lastMessageAt
          : (real.lastMessageAt ?? duplicada.lastMessageAt);
      await tx.conversation.update({
        where: { id: real.id },
        data: {
          lastMessageAt: ultimoMensaje,
          startedAt: masViejo(real.startedAt, duplicada.startedAt),
          createdAt: masViejo(real.createdAt, duplicada.createdAt),
          assignedToUserId: real.assignedToUserId ?? duplicada.assignedToUserId,
        },
      });
      await tx.conversation.delete({ where: { id: duplicada.id } });

      if (duplicada.contactId !== real.contactId) {
        await unirFichas(tx, {
          workspaceId: input.workspaceId,
          fichaReal: real.contactId,
          fichaDuplicada: duplicada.contactId,
        });
      }

      return movidos.count;
    },
    { timeout: 30_000 },
  );
}

type Transaccion = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Pasa a la ficha real lo que colgaba de la duplicada y la borra, si ya no le queda ningun chat. */
async function unirFichas(
  tx: Transaccion,
  input: { workspaceId: string; fichaReal: string; fichaDuplicada: string },
) {
  const [otrosChats, real, duplicada] = await Promise.all([
    tx.conversation.count({ where: { contactId: input.fichaDuplicada } }),
    tx.contact.findUnique({ where: { id: input.fichaReal } }),
    tx.contact.findUnique({ where: { id: input.fichaDuplicada } }),
  ]);
  // Si el duplicado tiene chats en otros canales, la ficha sigue viva con esos.
  if (otrosChats > 0 || !real || !duplicada || duplicada.workspaceId !== input.workspaceId) {
    return;
  }

  const hacia = { contactId: input.fichaReal };
  const desde = { contactId: input.fichaDuplicada };
  await Promise.all([
    tx.message.updateMany({ where: desde, data: hacia }),
    tx.follow.updateMany({ where: desde, data: hacia }),
    tx.callAttempt.updateMany({ where: desde, data: hacia }),
    tx.contactMatch.updateMany({ where: desde, data: hacia }),
  ]);

  // Etiquetas y campanas no se pueden repetir por ficha: se pasan las que la real no tenia.
  const [etiquetasReales, campanasReales] = await Promise.all([
    tx.contactTag.findMany({ where: hacia, select: { tagId: true } }),
    tx.campaignRecipient.findMany({ where: hacia, select: { campaignId: true } }),
  ]);
  await tx.contactTag.updateMany({
    where: { ...desde, tagId: { notIn: etiquetasReales.map((fila) => fila.tagId) } },
    data: hacia,
  });
  await tx.campaignRecipient.updateMany({
    where: { ...desde, campaignId: { notIn: campanasReales.map((fila) => fila.campaignId) } },
    data: hacia,
  });

  // Los datos de la ficha real mandan; la duplicada solo completa lo que falta. La etapa del CRM se
  // hereda si la real sigue en NUEVO: la duplicada pudo haber avanzado antes de aparecer el numero.
  const heredaEtapa = real.crmStage === "NUEVO" && duplicada.crmStage !== "NUEVO";
  await tx.contact.update({
    where: { id: real.id },
    data: {
      name: real.name?.trim() ? undefined : duplicada.name,
      email: real.email ?? duplicada.email,
      notes: real.notes?.trim() ? undefined : duplicada.notes,
      aiSummary: real.aiSummary ?? duplicada.aiSummary,
      avatarUrl: real.avatarUrl ?? duplicada.avatarUrl,
      ...(heredaEtapa
        ? { crmStage: duplicada.crmStage, lostReason: duplicada.lostReason, wonAt: duplicada.wonAt }
        : {}),
    },
  });

  // Lo que quedo colgando (etiquetas/campanas repetidas) se va con la ficha por cascada.
  await tx.contact.delete({ where: { id: duplicada.id } });
}
