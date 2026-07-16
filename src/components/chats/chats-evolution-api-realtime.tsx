"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { extractEvolutionRemoteJid, normalizePhoneFromJid } from "@/lib/evolution-webhook";

type ChatsEvolutionApiRealtimeProps = {
  enabled?: boolean;
  // Gateway del canal (Evolution API) y su instancia. Vienen del canal seleccionado.
  baseUrl: string;
  instanceName: string;
  apiKey?: string | null;
  selectedConversationKey?: string | null;
};

// Eventos de Evolution API que implican cambios en un chat. El socket.io de Evolution
// emite en minusculas con punto; algunas versiones tambien en MAYUSCULAS con guion bajo.
const MESSAGE_EVENTS = [
  "messages.upsert",
  "messages.update",
  "send.message",
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "SEND_MESSAGE",
];

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

/**
 * Realtime para canales Evolution API, usando SU socket.io (evogo tiene su WebSocket
 * nativo y lo maneja ChatsRealtimeSync; este componente no lo toca).
 *
 * El socket es solo un DISPARADOR: no trae el mensaje. Al recibir un evento pedimos ese
 * chat a nuestra propia API y actualizamos su fila (y el detalle si esta abierto), con
 * los mismos eventos de ventana que ya consume la bandeja. Nunca hace router.refresh():
 * recargar la pagina en cada mensaje da mala experiencia.
 *
 * El webhook sigue siendo quien PERSISTE los mensajes; esto solo avisa a la pantalla.
 */
export function ChatsEvolutionApiRealtime({
  enabled = true,
  baseUrl,
  instanceName,
  apiKey = null,
  selectedConversationKey = null,
}: ChatsEvolutionApiRealtimeProps) {
  // Ref para que el handler del socket lea siempre el chat abierto actual sin tener que
  // reconectar cada vez que cambia.
  const selectedConversationKeyRef = useRef(selectedConversationKey);
  useEffect(() => {
    selectedConversationKeyRef.current = selectedConversationKey;
  }, [selectedConversationKey]);

  useEffect(() => {
    if (!enabled || !baseUrl.trim() || !instanceName.trim()) {
      return;
    }

    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    let socket: Socket | null = null;

    async function refreshFromPayload(payload: unknown) {
      const phoneNumber = normalizePhoneFromJid(extractEvolutionRemoteJid(payload));
      if (!phoneNumber) {
        return;
      }

      try {
        const summaryResponse = await fetch(
          `/api/cliente/chats/summary?instanceName=${encodeURIComponent(instanceName)}&phoneNumber=${encodeURIComponent(phoneNumber)}`,
          { credentials: "same-origin", cache: "no-store" },
        );

        if (!summaryResponse.ok) {
          return;
        }

        const summaryPayload = (await summaryResponse.json().catch(() => null)) as
          | { ok?: boolean; conversation?: unknown }
          | null;

        if (!summaryPayload?.ok || !summaryPayload.conversation) {
          return;
        }

        const summaryConversation = hydrateConversationListSnapshot(summaryPayload.conversation);
        if (!summaryConversation) {
          return;
        }

        window.dispatchEvent(new CustomEvent("chat-list-update", { detail: { conversation: summaryConversation } }));

        // El detalle solo hace falta si ese chat es el que el usuario tiene abierto.
        const chatKey = `agent:${summaryConversation.id}`;
        if (chatKey !== (selectedConversationKeyRef.current?.trim() || "")) {
          return;
        }

        const liveResponse = await fetch(`/api/cliente/chats/live?chatKey=${encodeURIComponent(chatKey)}`, {
          credentials: "same-origin",
          cache: "no-store",
        });

        if (!liveResponse.ok) {
          return;
        }

        const livePayload = (await liveResponse.json().catch(() => null)) as
          | { ok?: boolean; conversation?: unknown }
          | null;

        if (!livePayload?.ok || !livePayload.conversation) {
          return;
        }

        const conversation = hydrateConversationSnapshot(livePayload.conversation);
        if (conversation) {
          window.dispatchEvent(new CustomEvent("chat-live-update", { detail: { conversation, chatKey } }));
        }
      } catch {
        // Error de red: el poll de respaldo lo recoge en el siguiente tick.
      }
    }

    const handleEvent = (payload: unknown) => {
      void refreshFromPayload(payload);
    };

    try {
      // Evolution API expone un namespace de socket.io por instancia.
      // La apiKey DEBE ir como query param: Evolution API la valida en la petición HTTP
      // inicial del handshake y sin ella responde 403 {"code":4,"message":"apiKey is required"},
      // así que el socket nunca conectaba. `auth` no alcanza: socket.io lo manda recién en el
      // handshake interno, después de esa validación. Se deja también por compatibilidad.
      const trimmedApiKey = apiKey?.trim() || "";
      socket = io(`${normalizedBaseUrl}/${instanceName}`, {
        transports: ["websocket"],
        ...(trimmedApiKey
          ? { query: { apikey: trimmedApiKey }, auth: { apikey: trimmedApiKey } }
          : {}),
      });
    } catch {
      return;
    }

    for (const eventName of MESSAGE_EVENTS) {
      socket.on(eventName, handleEvent);
    }

    return () => {
      if (socket) {
        for (const eventName of MESSAGE_EVENTS) {
          socket.off(eventName, handleEvent);
        }
        socket.close();
        socket = null;
      }
    };
  }, [enabled, baseUrl, instanceName, apiKey]);

  return null;
}
