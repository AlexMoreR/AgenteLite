import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { subscribeChatEvents, type ChatRealtimeEvent } from "@/lib/chat-events";

// SSE en proceso: el navegador se suscribe por workspace y recibe un "poke" cada vez que
// llega un mensaje (de Evolution API o GO) al webhook. Requiere runtime Node (bus en
// memoria) y respuesta no cacheada.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Heartbeat para mantener viva la conexion a traves de proxies (comentario SSE `:`).
const HEARTBEAT_MS = 25000;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return new Response("No autorizado", { status: 401 });
  }

  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "chats")) {
    return new Response("No autorizado", { status: 403 });
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    return new Response("Workspace no encontrado", { status: 404 });
  }

  const workspaceId = membership.workspace.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      // Comentario inicial para abrir el stream de inmediato.
      safeEnqueue(`: connected\n\n`);

      const unsubscribe = subscribeChatEvents(workspaceId, (event: ChatRealtimeEvent) => {
        safeEnqueue(`event: chat\ndata: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeat = setInterval(() => {
        safeEnqueue(`: ping\n\n`);
      }, HEARTBEAT_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // ya cerrado
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
