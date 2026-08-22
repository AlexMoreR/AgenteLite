import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { dedupeAndSortConversationListRows } from "@/lib/chat-conversation-list";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { scheduleContactAvatarRefresh, type ContactAvatarTarget } from "@/lib/contact-avatar-refresh";
import { extractEvolutionMessageText, extractEvolutionPushName } from "@/lib/evolution-webhook";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { getVisibleChannelIds, resolverConexionElegida } from "@/lib/channel-visibility";
import { isSnoozed } from "@/lib/lead-snooze";
import { prisma } from "@/lib/prisma";

type UnifiedConversation = {
  key: string;
  source: "agent";
  conversationId: string;
  agentId?: string;
  channelId?: string;
  label: string;
  secondaryLabel: string;
  tags?: Array<{
    label: string;
    color: string;
  }>;
  avatarUrl?: string | null;
  assignedToUserId?: string | null;
  assignedToName?: string | null;
  incomingCount?: number | null;
  lastMessage: string | null;
  lastMessageType?: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE" | null;
  lastMessageDirection?: "INBOUND" | "OUTBOUND" | null;
  lastMessageAt?: Date | null;
};

type ActiveProductContextSummary = {
  productName?: string | null;
};

function toActiveProductContextSummary(input: unknown): ActiveProductContextSummary | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const value = input as { productName?: unknown };
  const productName = typeof value.productName === "string" ? value.productName.trim() : "";
  if (!productName) {
    return null;
  }

  return { productName };
}

function getAgentContactLabel(input: { name: string | null; phoneNumber: string }) {
  return input.name?.trim() || input.phoneNumber;
}

function getConversationContextTags(input: ActiveProductContextSummary | null | undefined) {
  const productName = input?.productName?.trim();
  if (!productName) {
    return [];
  }

  return [{
    label: productName,
    color: "#2563eb",
  }];
}

function mergeConversationTags(
  baseTags: Array<{
    label: string;
    color: string;
  }>,
  extraTags: Array<{
    label: string;
    color: string;
  }>,
) {
  const merged: Array<{
    label: string;
    color: string;
  }> = [];
  const seen = new Set<string>();

  for (const tag of [...baseTags, ...extraTags]) {
    const label = tag.label.trim();
    if (!label) {
      continue;
    }

    const key = `${label.toLowerCase()}::${tag.color.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push({
      label,
      color: tag.color,
    });
  }

  return merged;
}

function resolveStoredAgentMessagePreview(input: {
  content: string | null;
  deletedAt: Date | null;
  rawPayload: unknown;
}) {
  if (input.deletedAt) {
    return "Mensaje eliminado";
  }

  return input.content?.trim() || extractEvolutionMessageText(input.rawPayload) || null;
}

function resolveStoredAgentContactLabel(input: {
  contactName: string | null;
  phoneNumber: string;
  rawPayload: unknown;
}) {
  return input.contactName?.trim() || extractEvolutionPushName(input.rawPayload)?.trim() || input.phoneNumber;
}

async function getAgentConversationList(input: {
  workspaceId: string;
  searchQuery: string;
  selectedConnectionKey: string;
  assignedFilter: "all" | "mine" | "unassigned";
  statusFilter: "all" | "open" | "resolved";
  currentUserId: string;
  // Canales que esta persona puede ver, o null si ve todos (ver channel-visibility).
  visibleChannelIds: string[] | null;
  offset: number;
  limit: number;
}) {
  const normalizedSearchQuery = input.searchQuery.trim();
  const assignedWhere: Prisma.ConversationWhereInput =
    input.assignedFilter === "mine"
      ? { assignedToUserId: input.currentUserId }
      : input.assignedFilter === "unassigned"
        ? { assignedToUserId: null }
        : {};
  const statusWhere: Prisma.ConversationWhereInput =
    input.statusFilter === "resolved"
      ? { status: { in: ["CLOSED", "ARCHIVED"] } }
      : input.statusFilter === "all"
        ? {}
        : { status: { in: ["OPEN", "PENDING"] } };
  const conversationWhere: Prisma.ConversationWhereInput = {
    workspaceId: input.workspaceId,
    AND: [
      input.visibleChannelIds ? { channelId: { in: input.visibleChannelIds } } : {},
      input.selectedConnectionKey.startsWith("channel:")
        ? { channelId: input.selectedConnectionKey.slice("channel:".length) }
        : {},
      assignedWhere,
      statusWhere,
      normalizedSearchQuery
        ? {
            OR: [
              {
                contact: {
                  name: {
                    contains: normalizedSearchQuery,
                    mode: "insensitive",
                  },
                },
              },
              {
                contact: {
                  phoneNumber: {
                    contains: normalizedSearchQuery,
                    mode: "insensitive",
                  },
                },
              },
              {
                messages: {
                  some: {
                    content: {
                      contains: normalizedSearchQuery,
                      mode: "insensitive",
                    },
                  },
                },
              },
            ],
          }
        : {},
    ],
  };

  const channels = await prisma.whatsAppChannel.findMany({
    where: {
      workspaceId: input.workspaceId,
      ...(input.visibleChannelIds ? { id: { in: input.visibleChannelIds } } : {}),
    },
    select: {
      id: true,
      provider: true,
      evolutionInstanceName: true,
      agent: {
        select: {
          id: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
  const evolutionInstanceNames = Array.from(
    new Set(
      channels
        .filter((channel) => channel.provider === "EVOLUTION" && channel.evolutionInstanceName?.trim())
        .map((channel) => channel.evolutionInstanceName!.trim()),
    ),
  );

  const activeAgentConversationsRaw = await prisma.conversation.findMany({
    where: conversationWhere,
    orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
    skip: input.offset,
    take: input.limit + 1,
    select: {
      id: true,
      agentId: true,
      channelId: true,
      assignedToUserId: true,
      assignedTo: { select: { name: true, email: true } },
      activeProductContext: true,
        contact: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            avatarUrl: true,
            crmStage: true,
            // Para saber si el lead esta pospuesto y no mostrarlo en la bandeja.
            metadata: true,
          },
        },
      },
    });

  /**
   * Las filas que se CONSUMIERON de la base en esta pagina. El +1 del take solo sirve para saber
   * si quedan mas, y eso se decide aca —antes de sacar los pospuestos— porque son dos cuentas
   * distintas: cuantas filas leimos y cuantos chats mostramos. Mezclarlas rompia la lista
   * entera: con un solo lead pospuesto en el lote, el filtro dejaba 39 de 40 y "hay mas" daba
   * falso, asi que el scroll no cargaba nunca mas nada aunque quedaran mil chats abajo.
   */
  const consumedConversationRows = activeAgentConversationsRaw.slice(0, input.limit);
  const hasMoreConversationRows = activeAgentConversationsRaw.length > input.limit;

  /**
   * Un lead pospuesto no aparece en la bandeja hasta que se cumpla el plazo, o hasta que el
   * cliente escriba (ahi el webhook lo despierta solo). Si posponer lo sacaba de "Mi dia" pero
   * lo dejaba aca, no servia de nada: la asesora lo veia igual en la lista que mira todo el dia.
   */
  const activeAgentConversations = consumedConversationRows.filter(
    (conversation) => !isSnoozed(conversation.contact?.metadata),
  );

  const activeAgentConversationIds = activeAgentConversations.map((conversation) => conversation.id);
  const contactIds = Array.from(new Set(activeAgentConversations.map((conversation) => conversation.contact.id)));
  const contactTagRowsPromise = contactIds.length
    ? prisma.$queryRaw<Array<{ contactId: string; name: string; color: string }>>`
        SELECT
          ct."contactId" AS "contactId",
          t."name" AS "name",
          t."color" AS "color"
        FROM "ContactTag" ct
        INNER JOIN "Tag" t ON t."id" = ct."tagId"
        WHERE ct."workspaceId" = ${input.workspaceId}
          AND ct."contactId" IN (${Prisma.join(contactIds)})
        ORDER BY ct."createdAt" ASC
      `
    : Promise.resolve([] as Array<{ contactId: string; name: string; color: string }>);
  // El ultimo mensaje de cada chat SIN traer rawPayload. rawPayload es el payload completo de
  // WhatsApp (JSON grande): traerlo de las 40 filas eran ~776 KB y 1150ms por pagina; sin el son
  // ~6 KB y 177ms. Solo se usa como FALLBACK (texto del preview si content esta vacio, nombre de
  // WhatsApp si el contacto no tiene nombre guardado), asi que se pide aparte solo para esas pocas.
  const latestAgentMessageRowsPromise = activeAgentConversationIds.length
      ? prisma.$queryRaw<Array<{
          conversationId: string;
          content: string | null;
          direction: "INBOUND" | "OUTBOUND";
          createdAt: Date;
          deletedAt: Date | null;
          type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE" | null;
        }>>`
        SELECT DISTINCT ON (m."conversationId")
          m."conversationId" AS "conversationId",
          m."content" AS "content",
          m."direction" AS "direction",
          m."createdAt" AS "createdAt",
          m."deletedAt" AS "deletedAt",
          m."type" AS "type"
        FROM "Message" m
        WHERE m."workspaceId" = ${input.workspaceId}
          AND m."conversationId" IN (${Prisma.join(activeAgentConversationIds)})
          AND m."isStatusBroadcast" = false
          AND (m."rawPayload"->>'source') IS DISTINCT FROM 'activity'
          AND m."type" IS DISTINCT FROM 'SYSTEM'
        ORDER BY m."conversationId", m."createdAt" DESC, m."id" DESC
      `
    : Promise.resolve([] as Array<{
        conversationId: string;
        content: string | null;
        direction: "INBOUND" | "OUTBOUND";
        createdAt: Date;
        deletedAt: Date | null;
        type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE" | null;
      }>);

  const agentIncomingCountRowsPromise = activeAgentConversationIds.length
    ? prisma.$queryRaw<Array<{
        conversationId: string;
        incomingCount: number;
      }>>`
        WITH selected_conversations AS (
          SELECT c."id"
          FROM "Conversation" c
          WHERE c."workspaceId" = ${input.workspaceId}
            AND c."id" IN (${Prisma.join(activeAgentConversationIds)})
        ),
        incoming AS (
          SELECT
            m."conversationId",
            COUNT(*)::int AS "incomingCount"
          FROM "Message" m
          WHERE m."workspaceId" = ${input.workspaceId}
            AND m."conversationId" IN (${Prisma.join(activeAgentConversationIds)})
            AND m."direction" = 'INBOUND'
            AND m."readAt" IS NULL
            AND m."isStatusBroadcast" = false
            -- OJO: aca NO va el filtro de (rawPayload->>'source') <> 'activity'. Las notas de
            -- actividad se guardan SIEMPRE como OUTBOUND (ver conversation-activity.ts), asi que
            -- con el filtro de INBOUND de arriba ya quedan afuera: la condicion no podia
            -- coincidir nunca. Pero obligaba a Postgres a abrir el rawPayload de cada mensaje
            -- candidato -- que guarda el webhook ENTERO, varios KB -- solo para comprobar algo
            -- imposible. Medido el 29-jul-2026: esta consulta tardaba 18s en devolver 20 filas.
          GROUP BY m."conversationId"
        )
        SELECT
          sc."id" AS "conversationId",
          COALESCE(incoming."incomingCount", 0)::int AS "incomingCount"
        FROM selected_conversations sc
        LEFT JOIN incoming ON incoming."conversationId" = sc."id"
      `
    : Promise.resolve([] as Array<{
        conversationId: string;
        incomingCount: number;
      }>);

  const [agentIncomingCountRowsResult, latestAgentMessageRowsResult, contactTagRowsResult] = await Promise.allSettled([
    agentIncomingCountRowsPromise,
    latestAgentMessageRowsPromise,
    contactTagRowsPromise,
  ]);
  const agentIncomingCountRows =
    agentIncomingCountRowsResult.status === "fulfilled" ? agentIncomingCountRowsResult.value : [];
  const latestAgentMessageRows =
    latestAgentMessageRowsResult.status === "fulfilled" ? latestAgentMessageRowsResult.value : [];
  const contactTagRows =
    contactTagRowsResult.status === "fulfilled" ? contactTagRowsResult.value : [];

  const latestAgentMessageByConversationId = new Map(
    latestAgentMessageRows.map((row) => [row.conversationId, row]),
  );

  // rawPayload SOLO para las conversaciones que lo van a usar de fallback: el ultimo mensaje no
  // tiene texto (content vacio) o el contacto no tiene nombre guardado (se saca el pushName del
  // payload). Asi evitamos traer el JSON grande de las 40; normalmente son un puñado por pagina.
  const contactNameByConversationId = new Map(
    activeAgentConversations.map((conversation) => [conversation.id, conversation.contact.name?.trim() ?? ""]),
  );
  const conversationIdsNeedingPayload = latestAgentMessageRows
    .filter(
      (row) =>
        !row.content?.trim() || !(contactNameByConversationId.get(row.conversationId) ?? ""),
    )
    .map((row) => row.conversationId);

  const payloadByConversationId = new Map<string, unknown>();
  if (conversationIdsNeedingPayload.length > 0) {
    try {
      const payloadRows = await prisma.$queryRaw<Array<{ conversationId: string; rawPayload: unknown }>>`
        SELECT DISTINCT ON (m."conversationId")
          m."conversationId" AS "conversationId",
          m."rawPayload" AS "rawPayload"
        FROM "Message" m
        WHERE m."workspaceId" = ${input.workspaceId}
          AND m."conversationId" IN (${Prisma.join(conversationIdsNeedingPayload)})
          AND m."isStatusBroadcast" = false
          AND (m."rawPayload"->>'source') IS DISTINCT FROM 'activity'
          AND m."type" IS DISTINCT FROM 'SYSTEM'
        ORDER BY m."conversationId", m."createdAt" DESC, m."id" DESC
      `;
      for (const row of payloadRows) {
        payloadByConversationId.set(row.conversationId, row.rawPayload);
      }
    } catch {
      // Si falla, se cae a phone/type-label: no rompemos la lista por un fallback.
    }
  }

  const agentIncomingCountById = new Map(agentIncomingCountRows.map((row) => [row.conversationId, row.incomingCount]));
  const contactTagsByContactId = new Map<string, Array<{ label: string; color: string }>>();
  for (const row of contactTagRows) {
    const currentTags = contactTagsByContactId.get(row.contactId) ?? [];
    contactTagsByContactId.set(row.contactId, [
      ...currentTags,
      {
        label: row.name,
        color: row.color,
      },
    ]);
  }

  const agentRows: UnifiedConversation[] = activeAgentConversations.map((conversation) => {
    const linkedChannel = conversation.channelId ? channelsById.get(conversation.channelId) || null : null;
    const latestMessage = latestAgentMessageByConversationId.get(conversation.id);
    const activeProductContext = toActiveProductContextSummary(conversation.activeProductContext);
    const tags = mergeConversationTags(
      contactTagsByContactId.get(conversation.contact.id) ?? [],
      getConversationContextTags(activeProductContext),
    );
    return {
      key: `agent:${conversation.id}`,
      source: "agent",
      conversationId: conversation.id,
      agentId: conversation.agentId || linkedChannel?.agent?.id || undefined,
      contactId: conversation.contact.id,
      channelId: conversation.channelId || undefined,
      assignedToUserId: conversation.assignedToUserId ?? null,
      assignedToName: conversation.assignedTo?.name?.trim() || conversation.assignedTo?.email || null,
      label: latestMessage
        ? resolveStoredAgentContactLabel({
            contactName: conversation.contact.name,
            phoneNumber: conversation.contact.phoneNumber,
            rawPayload: payloadByConversationId.get(conversation.id),
          })
        : getAgentContactLabel(conversation.contact),
      secondaryLabel: conversation.contact.phoneNumber,
      crmStage: conversation.contact.crmStage ?? null,
      tags,
      avatarUrl: conversation.contact.avatarUrl ?? null,
      incomingCount: agentIncomingCountById.get(conversation.id) ?? 0,
      lastMessage: latestMessage
        ? resolveStoredAgentMessagePreview({
            content: latestMessage.content,
            deletedAt: latestMessage.deletedAt,
            rawPayload: payloadByConversationId.get(conversation.id),
          })
        : null,
      lastMessageType: latestMessage?.type ?? null,
      lastMessageDirection: latestMessage?.direction ?? null,
      lastMessageAt: latestMessage?.createdAt ?? null,
    };
  });

  const merged = dedupeAndSortConversationListRows(agentRows)
    .filter((item) => {
      if (!input.searchQuery) return true;
      const q = input.searchQuery.toLowerCase();
      return (
        item.label.toLowerCase().includes(q) ||
        item.secondaryLabel.toLowerCase().includes(q) ||
        (item.lastMessage || "").toLowerCase().includes(q)
      );
    });

  // Ya no hace falta cortar: consumedConversationRows trae como mucho `limit` filas, y de ahi
  // solo se pueden haber caido pospuestos.
  const page = merged;

  // Refresco best-effort de las fotos de perfil de WhatsApp para los contactos visibles
  // (en segundo plano, con TTL/caché en Contact.metadata). Ver contact-avatar-refresh.ts.
  const avatarTargets = activeAgentConversations.reduce<ContactAvatarTarget[]>((acc, conversation) => {
    const channel = conversation.channelId ? channelsById.get(conversation.channelId) : null;
    const instanceName =
      channel?.provider === "EVOLUTION" ? channel.evolutionInstanceName?.trim() ?? "" : "";
    const phoneNumber = conversation.contact.phoneNumber?.trim() ?? "";
    if (instanceName && phoneNumber) {
      acc.push({ contactId: conversation.contact.id, phoneNumber, instanceName });
    }
    return acc;
  }, []);
  scheduleContactAvatarRefresh(avatarTargets);

  return {
    conversations: page,
    hasMore: hasMoreConversationRows,
    // Por donde sigue la proxima pagina: filas leidas de la base, NO chats devueltos. Si se
    // cuentan los devueltos, cada pospuesto corre el offset hacia atras y la pagina siguiente
    // repite filas que el cliente ya tiene; al deduplicarlas la lista no crece y se traba igual.
    nextOffset: input.offset + consumedConversationRows.length,
    total: page.length,
    evolutionInstanceNames,
  };
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "chats")) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    return NextResponse.json({ ok: false, error: "Workspace no encontrado" }, { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const searchQuery = requestUrl.searchParams.get("q")?.trim() || "";
  const selectedConnectionKey = requestUrl.searchParams.get("connection")?.trim() || "";
  const offset = Math.max(0, Number.parseInt(requestUrl.searchParams.get("offset") || "0", 10) || 0);
  const limit = Math.max(1, Math.min(40, Number.parseInt(requestUrl.searchParams.get("limit") || "20", 10) || 20));

  const isManager = membership.role === "OWNER" || membership.role === "ADMIN";
  const requestedFilterRaw = requestUrl.searchParams.get("assigned")?.trim() || "";
  let assignedFilter: "all" | "mine" | "unassigned" =
    requestedFilterRaw === "mine" || requestedFilterRaw === "unassigned" ? requestedFilterRaw : "all";
  // Los no-managers (empleados) solo pueden ver sus chats asignados: nunca "Todos" ni "Sin asignar".
  if (!isManager) {
    assignedFilter = "mine";
  }

  // Por DEFECTO solo abiertas, igual que la pantalla (src/app/cliente/chats/page.tsx). Aca el
  // default era "all" y eso hacia que **resolver un chat no sirviera de nada**: la pantalla lo
  // sacaba de la lista, pero la bandeja se refresca sola contra esta ruta —y el cliente no manda
  // `status` cuando esta en "open", porque es su default— asi que el chat resuelto volvia a
  // aparecer a los segundos. Una asesora lo resolvia y lo seguia viendo.
  const requestedStatusRaw = requestUrl.searchParams.get("status")?.trim() || "";
  const statusFilter: "all" | "open" | "resolved" =
    requestedStatusRaw === "all" || requestedStatusRaw === "resolved" ? requestedStatusRaw : "open";

  const visibleChannelIds = await getVisibleChannelIds({
    workspaceId: membership.workspace.id,
    userId: session.user.id,
    esJefe: isManager,
  });

  const data = await getAgentConversationList({
    workspaceId: membership.workspace.id,
    searchQuery,
    selectedConnectionKey: await resolverConexionElegida({
      workspaceId: membership.workspace.id,
      connectionKey: selectedConnectionKey,
      visibleChannelIds,
    }),
    assignedFilter,
    statusFilter,
    currentUserId: session.user.id,
    visibleChannelIds,
    offset,
    limit,
  });

  return NextResponse.json({
    ok: true,
    assignedFilter,
    isManager,
    ...data,
  });
}
