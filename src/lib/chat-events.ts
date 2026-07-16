// Bus de eventos de chat EN PROCESO para realtime unificado (SSE).
//
// El webhook de Evolution (API y GO) publica aqui tras persistir un mensaje; el endpoint
// SSE (/api/cliente/chats/stream) se suscribe por workspace y empuja a los navegadores.
// Esto da realtime instantaneo a AMBOS gateways por un solo camino.
//
// Vive en memoria del proceso Node (deploy de una sola instancia con `next start`). Si
// algun dia se escala horizontalmente, cambiar este bus por Redis pub/sub sin tocar los
// callers. Se guarda en globalThis para sobrevivir el hot-reload de dev.

export type ChatRealtimeEvent = {
  type: "message" | "status";
  workspaceId: string;
  chatKey?: string | null;
  phoneNumber?: string | null;
  channelId?: string | null;
  at: number;
};

type ChatEventListener = (event: ChatRealtimeEvent) => void;

type ChatEventBus = {
  listeners: Map<string, Set<ChatEventListener>>;
};

const globalForChatEvents = globalThis as unknown as {
  __chatEventBus?: ChatEventBus;
};

function getBus(): ChatEventBus {
  if (!globalForChatEvents.__chatEventBus) {
    globalForChatEvents.__chatEventBus = { listeners: new Map() };
  }
  return globalForChatEvents.__chatEventBus;
}

// Suscribe un listener a los eventos de un workspace. Devuelve la funcion para desuscribir.
export function subscribeChatEvents(workspaceId: string, listener: ChatEventListener): () => void {
  const bus = getBus();
  let set = bus.listeners.get(workspaceId);
  if (!set) {
    set = new Set();
    bus.listeners.set(workspaceId, set);
  }
  set.add(listener);

  return () => {
    const current = bus.listeners.get(workspaceId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      bus.listeners.delete(workspaceId);
    }
  };
}

// Publica un evento a todos los suscriptores del workspace. Best-effort: nunca lanza.
export function publishChatEvent(event: ChatRealtimeEvent): void {
  try {
    const bus = getBus();
    const set = bus.listeners.get(event.workspaceId);
    if (!set || set.size === 0) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // Un listener roto no debe frenar a los demas.
      }
    }
  } catch {
    // El bus nunca debe romper el flujo del webhook.
  }
}
