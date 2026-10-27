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

/** Los avisos de un mismo chat que caen en este rato salen en un solo pedido de su fila. */
const VENTANA_POR_CHAT_MS = 3000;

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
    /*
      Rafagas por chat: el primer aviso trae la fila al instante (250 ms, como antes) y los que
      llegan despues -el "entregado", el "leido", el eco- se juntan en UN pedido al cerrar la
      ventana de 3 s. La fila termina igual (el ultimo pedido sale despues del ultimo aviso); solo
      el chulo del acuse puede tardar hasta 3 s mas en cambiar de color.
    */
    const ventanas = new Map<string, number>();
    const enEspera = new Set<string>();
    /*
      Chats que el altavoz marco como ajenos (no estan en la bandeja de esta asesora). Sus acuses y
      ecos tampoco se piden: el resumen contestaria "no encontrada" despues de gastar 4 consultas.
      Se olvida a los 10 min o en cuanto un mensaje de ese chat llega sin la marca (por ejemplo,
      si se lo asignaron). El chat ABIERTO nunca se salta.
    */
    const ajenos = new Map<string, number>();
    const OLVIDAR_AJENO_MS = 10 * 60 * 1000;
    // Con la pestaña oculta no se pide nada: se anotan y se piden una vez al volver.
    const alVolver = new Set<string>();
    const MAXIMO_FILAS_AL_VOLVER = 20;

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

    const esElAbierto = (conversationId: string) =>
      selectedConversationKeyRef.current?.trim() === `agent:${conversationId}`;

    const pedirFila = (conversationId: string) => {
      // Abre la ventana de este chat: lo que llegue en los proximos 3 s sale en un solo pedido.
      const ventana = window.setTimeout(() => {
        const otraVez = enEspera.delete(conversationId);
        ventanas.delete(conversationId);
        if (otraVez) {
          avisoDeChat(conversationId);
        }
      }, VENTANA_POR_CHAT_MS);
      ventanas.set(conversationId, ventana);

      pendientes.add(conversationId);
      // Se juntan los avisos de un mismo instante de distintos chats en una sola vuelta.
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
    };

    function avisoDeChat(conversationId: string) {
      if (document.visibilityState !== "visible") {
        alVolver.add(conversationId);
        return;
      }
      // El pedido de esta fila todavia no salio: ya va a traer lo de este aviso.
      if (pendientes.has(conversationId)) {
        return;
      }
      if (ventanas.has(conversationId)) {
        enEspera.add(conversationId);
        return;
      }
      pedirFila(conversationId);
    }

    const alCambiarVisibilidad = () => {
      if (document.visibilityState !== "visible" || alVolver.size === 0) {
        return;
      }
      const ids = Array.from(alVolver);
      alVolver.clear();
      /*
        Muchos chats cambiaron mientras no se miraba: una sola recarga de la pantalla sale mas
        barata que un resumen por cada uno (y trae la lista ya ordenada).
      */
      if (ids.length > MAXIMO_FILAS_AL_VOLVER) {
        lastRefreshAt = Date.now();
        startTransition(() => {
          router.refresh();
        });
        return;
      }
      for (const id of ids) {
        avisoDeChat(id);
      }
    };
    document.addEventListener("visibilitychange", alCambiarVisibilidad);

    const handlePoke = (event: Event) => {
      const detail = (
        event as CustomEvent<{ type?: string | null; conversationId?: string | null; chatAjeno?: boolean } | null>
      ).detail;
      const conversationId = detail?.conversationId?.trim() || "";
      const tipo = detail?.type ?? "";

      if (conversationId && AVISOS_CON_CONVERSACION.has(tipo)) {
        if (!esElAbierto(conversationId)) {
          const ahora = Date.now();
          if (tipo === "waha-incoming") {
            if (detail?.chatAjeno === true) {
              ajenos.set(conversationId, ahora);
              return;
            }
            ajenos.delete(conversationId);
          } else {
            const marcadoEl = ajenos.get(conversationId);
            if (marcadoEl !== undefined) {
              if (ahora - marcadoEl < OLVIDAR_AJENO_MS) {
                return;
              }
              ajenos.delete(conversationId);
            }
          }
        }
        avisoDeChat(conversationId);
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
      for (const ventana of ventanas.values()) {
        window.clearTimeout(ventana);
      }
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      window.removeEventListener("official-realtime-poke", handlePoke);
    };
  }, [enabled, router, startTransition]);

  return null;
}
