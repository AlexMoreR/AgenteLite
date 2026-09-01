import { prisma } from "@/lib/prisma";
import { extractEvolutionMessageText } from "@/lib/evolution-webhook";

export type AgentConversationMessageRecord = {
  id: string;
  externalId: string | null;
  content: string | null;
  direction: "INBOUND" | "OUTBOUND";
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE" | null;
  mediaUrl: string | null;
  // Reaccion del cliente sobre ESTE mensaje (se dibuja pegada a la burbuja, como en WhatsApp).
  reactionEmoji: string | null;
  /** Estado del envio: dibuja el check simple, el doble y el doble azul. */
  status: "RECEIVED" | "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED";
  rawPayload: unknown;
};

export type LoadedAgentConversationDetail = {
  id: string;
  agentId: string | null;
  automationPaused: boolean;
  contact: {
    id: string;
    name: string | null;
    phoneNumber: string;
    avatarUrl: string | null;
    /** De aca sale si falta responder "¿se cerro la venta?" (ver crm-stage-sync). */
    metadata: unknown;
  };
  channel: {
    id: string;
    evolutionInstanceName: string | null;
    /** De aca sale a que gateway pertenece el canal. Lo usa la presencia. */
    metadata: unknown;
  } | null;
  messages: AgentConversationMessageRecord[];
  hasMoreMessages: boolean;
  loadMoreCursor: string | null;
};

const DEFAULT_MESSAGE_BATCH_SIZE = 10;
const MAX_MESSAGE_BATCH_SIZE = 100;

function clampBatchSize(value?: number) {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_MESSAGE_BATCH_SIZE;
  }

  return Math.max(1, Math.min(Math.floor(value), MAX_MESSAGE_BATCH_SIZE));
}

function isValidCursor(value?: string | null) {
  return Boolean(value && value.trim());
}

/**
 * Saca del payload guardado el ARCHIVO en base64 antes de mandarlo al navegador.
 *
 * El webhook de Evolution esta configurado con `base64: true`, asi que cada mensaje con
 * media guarda el archivo COMPLETO codificado dentro de `rawPayload`
 * (`evolution.data.Message.base64`). Eso viajaba al navegador en cada apertura de chat:
 * medido en produccion el 29-jul-2026, abrir un chat de 10 mensajes bajaba **37 MB** y
 * tardaba **10 a 28 segundos**. Era, de lejos, lo mas lento del CRM -- y lo que las asesoras
 * reportaban como "los chats estan lentisimos".
 *
 * La pantalla NUNCA lee ese campo: la foto sale de `mediaUrl` (el archivo ya guardado en
 * /uploads) y, como respaldo, de la miniatura `jpegThumbnail`, que es chica y se conserva.
 *
 * Se borra solo la clave `base64` cuando pasa de 4 KB, para no tocar nada mas del payload:
 * el resto lo usa la pantalla (texto de respaldo, nombre de archivo, tarjeta del anuncio,
 * ubicacion, si es nota de actividad...).
 */
const MAX_BASE64_INLINE = 4096;

function stripHeavyBase64(value: unknown, depth = 0): unknown {
  if (depth > 8 || !value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => stripHeavyBase64(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === "base64" && typeof nested === "string" && nested.length > MAX_BASE64_INLINE) {
      continue;
    }
    out[key] = stripHeavyBase64(nested, depth + 1);
  }

  return out;
}

export async function loadAgentConversationDetail(input: {
  workspaceId: string;
  conversationId: string;
  beforeMessageId?: string | null;
  batchSize?: number;
}) {
  const batchSize = clampBatchSize(input.batchSize);
  const beforeMessageId = isValidCursor(input.beforeMessageId) ? input.beforeMessageId!.trim() : null;

  const [conversation, cursorMessage] = await Promise.all([
    prisma.conversation.findFirst({
      where: {
        id: input.conversationId,
        workspaceId: input.workspaceId,
      },
      select: {
        id: true,
        agentId: true,
        automationPaused: true,
        // Datos que necesitan los controles de la cabecera (etapa del CRM, resolver, asignar).
        // Antes solo los tenia el server component de /cliente/chats, asi que esos botones se
        // armaban en el servidor por chat. Al abrir un chat sin navegar quedaban congelados en
        // el chat con el que cargo la pagina —o directamente no aparecian—, y la vendedora
        // perdia justo los botones que usa. Viajando aca se pueden dibujar en el cliente.
        status: true,
        assignedToUserId: true,
        assignedTo: { select: { id: true, name: true, email: true } },
        contact: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            avatarUrl: true,
            crmStage: true,
            metadata: true,
          },
        },
        channel: {
          select: {
            // El id hace falta para saber por que numero sale una llamada hecha desde este chat.
            id: true,
            evolutionInstanceName: true,
            // metadata: de ahi sale a que gateway pertenece el canal (lo usa la presencia).
            metadata: true,
          },
        },
      },
    }),
    beforeMessageId
      ? prisma.message.findFirst({
          where: {
            id: beforeMessageId,
            conversationId: input.conversationId,
            workspaceId: input.workspaceId,
          },
          select: {
            id: true,
          },
        })
      : Promise.resolve(null),
  ]);

  if (!conversation) {
    return null;
  }

  const messages = await prisma.message.findMany({
    where: {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      // Los broadcasts/estados se excluyen vía columna indexada (antes era un
      // filtro en JS sobre rawPayload). rawPayload se mantiene en el select
      // porque el UI lo usa para resolver media y previews de anuncios.
      isStatusBroadcast: false,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: batchSize + 1,
    ...(cursorMessage ? { cursor: { id: cursorMessage.id }, skip: 1 } : {}),
    select: {
      id: true,
      externalId: true,
      content: true,
      direction: true,
      createdAt: true,
      editedAt: true,
      deletedAt: true,
      rawPayload: true,
      type: true,
      mediaUrl: true,
      reactionEmoji: true,
      // El estado del envio: es lo que dibuja el check simple, el doble y el doble azul.
      // Sin traerlo, la burbuja no podia mostrar acuse alguno por mas que la base lo supiera.
      status: true,
    },
  });

  const visibleMessages = messages.slice(0, batchSize);
  const orderedMessages = [...visibleMessages].sort((left, right) => {
    const diff = left.createdAt.getTime() - right.createdAt.getTime();
    if (diff !== 0) {
      return diff;
    }

    return left.id.localeCompare(right.id);
  }).map((message) => ({
    ...message,
    content: message.content?.trim() || extractEvolutionMessageText(message.rawPayload) || null,
    rawPayload: stripHeavyBase64(message.rawPayload),
  }));

  return {
    id: conversation.id,
    agentId: conversation.agentId,
    automationPaused: conversation.automationPaused,
    contact: conversation.contact,
    channel: conversation.channel,
    messages: await conLlamadas({
      workspaceId: input.workspaceId,
      contactId: conversation.contact.id,
      mensajes: orderedMessages,
      // La pagina mas nueva no tiene tope superior: una llamada de hace un minuto es posterior
      // al ultimo mensaje y tiene que aparecer igual.
      esPaginaMasNueva: !cursorMessage,
    }),
    hasMoreMessages: messages.length > batchSize,
    loadMoreCursor: orderedMessages.at(0)?.id ?? null,
  } satisfies LoadedAgentConversationDetail;
}

/**
 * Mete las llamadas del lead en la conversacion, en su lugar cronologico.
 *
 * Van como mensajes de tipo SYSTEM con el texto "Llamada saliente/entrante · ...", que es el
 * formato que el chat ya dibuja como nota de llamada con su iconito (getCallMessageSummary). No
 * se guardan como Message en la base a proposito: son un CallAttempt, y duplicarlas obligaria a
 * mantener dos copias sincronizadas de lo mismo.
 *
 * Se acotan a la ventana de la pagina —entre el mensaje mas viejo y el mas nuevo que se estan
 * mostrando— para que al pedir "ver mas" no reaparezcan las mismas arriba.
 */
async function conLlamadas(input: {
  workspaceId: string;
  contactId: string;
  mensajes: AgentConversationMessageRecord[];
  esPaginaMasNueva: boolean;
}): Promise<AgentConversationMessageRecord[]> {
  const desde = input.mensajes.at(0)?.createdAt;
  if (!desde) {
    return input.mensajes;
  }
  const hasta = input.esPaginaMasNueva ? null : input.mensajes.at(-1)?.createdAt ?? null;

  const llamadas = await prisma.callAttempt
    .findMany({
      where: {
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        calledAt: { gte: desde, ...(hasta ? { lte: hasta } : {}) },
      },
      select: { id: true, calledAt: true, summary: true, result: true },
      take: 50,
    })
    .catch(() => []);

  if (llamadas.length === 0) {
    return input.mensajes;
  }

  const comoMensajes: AgentConversationMessageRecord[] = llamadas.map((llamada) => {
    const contenido = comoNotaDeLlamada(llamada.summary, llamada.result);

    return {
      id: `llamada:${llamada.id}`,
      externalId: null,
      // Una llamada no es un envio de WhatsApp: no lleva acuse, y RECEIVED no dibuja check.
      status: "RECEIVED" as const,
      content: contenido,
      direction: /^llamada\s+entrante/i.test(contenido) ? "INBOUND" : "OUTBOUND",
      createdAt: llamada.calledAt,
      editedAt: null,
      deletedAt: null,
      type: "SYSTEM",
      mediaUrl: null,
      reactionEmoji: null,
      rawPayload: null,
    };
  });

  return [...input.mensajes, ...comoMensajes].sort((izq, der) => {
    const diff = izq.createdAt.getTime() - der.createdAt.getTime();
    return diff !== 0 ? diff : izq.id.localeCompare(der.id);
  });
}

/**
 * El texto de la nota de llamada en el chat.
 *
 * Tiene que empezar con "Llamada saliente/entrante" porque es lo que el chat reconoce para
 * dibujarla con su iconito. Ademas normaliza los registros VIEJOS: los primeros que escribio el
 * buzon decian "Llamada atendida ... (WaCalls)", con el nombre del servicio colgando y un
 * "Llamada" que quedaba repetido al anteponerle la cabecera. El nombre del programa no le dice
 * nada a la asesora: lo que necesita saber es si hablaron y cuanto.
 */
function comoNotaDeLlamada(summary: string | null, result: string): string {
  const texto = (summary ?? "")
    .replace(/\s*\([^)]*wacalls[^)]*\)\s*$/i, "")
    .trim();

  if (/^llamada\s+(entrante|saliente)/i.test(texto)) {
    return texto;
  }

  if (/^el cliente llam/i.test(texto)) {
    return `Llamada entrante · ${texto.replace(/^el cliente llamó y /i, "").trim() || "perdida"}`;
  }

  // "Llamada atendida · 15s" → "Llamada saliente · atendida · 15s"
  const sinCabecera = texto.replace(/^llamada\s+/i, "").trim();
  return `Llamada saliente · ${sinCabecera || result.replace(/_/g, " ")}`;
}
