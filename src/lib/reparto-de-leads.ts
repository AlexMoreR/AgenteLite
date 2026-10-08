import { Prisma } from "@prisma/client";

import { calcularReparto } from "@/lib/channel-collaborators";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { filtrarEnLinea, filtrarSinPausaManual, leerAsesoraDeRespaldo } from "@/lib/en-linea";
import { decidirReparto, madrugadaConTope, respaldoAtiende, ventanaDeMadrugada } from "@/lib/en-linea-reglas";
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
  /** true = es un chat que quedó sin dueña de madrugada (lo pasa el reparto de la mañana). */
  deMadrugada?: boolean;
  ahora?: Date;
}): Promise<string | null> {
  const ahora = args.ahora ?? new Date();
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

  /*
    Quien está fuera de su horario de reparto (Mi empresa -> Equipo) se salta en esta vuelta.

    El reparto de DÍA ya no exige tener el CRM abierto / estar "en línea" (Alex, 08-10-2026:
    "dejarlo como antes"): la rueda del día va entre todas las elegibles menos las pausadas a mano
    (`disponiblesParaTurno`). El motivo: en iPhone, con la app en segundo plano el latido dejaba de
    salir y a las 2 h el sistema la auto-pausaba sola, así que dejaba de recibir aunque estuviera
    trabajando.

    `disponibles` (en línea, con latido reciente) se sigue calculando porque la regla de MADRUGADA
    lo usa tal cual: de noche no se le encaja un lead a nadie dormida, y en el tope de 7 a 8 se
    reparte a quien ya abrió. Si no queda nadie elegible, el cliente va a la de respaldo, con aviso.
  */
  const enHorario = await filtrarPorHorario(args.workspaceId, validIds);
  const ventana = ventanaDeMadrugada(ahora);
  const conTope = madrugadaConTope(ahora);
  const [disponibles, disponiblesParaTurno, respaldo, marcadaDeMadrugada] = await Promise.all([
    filtrarEnLinea(args.workspaceId, enHorario, ahora),
    filtrarSinPausaManual(args.workspaceId, enHorario, ahora),
    leerAsesoraDeRespaldo(args.workspaceId),
    // Solo entre las 7 y las 8 importa si el chat viene de la noche (lo pide cualquier camino:
    // el rescate de huérfanos, el turno, el agente). El resto del día no se consulta.
    !args.deMadrugada && conTope ? tieneMarcaDeMadrugada(args.conversationId, ventana) : Promise.resolve(false),
  ]);
  const deMadrugada = Boolean(args.deMadrugada) || marcadaDeMadrugada;

  // Siguiente colaborador tras el último asignado (round-robin cíclico). La rueda sigue siendo la
  // lista completa: saltar a alguien por horario no le cambia el lugar a nadie en el turno.
  const lastId = typeof metadata.lastAutoAssignedUserId === "string" ? metadata.lastAutoAssignedUserId : null;
  const decision = decidirReparto({
    rueda: validIds,
    disponibles,
    disponiblesParaTurno,
    ultimaAsignada: lastId,
    respaldo,
    ahora,
    deMadrugada,
    recibidasDeMadrugada:
      deMadrugada && conTope ? await contarRecibidasDeMadrugada(args.workspaceId, ventana) : undefined,
  });
  if (decision.tipo === "esperar") {
    // De noche y sin nadie: el bot sigue contestando y el chat se reparte en la mañana.
    if (!respaldoAtiende(ahora)) {
      await marcarEsperaDeMadrugada({ ...args, ventana });
    }
    return null;
  }
  if (decision.tipo === "nadie") {
    return null;
  }
  const elegida = decision;
  const nextUserId = elegida.userId;

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
  // El respaldo no mueve la rueda: cuando vuelvan a estar en línea, el turno sigue donde iba. Los
  // chats de madrugada con tope (7 a 8) tampoco: se reparten aparte, a la que menos lleva.
  if (elegida.mueveLaRueda) {
    await prisma.whatsAppChannel.update({
      where: { id: args.channelId },
      data: { metadata: { ...metadata, lastAutoAssignedUserId: nextUserId } as Prisma.InputJsonValue },
    });
  }

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
    ...(elegida.deMadrugada ? { origen: ORIGEN_REPARTO_DE_MADRUGADA } : {}),
    text: elegida.porRespaldo
      ? `${assigneeName} asignado como respaldo (nadie estaba recibiendo clientes)`
      : elegida.deMadrugada
        ? `${assigneeName} auto-asignado (chat que llegó de madrugada)`
        : `${assigneeName} auto-asignado a esta conversación`,
  });

  // Aviso al celular de la asesora. Sin await: un push lento o caído no frena el reparto.
  if (args.avisarPorPush !== false) {
    void avisarAsignacionPorPush({
      conversationId: args.conversationId,
      userId: nextUserId,
      porRespaldo: elegida.porRespaldo,
    });
  }
  // Por respaldo, los jefes también se enteran: nadie del equipo está en línea.
  if (elegida.porRespaldo) {
    void avisarJefesDelRespaldo({ workspaceId: args.workspaceId, respaldoId: nextUserId, nombre: assigneeName });
  }
  return nextUserId;
}

/*
  LA MARCA DE MADRUGADA. Va como nota del sistema en el chat (como el resto de la actividad), así
  no hace falta migrar la base: "llegó de noche y nadie estaba en línea". El reparto de la mañana
  busca estas notas. Ver en-linea-reglas.ts.
*/
export const ORIGEN_ESPERA_DE_MADRUGADA = "espera-de-madrugada";
export const ORIGEN_REPARTO_DE_MADRUGADA = "reparto-de-madrugada";

type Ventana = { desde: Date; hasta: Date };

async function tieneMarcaDeMadrugada(conversationId: string, ventana: Ventana): Promise<boolean> {
  const marca = await prisma.message.findFirst({
    where: {
      conversationId,
      type: "SYSTEM",
      createdAt: { gte: ventana.desde, lt: ventana.hasta },
      rawPayload: { path: ["origen"], equals: ORIGEN_ESPERA_DE_MADRUGADA },
    },
    select: { id: true },
  });
  return Boolean(marca);
}

/** Una sola marca por chat y por noche, aunque la clienta escriba diez veces. */
async function marcarEsperaDeMadrugada(input: {
  conversationId: string;
  channelId: string;
  workspaceId: string;
  ventana: Ventana;
}): Promise<void> {
  try {
    if (await tieneMarcaDeMadrugada(input.conversationId, input.ventana)) {
      return;
    }
    await recordConversationActivity({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      channelId: input.channelId,
      kind: "note",
      origen: ORIGEN_ESPERA_DE_MADRUGADA,
      text: "Llegó de madrugada y nadie estaba en línea: el bot lo atiende y se asigna en la mañana.",
    });
  } catch (error) {
    console.warn("[reparto] no se pudo marcar el chat de madrugada", {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Cuántos chats de madrugada recibió cada una desde que terminó la noche (para el tope). */
async function contarRecibidasDeMadrugada(workspaceId: string, ventana: Ventana): Promise<Map<string, number>> {
  const filas = await prisma.message.findMany({
    where: {
      workspaceId,
      type: "SYSTEM",
      createdAt: { gte: ventana.hasta },
      rawPayload: { path: ["origen"], equals: ORIGEN_REPARTO_DE_MADRUGADA },
    },
    select: { rawPayload: true },
  });
  const cuentas = new Map<string, number>();
  for (const fila of filas) {
    const payload = fila.rawPayload as { assigneeUserId?: unknown } | null;
    if (typeof payload?.assigneeUserId === "string") {
      cuentas.set(payload.assigneeUserId, (cuentas.get(payload.assigneeUserId) ?? 0) + 1);
    }
  }
  return cuentas;
}

/** Los chats que quedaron sin dueña en la noche, más antiguos primero. */
export async function chatsDeMadrugadaPendientes(
  workspaceId: string,
  ventana: Ventana,
): Promise<{ id: string; channelId: string }[]> {
  const marcas = await prisma.message.findMany({
    where: {
      workspaceId,
      type: "SYSTEM",
      createdAt: { gte: ventana.desde, lt: ventana.hasta },
      rawPayload: { path: ["origen"], equals: ORIGEN_ESPERA_DE_MADRUGADA },
    },
    orderBy: { createdAt: "asc" },
    select: { conversationId: true },
  });
  if (marcas.length === 0) {
    return [];
  }
  const sinDuena = await prisma.conversation.findMany({
    where: {
      id: { in: marcas.map((marca) => marca.conversationId) },
      assignedToUserId: null,
      status: { notIn: ["CLOSED", "ARCHIVED"] },
      channelId: { not: null },
    },
    select: { id: true, channelId: true },
  });
  const porId = new Map(sinDuena.map((chat) => [chat.id, chat.channelId as string]));
  return marcas
    .map((marca) => marca.conversationId)
    .filter((id, i, todos) => porId.has(id) && todos.indexOf(id) === i)
    .map((id) => ({ id, channelId: porId.get(id) as string }));
}

/*
  AVISO A LOS JEFES: "nadie está recibiendo clientes" (Alex, 08-10-2026: "A Ingrid, con aviso").

  Uno cada 30 minutos por negocio, no uno por cliente: con nadie en línea de noche, cada lead
  sonaría en el celular del dueño. Es por proceso, como el antirrepetición de abajo.
*/
const ESPERA_ENTRE_AVISOS_DE_RESPALDO_MS = 30 * 60_000;
const ultimoAvisoDeRespaldo = new Map<string, number>();

async function avisarJefesDelRespaldo(input: { workspaceId: string; respaldoId: string; nombre: string }): Promise<void> {
  try {
    const ahora = Date.now();
    const ultimo = ultimoAvisoDeRespaldo.get(input.workspaceId);
    if (ultimo && ahora - ultimo < ESPERA_ENTRE_AVISOS_DE_RESPALDO_MS) {
      return;
    }
    ultimoAvisoDeRespaldo.set(input.workspaceId, ahora);
    const jefes = await prisma.workspaceMember.findMany({
      where: { workspaceId: input.workspaceId, isActive: true, role: { in: ["OWNER", "ADMIN"] } },
      select: { userId: true },
    });
    await Promise.all(
      jefes
        .filter((jefe) => jefe.userId !== input.respaldoId)
        .map((jefe) =>
          sendPushToUser({
            userId: jefe.userId,
            payload: {
              title: "Nadie está recibiendo clientes",
              body: `Los clientes nuevos le están llegando a ${input.nombre} (respaldo).`,
              tag: `respaldo:${input.workspaceId}`,
              url: "/cliente/equipo/actividad",
            },
          }),
        ),
    );
    console.log("[reparto] aviso de respaldo a jefes", { workspaceId: input.workspaceId, jefes: jefes.length });
  } catch (error) {
    console.warn("[reparto] no se pudo avisar el respaldo a los jefes", {
      workspaceId: input.workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
export async function avisarAsignacionPorPush(input: {
  conversationId: string;
  userId: string;
  /** Le llegó porque nadie estaba recibiendo clientes: el aviso se lo dice. */
  porRespaldo?: boolean;
}): Promise<void> {
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
        title: input.porRespaldo ? "Nuevo chat (respaldo: nadie en línea)" : "Nuevo chat asignado",
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
