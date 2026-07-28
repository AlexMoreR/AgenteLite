"use client";

import { useEffect, useRef } from "react";

/**
 * Escucha el altavoz (realtime-server.js) y avisa a la app que hubo un cambio en la API
 * oficial, para que refresque AL INSTANTE en vez de esperar el poll de 8s.
 *
 * Aislado de evogo a proposito: no toca ChatsRealtimeSync ni el socket de Evolution API.
 * Solo emite el evento `official-realtime-poke`; quien decide que hacer es ChatsAutoRefresh.
 *
 * Por el socket NO viaja contenido: solo "algo cambio en este workspace". Los datos se le
 * siguen pidiendo a la app, que es la que valida la sesion de la asesora.
 */
export function ChatsOfficialRealtime({
  enabled,
  workspaceId,
}: {
  enabled: boolean;
  workspaceId: string;
}) {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const closedByUsRef = useRef(false);

  useEffect(() => {
    if (!enabled || !workspaceId || typeof window === "undefined") {
      return;
    }

    closedByUsRef.current = false;

    const connect = () => {
      if (closedByUsRef.current) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${window.location.host}/rt/ws?workspaceId=${encodeURIComponent(workspaceId)}`;

      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }

      socketRef.current = socket;

      socket.onopen = () => {
        attemptsRef.current = 0;
      };

      socket.onmessage = (event) => {
        let payload: { type?: string } | null = null;
        try {
          payload = JSON.parse(event.data as string) as { type?: string };
        } catch {
          return;
        }

        // "ready" es el saludo del altavoz al conectar: no es un cambio que refrescar.
        if (!payload || payload.type === "ready") {
          return;
        }

        window.dispatchEvent(new CustomEvent("official-realtime-poke"));
      };

      socket.onclose = () => {
        socketRef.current = null;
        scheduleReconnect();
      };

      socket.onerror = () => {
        // El close posterior dispara la reconexion.
        try {
          socket.close();
        } catch {
          // ya cerrado
        }
      };
    };

    // Backoff: 1s, 2s, 4s... con techo de 30s, para no martillar al servidor si esta caido.
    const scheduleReconnect = () => {
      if (closedByUsRef.current) return;
      const delay = Math.min(30000, 1000 * 2 ** Math.min(attemptsRef.current, 5));
      attemptsRef.current += 1;
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    connect();

    return () => {
      closedByUsRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        try {
          socket.close();
        } catch {
          // ya cerrado
        }
      }
    };
  }, [enabled, workspaceId]);

  return null;
}
