import { Prisma } from "@prisma/client";

import { calcularReparto } from "@/lib/channel-collaborators";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { filtrarPorHorario } from "@/lib/horario-de-reparto";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/web-push";

/**
 * EL REPARTO POR TURNOS: a quién le toca el próximo lead.
 *
 * Vivía dentro del webhook, que era su único usuario. Se mudó cuando el reparto dejó de pasar al
 * ENTRAR el lead y pasó a ocurrir cuando el agente levanta la mano (Alex, 25-09-2026): ahora lo
 * llaman el webhook, el aviso al asesor y el reloj que rescata los chats huérfanos.
 *
 * Reparte entre quienes trabajan el canal MENOS los pausados y los que solo monitorean, en orden
 * cíclico: una para Ingrid, la siguiente para María Camila, y así. El contenido no se tocó al
 * mudarlo: es el mismo código que venía repartiendo en producción.
 */

/** Devuelve a quién se lo asignó, o null si no lo asignó (ya tenía dueña, nadie en turno...). */
export async function autoAssignConversationToCollaborator(args: {
  conversationId: string;
  channelId: string;
  workspaceId: string;
  /**
   * false = no mandar el push "Nuevo chat asignado". Lo usa el aviso del agente V3, que ya le
   * manda WhatsApp a la asesora y solo cae al push si ese WhatsApp no le llegó.
   */
  avisarPorPush?: boolean;
}): Promise<string | null> {
  const [conversation, channel] = await Promise.all([
    prisma.conversation.findUnique({
      where: { id: args.conversationId },
      select: { assignedToUserId: true },
    }),
    prisma.whatsAppChannel.findUnique({
      where: { id: args.channelId },
      select: { metadata: true },
    }),
  ]);

  // Si ya está asignada, no la tocamos.
  if (!conversation || conversation.assignedToUserId) {
    return null;
  }

  const metadata =
    channel?.metadata && typeof channel.metadata === "object" && !Array.isArray(channel.metadata)
      ? (channel.metadata as Record<string, unknown>)
      : {};

  // Los que trabajan el canal MENOS los que están en pausa de reparto: una asesora pausada sigue
  // viendo y atendiendo lo suyo, solo deja de recibir leads nuevos.
  const collaboratorIds = calcularReparto(metadata);

  if (collaboratorIds.length === 0) {
    return null;
  }

  // Solo colaboradores que sigan siendo miembros activos del workspace.
  const activeMembers = await prisma.workspaceMember.findMany({
    where: { workspaceId: args.workspaceId, isActive: true, userId: { in: collaboratorIds } },
    select: { userId: true },
  });
  const activeSet = new Set(activeMembers.map((m) => m.userId));
  const validIds = collaboratorIds.filter((id) => activeSet.has(id));
  if (validIds.length === 0) {
    return null;
  }

  // Quien está fuera de su horario de reparto (Mi empresa -> Equipo) se salta en esta vuelta.
  const enHorario = new Set(await filtrarPorHorario(args.workspaceId, validIds));
  if (enHorario.size === 0) {
    return null;
  }

  // Siguiente colaborador tras el último asignado (round-robin cíclico). La rueda sigue siendo la
  // lista completa: saltar a alguien por horario no le cambia el lugar a nadie en el turno.
  const lastId = typeof metadata.lastAutoAssignedUserId === "string" ? metadata.lastAutoAssignedUserId : null;
  const lastIndex = lastId ? validIds.indexOf(lastId) : -1;
  const nextUserId = Array.from({ length: validIds.length }, (_, paso) => validIds[(lastIndex + 1 + paso) % validIds.length]).find(
    (userId) => enHorario.has(userId),
  );
  if (!nextUserId) {
    return null;
  }

  /*
    Solo si SIGUE sin dueña. Con el reparto por turno esto corre en cada mensaje de la clienta, y
    dos mensajes seguidos llegan casi a la vez: sin esta condición los dos asignaban y la rueda
    avanzaba dos lugares por un solo chat.
  */
  const asignada = await prisma.conversation.updateMany({
    where: { id: args.conversationId, assignedToUserId: null },
    data: { assignedToUserId: nextUserId },
  });
  if (asignada.count === 0) {
    return null;
  }
  await prisma.whatsAppChannel.update({
    where: { id: args.channelId },
    data: { metadata: { ...metadata, lastAutoAssignedUserId: nextUserId } as Prisma.InputJsonValue },
  });

  // Registro de actividad: "<Nombre> auto-asignado a esta conversación".
  const assignee = await prisma.user.findUnique({
    where: { id: nextUserId },
    select: { name: true, email: true },
  });
  const assigneeName = assignee?.name?.trim() || assignee?.email || "Colaborador";
  await recordConversationActivity({
    workspaceId: args.workspaceId,
    conversationId: args.conversationId,
    channelId: args.channelId,
    kind: "assigned",
    assigneeUserId: nextUserId,
    text: `${assigneeName} auto-asignado a esta conversación`,
  });

  // Aviso al celular de la asesora. Sin await: un push lento o caído no frena el reparto.
  if (args.avisarPorPush !== false) {
    void avisarAsignacionPorPush({
      conversationId: args.conversationId,
      userId: nextUserId,
    });
  }
  return nextUserId;
}

/*
  AVISO DE CHAT ASIGNADO (Alex, 06-10-2026).

  El reparto automático (por turno, el rescate de huérfanos y cuando el agente pide asesor) ponía
  el chat a nombre de la asesora sin decirle nada: se enteraba horas después, al abrir "Mías", con
  el cliente ya frío. Ahora le llega un push a su celular en el momento.

  Antirrepetición en memoria: el mismo chat no avisa dos veces en 2 minutos (dos mensajes casi a la
  vez, o el agente pidiendo asesor justo después de un reparto por turno). Es por proceso: si hay
  varias réplicas, en el peor caso llega un aviso de más, nunca uno de menos.
*/
const ESPERA_ENTRE_PUSH_DE_ASIGNACION_MS = 2 * 60_000;
const ultimoPushDeAsignacion = new Map<string, number>();

/** Vista previa de un mensaje para el aviso: el texto, o qué tipo de archivo mandó. */
function vistaPrevia(mensaje: { type: string; content: string | null; transcripcion: string | null } | null): string {
  if (!mensaje) {
    return "Escribió por WhatsApp";
  }
  const texto = (mensaje.content ?? mensaje.transcripcion ?? "").replace(/\s+/g, " ").trim();
  if (texto) {
    return texto.length > 80 ? `${texto.slice(0, 79)}…` : texto;
  }
  const porTipo: Record<string, string> = {
    IMAGE: "📷 Foto",
    AUDIO: "🎤 Nota de voz",
    VIDEO: "🎥 Video",
    DOCUMENT: "📄 Documento",
    STICKER: "Sticker",
    LOCATION: "📍 Ubicación",
  };
  return porTipo[mensaje.type] ?? "Mensaje nuevo";
}

/**
 * Manda el push "Nuevo chat asignado" a la asesora que recibió el chat. Nunca lanza.
 * Lo usa el reparto y, cuando el WhatsApp del agente V3 no le llegó a ella, `avisos.ts`.
 */
export async function avisarAsignacionPorPush(input: { conversationId: string; userId: string }): Promise<void> {
  try {
    const ahora = Date.now();
    const clave = `${input.conversationId}:${input.userId}`;
    const ultimo = ultimoPushDeAsignacion.get(clave);
    if (ultimo && ahora - ultimo < ESPERA_ENTRE_PUSH_DE_ASIGNACION_MS) {
      return;
    }
    ultimoPushDeAsignacion.set(clave, ahora);
    // Limpieza para que el mapa no crezca sin fin en un proceso que vive semanas.
    if (ultimoPushDeAsignacion.size > 500) {
      for (const [k, t] of ultimoPushDeAsignacion) {
        if (ahora - t >= ESPERA_ENTRE_PUSH_DE_ASIGNACION_MS) {
          ultimoPushDeAsignacion.delete(k);
        }
      }
    }

    const [conversacion, ultimoDelCliente] = await Promise.all([
      prisma.conversation.findUnique({
        where: { id: input.conversationId },
        select: { contact: { select: { name: true, phoneNumber: true, avatarUrl: true } } },
      }),
      prisma.message.findFirst({
        where: { conversationId: input.conversationId, direction: "INBOUND", deletedAt: null, type: { not: "SYSTEM" } },
        orderBy: { createdAt: "desc" },
        select: { type: true, content: true, transcripcion: true },
      }),
    ]);
    const contacto = conversacion?.contact;
    const quien = contacto?.name?.trim() || contacto?.phoneNumber || "Cliente";
    const foto = contacto?.avatarUrl?.trim() || "";

    const entregados = await sendPushToUser({
      userId: input.userId,
      payload: {
        title: "Nuevo chat asignado",
        body: `${quien}: ${vistaPrevia(ultimoDelCliente)}`,
        // Tag propio: con `chat:<id>` lo reemplazaría el aviso del próximo mensaje.
        tag: `asignado:${input.conversationId}`,
        // Mismo formato que los push de mensajes del webhook: abre ESE chat, no la lista.
        url: `/cliente/chats?chatKey=agent:${input.conversationId}&assigned=all`,
        ...(foto ? { icon: foto } : {}),
      },
    });
    console.log("[reparto] push de asignacion", {
      conversationId: input.conversationId,
      userId: input.userId,
      dispositivos: entregados,
    });
  } catch (error) {
    console.warn("[reparto] no se pudo avisar la asignacion por push", {
      conversationId: input.conversationId,
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
