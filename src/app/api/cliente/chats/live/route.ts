import { NextResponse, after } from "next/server";
import { auth } from "@/auth";
import { loadAgentConversationDetail } from "@/lib/chat-message-loader";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { resolveEvolutionMessageMediaUrl } from "@/lib/evolution";
import { scheduleSingleContactAvatarRefresh } from "@/lib/contact-avatar-refresh";
import { persistChatMediaFromDataUrl } from "@/lib/chat-media-storage";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

const INITIAL_MESSAGE_BATCH_SIZE = 10;
const HISTORY_MESSAGE_BATCH_SIZE = 10;
// Presupuesto de tiempo para resolver el medio de un mensaje DENTRO de la respuesta. Si
// Evolution tarda más, devolvemos el mensaje sin el medio (placeholder) para que el chat
// aparezca rápido, y terminamos de resolver/persistir en segundo plano (`after`) para que
// la PRÓXIMA apertura ya lo tenga listo. Antes el endpoint bloqueaba la respuesta entera
// (incluido el texto) hasta descargar TODOS los binarios → apertura de 8-9s.
// Presupuesto para resolver un medio DENTRO de la respuesta. Es corto a proposito: los medios ya
// persistidos (/uploads) se resuelven por fast-path sin red y entran de sobra; lo que este limite
// corta es la descarga contra Evolution, que puede tardar segundos.
//
// Estuvo en 3500ms cuando el chat lo pintaba el SSR de la pagina y /live solo refrescaba por
// detras (la espera no se veia). Ahora abrir un chat no navega, asi que /live es la PRIMERA
// pintada de un chat sin cache: esperar ahi bloquea tambien el texto, y con cientos de medios sin
// persistir bastaba abrir un chat con una foto vieja para comerse los 3,5s. Los lentos se
// resuelven/persisten en segundo plano y el refetch de seguimiento (2,5s) los recoge.
const MEDIA_RESOLVE_RESPONSE_BUDGET_MS = 300;

type ResolvableMediaType = "IMAGE" | "AUDIO" | "VIDEO" | "STICKER";

function isResolvableMediaType(type?: string | null): type is ResolvableMediaType {
  return type === "IMAGE" || type === "AUDIO" || type === "VIDEO" || type === "STICKER";
}

// Persiste un data: URL resuelto en /uploads (igual que el webhook) y devuelve la ruta
// corta y renderable; si no es data:, devuelve la url tal cual. Así la respuesta no carga
// base64 gigante y la fila puede sanearse en BD para que la próxima apertura sea instantánea.
async function persistResolvedMediaUrl(resolvedUrl: string | null, mediaType: ResolvableMediaType) {
  if (!resolvedUrl) {
    return null;
  }

  if (resolvedUrl.startsWith("data:")) {
    const persisted = await persistChatMediaFromDataUrl({ dataUrl: resolvedUrl, mediaType }).catch(() => null);
    // Si no se pudo persistir, devolvemos el data: igualmente para no perder el medio.
    return persisted ?? resolvedUrl;
  }

  return resolvedUrl;
}

function parseChatKey(input: string) {
  if (!input) {
    return null;
  }

  const [source, ...rest] = input.split(":");
  const conversationId = rest.join(":");

  if (source !== "agent" || !conversationId) {
    return null;
  }

  return {
    source: source as "agent",
    conversationId,
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
  const chatKey = requestUrl.searchParams.get("chatKey")?.trim() || "";
  const beforeMessageId = requestUrl.searchParams.get("beforeMessageId")?.trim() || "";
  const batchSizeParam = requestUrl.searchParams.get("batchSize")?.trim() || "";
  const parsed = parseChatKey(chatKey);

  if (!parsed) {
    return NextResponse.json({ ok: false, error: "Chat invalido" }, { status: 400 });
  }

  const conversation = await loadAgentConversationDetail({
    workspaceId: membership.workspace.id,
    conversationId: parsed.conversationId,
    beforeMessageId: beforeMessageId || null,
    batchSize: batchSizeParam
      ? Number.parseInt(batchSizeParam, 10)
      : (beforeMessageId ? HISTORY_MESSAGE_BATCH_SIZE : INITIAL_MESSAGE_BATCH_SIZE),
  });

  if (!conversation) {
    return NextResponse.json({ ok: false, error: "Conversacion no encontrada" }, { status: 404 });
  }

  // Marcar como leidos los entrantes al ABRIR el chat. Antes lo hacia el server component de
  // /cliente/chats, pero abrir un chat ya no navega alli, asi que el marcado vive aca: este
  // endpoint es el que se llama al abrir. Solo en la carga INICIAL (sin beforeMessageId):
  // paginar historial hacia arriba no debe marcar nada. Diferido con after() para no bloquear.
  if (!beforeMessageId) {
    const conversationIdForRead = parsed.conversationId;
    const workspaceIdForRead = membership.workspace.id;
    after(async () => {
      try {
        await prisma.message.updateMany({
          where: {
            workspaceId: workspaceIdForRead,
            conversationId: conversationIdForRead,
            direction: "INBOUND",
            readAt: null,
          },
          data: { readAt: new Date() },
        });
      } catch {
        // Si falla, el badge se recalcula en la proxima carga: no rompemos la apertura del chat.
      }
    });
  }

  const instanceName = conversation.channel?.evolutionInstanceName?.trim() || null;
  // Saneos de BD (mediaUrl → ruta persistida) y resoluciones lentas que se terminan
  // después de responder, para que la próxima apertura del chat sea instantánea.
  const mediaUrlDbUpdates: Array<{ id: string; mediaUrl: string }> = [];
  const backgroundMediaTasks: Array<() => Promise<void>> = [];

  const messages = await Promise.all(
    conversation.messages.map(async (message) => {
      const base = { ...message, createdAt: message.createdAt.toISOString() };

      if (!isResolvableMediaType(message.type)) {
        return { ...base, mediaUrl: message.mediaUrl };
      }

      const mediaType = message.type;
      const resolution = resolveEvolutionMessageMediaUrl({
        instanceName,
        messageId: message.externalId ?? message.id,
        mediaType,
        mediaUrl: message.mediaUrl,
        rawPayload: message.rawPayload,
      });

      // Esperamos la resolución solo hasta el presupuesto; si tarda más, no bloqueamos.
      const raced = await Promise.race([
        resolution.then((value) => ({ inTime: true as const, value })),
        new Promise<{ inTime: false }>((resolve) => {
          setTimeout(() => resolve({ inTime: false }), MEDIA_RESOLVE_RESPONSE_BUDGET_MS);
        }),
      ]);

      if (raced.inTime) {
        const finalUrl = await persistResolvedMediaUrl(raced.value, mediaType);
        if (finalUrl && finalUrl !== message.mediaUrl && !finalUrl.startsWith("data:")) {
          mediaUrlDbUpdates.push({ id: message.id, mediaUrl: finalUrl });
        }
        return { ...base, mediaUrl: finalUrl ?? message.mediaUrl };
      }

      // Resolución lenta: respondemos con el valor ya guardado (lo mismo que muestra el
      // SSR, nunca peor) para que el chat aparezca rápido, y terminamos de resolver +
      // persistir en segundo plano para curar la fila de cara a la PRÓXIMA apertura.
      backgroundMediaTasks.push(async () => {
        const resolved = await resolution.catch(() => null);
        const persisted = await persistResolvedMediaUrl(resolved, mediaType);
        if (persisted && persisted !== message.mediaUrl && !persisted.startsWith("data:")) {
          await prisma.message.update({ where: { id: message.id }, data: { mediaUrl: persisted } }).catch(() => {});
        }
      });
      return { ...base, mediaUrl: message.mediaUrl };
    }),
  );

  if (mediaUrlDbUpdates.length > 0 || backgroundMediaTasks.length > 0) {
    after(async () => {
      await Promise.allSettled([
        ...mediaUrlDbUpdates.map((update) =>
          prisma.message.update({ where: { id: update.id }, data: { mediaUrl: update.mediaUrl } }).catch(() => {}),
        ),
        ...backgroundMediaTasks.map((task) => task()),
      ]);
    });
  }

  // Al abrir la conversación, refresca la foto de perfil de ESTE contacto (sin esperar el
  // turno del refresco en segundo plano), para que la foto aparezca pronto en el CRM.
  if (instanceName && conversation.contact.phoneNumber) {
    scheduleSingleContactAvatarRefresh({
      contactId: conversation.contact.id,
      phoneNumber: conversation.contact.phoneNumber,
      instanceName,
    });
  }

  return NextResponse.json({
    ok: true,
    conversation: {
      ...conversation,
      label: conversation.contact.name?.trim() || conversation.contact.phoneNumber,
      secondaryLabel: conversation.contact.phoneNumber,
      avatarUrl: conversation.contact.avatarUrl ?? null,
      contactId: conversation.contact.id,
      // Se suben al nivel de la conversacion para que el cliente pueda dibujar los controles de
      // la cabecera sin conocer la forma anidada. canImportHistory sigue la misma regla que el
      // server component: solo los canales con instancia de Evolution guardan historial (evogo
      // responde 404), y sin esto el boton aparecia y fallaba en la cara de la asesora.
      crmStage: conversation.contact.crmStage ?? null,
      canImportHistory: Boolean(conversation.channel?.evolutionInstanceName),
      messages,
    },
  });
}
