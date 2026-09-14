"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useOpenChatKey } from "@/components/chats/chat-selection-store";

type ChatsAutoRefreshProps = {
  intervalMs?: number;
  enabled?: boolean;
  realtimeEnabled?: boolean;
  // Active conversation key (for example: "agent:xxx" or "official:xxx").
  // For Evolution chats we use /live instead of router.refresh().
  selectedConversationKey?: string | null;
  // Respaldo propio para la API oficial (ms; 0 = apagado). Sus avisos llegan por el altavoz;
  // este tick solo cubre un socket caido. No comparte el poll general porque ese se cancela
  // cuando el realtime refresco la lista, y un chat oficial se quedaba congelado.
  officialRefreshMs?: number;
};

function hydrateConversationSnapshot(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as { id?: unknown; messages?: Array<{ createdAt?: string } & Record<string, unknown>> };
  if (typeof snapshot.id !== "string" || !Array.isArray(snapshot.messages)) return null;
  return {
    ...(value as Record<string, unknown>),
    id: snapshot.id,
    messages: snapshot.messages.map((message) => ({
      ...message,
      createdAt: new Date(message.createdAt || Date.now()),
    })),
  };
}

/*
  Los avisos del altavoz que dicen en que conversacion paso algo: para esos basta traer la fila.
  El resto (la API oficial, cuyas filas no tienen ruta propia) sigue pidiendo la pantalla entera.
*/
const AVISOS_CON_CONVERSACION = new Set(["waha-ack", "waha-incoming", "waha-update", "llamada"]);

function hydrateConversationListSnapshot(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as { id?: unknown; lastMessageAt?: string | Date | null };
  if (typeof snapshot.id !== "string") return null;
  return {
    ...(value as Record<string, unknown>),
    id: snapshot.id,
    lastMessageAt: snapshot.lastMessageAt ? new Date(snapshot.lastMessageAt) : null,
  };
}

async function publicarChatAbierto(response: Response | null, chatKey: string) {
  if (!response?.ok) return;
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; conversation?: unknown }
    | null;
  const conversation = payload?.ok ? hydrateConversationSnapshot(payload.conversation) : null;
  if (conversation) {
    window.dispatchEvent(new CustomEvent("chat-live-update", { detail: { conversation, chatKey } }));
  }
}

async function publicarFila(response: Response | null) {
  if (!response?.ok) return;
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; conversation?: unknown }
    | null;
  const conversation = payload?.ok ? hydrateConversationListSnapshot(payload.conversation) : null;
  if (conversation) {
    window.dispatchEvent(new CustomEvent("chat-list-update", { detail: { conversation } }));
  }
}

export function ChatsAutoRefresh({
  intervalMs = 5000,
  enabled = true,
  realtimeEnabled = true,
  selectedConversationKey = null,
  officialRefreshMs = 0,
}: ChatsAutoRefreshProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [isVisible, setIsVisible] = useState(
    () => (typeof document === "undefined" ? true : document.visibilityState === "visible"),
  );

  // Avoid concurrent fetches if the interval fires before the previous request ends.
  const inFlightRef = useRef(false);
  // If a live update already refreshed the active chat recently, skip one poll tick.
  const lastLiveUpdateAtRef = useRef(0);
  const lastLiveUpdateKeyRef = useRef<string | null>(null);
  // Ultima vez que el realtime actualizo la LISTA. Si el websocket esta vivo y trayendo
  // cambios, el refresco de la lista sobra: la lista ya se actualiza sola, fila por fila.
  const lastListUpdateAtRef = useRef(0);
  /*
    El chat abierto se lee de la seleccion del cliente, NO de la prop.

    La prop viene del servidor y queda congelada en el chat con el que cargo la pagina: abrir un
    chat con un clic no navega. Mientras cada aviso repintaba la pagina entera daba igual; desde que
    se trae solo lo que cambio, el mensaje nuevo entraba a la lista pero NO al chat abierto, porque
    aca se creia que el abierto era otro (Alex con Sthefany, 14-sep-2026). `useOpenChatKey` es la
    misma fuente que usa la bandeja.
  */
  const chatAbierto = useOpenChatKey(selectedConversationKey ?? "");
  const selectedConversationKeyRef = useRef<string | null>(chatAbierto || null);
  useEffect(() => {
    selectedConversationKeyRef.current = chatAbierto || null;
  }, [chatAbierto]);

  useEffect(() => {
    function handleVisibilityChange() {
      setIsVisible(document.visibilityState === "visible");
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    handleVisibilityChange();

    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    function handleLiveUpdate(event: Event) {
      const customEvent = event as CustomEvent<{ chatKey?: string | null }>;
      const chatKey = customEvent.detail?.chatKey?.trim() || "";

      if (!chatKey || chatKey !== selectedConversationKeyRef.current?.trim()) {
        return;
      }

      lastLiveUpdateAtRef.current = Date.now();
      lastLiveUpdateKeyRef.current = chatKey;
    }

    // Cualquier actualizacion de la lista significa que el realtime esta vivo.
    function handleListUpdate() {
      lastListUpdateAtRef.current = Date.now();
    }

    window.addEventListener("chat-live-update", handleLiveUpdate as EventListener);
    window.addEventListener("chat-list-update", handleListUpdate as EventListener);
    return () => {
      window.removeEventListener("chat-live-update", handleLiveUpdate as EventListener);
      window.removeEventListener("chat-list-update", handleListUpdate as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !isVisible) {
      return;
    }

    const timer = window.setInterval(async () => {
      const chatKey = selectedConversationKeyRef.current?.trim() ?? "";

      if (chatKey.startsWith("agent:")) {
        const wasRecentlyUpdated =
          lastLiveUpdateKeyRef.current === chatKey &&
          Date.now() - lastLiveUpdateAtRef.current < intervalMs;

        // Aunque exista realtime, mantenemos un fallback de polling.
        // Si el websocket falla o no emite el evento esperado, esto evita
        // que la conversación quede congelada sin refrescarse.
        if (realtimeEnabled && wasRecentlyUpdated) {
          return;
        }

        // Targeted fetch, no router.refresh() / RSC re-render.
        if (inFlightRef.current) return;

        inFlightRef.current = true;
        try {
          const [liveResponse, summaryResponse] = await Promise.all([
            fetch(`/api/cliente/chats/live?chatKey=${encodeURIComponent(chatKey)}`, {
              credentials: "same-origin",
              cache: "no-store",
            }),
            fetch(`/api/cliente/chats/summary?chatKey=${encodeURIComponent(chatKey)}`, {
              credentials: "same-origin",
              cache: "no-store",
            }),
          ]);

          await publicarChatAbierto(liveResponse, chatKey);
          await publicarFila(summaryResponse);
        } catch {
          // Network error: the next tick will retry.
        } finally {
          inFlightRef.current = false;
        }

        return;
      }

      // Sin chat abierto (o chat de API oficial) el unico refresco posible es router.refresh().
      // Pero si el realtime acaba de actualizar la lista, el websocket esta vivo y ya la
      // mantiene fila por fila: refrescar seria repintar la pagina para nada. Solo entra
      // cuando el realtime lleva un intervalo entero sin dar señales (o no hay realtime,
      // como en API oficial), que es justo cuando hace falta la red de seguridad.
      const listWasRecentlyUpdated = Date.now() - lastListUpdateAtRef.current < intervalMs;
      if (realtimeEnabled && listWasRecentlyUpdated) {
        return;
      }

      startTransition(() => {
        router.refresh();
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
    // The interval should not reset when the active chat changes.
  }, [enabled, isVisible, intervalMs, realtimeEnabled, router, startTransition]);

  // Respaldo de la API oficial: re-pide la pantalla entera, por eso va largo. Los avisos de verdad
  // llegan por el altavoz (efecto de abajo).
  useEffect(() => {
    if (!enabled || !isVisible || officialRefreshMs <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      startTransition(() => {
        router.refresh();
      });
    }, officialRefreshMs);

    return () => window.clearInterval(timer);
  }, [enabled, isVisible, officialRefreshMs, router, startTransition]);

  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;

  /*
    El altavoz avisa en el instante que algo cambio. Que hacer depende de si el aviso dice DONDE.

    Los de WhatsApp (WAHA) y las llamadas traen la conversacion: se trae SOLO esa fila (~0,4 kB) y,
    si es el chat abierto, sus mensajes. Antes cada aviso -cada mensaje, cada visto- volvia a pedir
    la pantalla entera (79 kB, ~680 ms) y React repintaba las 40 filas y el chat para cambiar un
    chulito de gris a azul: ese era el parpadeo.

    Los que no dicen donde siguen pidiendo la pantalla entera, con freno para no repintar en rafaga.
  */
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const pendientes = new Set<string>();
    let juntarTimer: number | undefined;
    let lastRefreshAt = 0;

    const traerConversacion = async (conversationId: string) => {
      const chatKey = `agent:${conversationId}`;
      const query = `chatKey=${encodeURIComponent(chatKey)}`;
      const estaAbierto = selectedConversationKeyRef.current?.trim() === chatKey;

      try {
        const [liveResponse, summaryResponse] = await Promise.all([
          estaAbierto
            ? fetch(`/api/cliente/chats/live?${query}`, { credentials: "same-origin", cache: "no-store" })
            : Promise.resolve(null),
          fetch(`/api/cliente/chats/summary?${query}`, { credentials: "same-origin", cache: "no-store" }),
        ]);
        await publicarChatAbierto(liveResponse, chatKey);
        await publicarFila(summaryResponse);
      } catch {
        // Sin red: el refresco de respaldo lo recoge.
      }
    };

    const handlePoke = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string | null; conversationId?: string | null } | null>)
        .detail;
      const conversationId = detail?.conversationId?.trim() || "";

      if (conversationId && AVISOS_CON_CONVERSACION.has(detail?.type ?? "")) {
        pendientes.add(conversationId);
        // Se juntan los avisos de un mismo instante: un mensaje trae su "entregado" y su "leido"
        // casi pegados, y no tiene sentido pedir la misma fila dos veces.
        if (juntarTimer === undefined) {
          juntarTimer = window.setTimeout(() => {
            juntarTimer = undefined;
            const ids = Array.from(pendientes);
            pendientes.clear();
            for (const id of ids) {
              void traerConversacion(id);
            }
          }, 250);
        }
        return;
      }

      if (!isVisibleRef.current) {
        return;
      }
      const now = Date.now();
      if (now - lastRefreshAt < 1200) {
        return;
      }
      lastRefreshAt = now;
      startTransition(() => {
        router.refresh();
      });
    };

    window.addEventListener("official-realtime-poke", handlePoke);

    return () => {
      if (juntarTimer !== undefined) {
        window.clearTimeout(juntarTimer);
      }
      window.removeEventListener("official-realtime-poke", handlePoke);
    };
  }, [enabled, router, startTransition]);

  return null;
}
