"use client";

import * as React from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { NotificationPermissionInline } from "@/components/chats/notification-permission-inline";

/**
 * Cada cuanto la campanita pregunta si hay mensajes sin leer.
 *
 * Estaba en 15s, y cada consulta trae la lista COMPLETA de conversaciones con su ultimo mensaje
 * y su conteo de no leidos: era la consulta mas cara de la app (medida el 29-jul-2026: ~2s cada
 * una). O sea que la campanita, sola, mantenia al servidor y a la base trabajando sin parar todo
 * el dia, aunque nadie la mirara.
 *
 * A 60s sigue avisando a tiempo -- es una notificacion, no un cronometro -- y hace la cuarta
 * parte del trabajo.
 */
const POLL_INTERVAL_MS = 60000;
const MAX_VISIBLE_NOTIFICATIONS = 8;

type NotificationConversation = {
  key?: string;
  label?: string;
  avatarUrl?: string | null;
  incomingCount?: number | null;
  lastMessage?: string | null;
  lastMessageType?: string | null;
  lastMessageAt?: string | null;
};

type ConversationListResponse = {
  ok?: boolean;
  conversations?: NotificationConversation[];
};

function renderPreview(conversation: NotificationConversation) {
  const text = (conversation.lastMessage ?? "").trim();
  if (text) {
    return text;
  }

  switch (conversation.lastMessageType) {
    case "AUDIO":
      return "Audio";
    case "IMAGE":
      return "Foto";
    case "VIDEO":
      return "Video";
    case "STICKER":
      return "Sticker";
    case "DOCUMENT":
      return "Documento";
    default:
      return "Nuevo mensaje";
  }
}

function getInitial(label?: string) {
  const trimmed = (label ?? "").trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

export function ChatNotificationBell({ className }: { className?: string }) {
  const [conversations, setConversations] = React.useState<NotificationConversation[]>([]);
  const [hasAccess, setHasAccess] = React.useState(true);

  /*
    La campanita tambien cuenta dentro de Chats.

    Estuvo apagada ahi por la consulta cara de arriba: sumarle 2 segundos de base a la pantalla
    donde las asesoras pasan el dia no valia la pena, porque la bandeja ya muestra los no leidos
    con su globito verde en cada fila.

    Ese motivo se termino. Medida de nuevo el 12-sep-2026, ya sin el detoast del rawPayload: 278
    ms. Y apagada tenia un costo propio que no se habia pensado: el boton seguia ahi, sin poder
    encenderse nunca, diciendo "No tienes mensajes nuevos" con la bandeja llena. Un boton que no
    puede funcionar se lee como roto, y es peor que no tenerlo.
  */
  React.useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        /*
          `assigned=all`: el punto avisa de CUALQUIER mensaje nuevo, no solo de los chats propios.

          Sin esto la campanita preguntaba por la bandeja "Mias" -el default de la ruta-, asi que
          un mensaje entrando a un chat de otra asesora, o a uno sin asignar, no encendia nada.
          Alex mira las 79 conversaciones y tiene 41 propias: para el la campanita se quedaba
          muda casi siempre, que es justo lo que reporto.

          No destapa nada: la ruta le impone "mias" a quien no es jefe y filtra por los canales
          visibles de cada quien. Pedir "todas" no cambia ninguna de las dos cosas.
        */
        const response = await fetch("/api/cliente/chats/list?limit=40&assigned=all", {
          cache: "no-store",
        });

        // El usuario no tiene acceso a chats: ocultamos la campanita.
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          if (!cancelled) setHasAccess(false);
          return;
        }

        const payload = (await response.json().catch(() => null)) as ConversationListResponse | null;
        if (!cancelled && payload?.ok && Array.isArray(payload.conversations)) {
          setConversations(payload.conversations);
        }
      } catch {
        // Ignoramos errores de red: se reintenta en el siguiente intervalo.
      } finally {
        if (!cancelled) {
          timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    };

    poll();

    /*
      Ademas del minuto, la campanita escucha el aviso del altavoz.

      Con solo el intervalo, el punto podia tardar hasta 60 segundos en aparecer despues de que
      el mensaje YA estaba en la bandeja: se veia la fila nueva y la campana seguia apagada, que
      es peor que no tenerla. El altavoz avisa en el instante en que entra el mensaje; el
      intervalo queda de red de seguridad por si el socket esta caido.
    */
    const alLlegarAlgo = () => {
      void poll();
    };
    window.addEventListener("official-realtime-poke", alLlegarAlgo);

    return () => {
      cancelled = true;
      window.removeEventListener("official-realtime-poke", alLlegarAlgo);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  const unreadConversations = React.useMemo(
    () =>
      conversations
        .filter((conversation) => (conversation.incomingCount ?? 0) > 0)
        .sort((a, b) => {
          const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
          const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
          return bTime - aTime;
        }),
    [conversations],
  );

  const totalUnread = React.useMemo(
    () => unreadConversations.reduce((sum, conversation) => sum + (conversation.incomingCount ?? 0), 0),
    [unreadConversations],
  );

  if (!hasAccess) {
    return null;
  }

  const hasUnread = totalUnread > 0;
  const badgeLabel = totalUnread > 99 ? "99+" : String(totalUnread);
  const visibleConversations = unreadConversations.slice(0, MAX_VISIBLE_NOTIFICATIONS);
  const remaining = unreadConversations.length - visibleConversations.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            // Del mismo tamaño que la lupa, que esta al lado: dos botones iguales se leen
            // como un par, y uno mas chico parece un error.
            // Mismo tamaño que la lupa, que esta al lado: dos botones iguales se leen como un
            // par. El tamaño del dibujo va en el <Bell/> de abajo, no aca (ver buscador-global).
            className={cn("relative size-10", className)}
            aria-label={hasUnread ? `${totalUnread} mensajes nuevos en chats` : "Notificaciones de chats"}
          />
        }
      >
        <Bell data-icon="inline-start" className="size-7" />
        {hasUnread ? (
          /*
            Redondo, rojo y liso.

            Tenia un borde del color del encabezado para despegarlo de la campana: se veia como un
            aro blanco alrededor y ensuciaba la forma. Sin el, el circulo se lee de una.

            El numero va chico a proposito -10px sobre un circulo de 18-: lo que avisa es la
            mancha roja, que se ve de lejos y de reojo; el numero se lee despues, ya mirando.
          */
          <span className="absolute top-0 right-0 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#ef4444] px-1 shadow-[0_1px_4px_rgba(15,23,42,0.18)]">
            <span className="text-[10px] font-semibold leading-none text-white">{badgeLabel}</span>
          </span>
        ) : null}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={6} className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2.5 text-sm font-semibold text-foreground">
          <span>Notificaciones</span>
          {hasUnread ? (
            <span className="rounded-full bg-[#ef4444]/10 px-2 py-0.5 text-[11px] font-semibold text-[#ef4444]">
              {badgeLabel}
            </span>
          ) : null}
        </div>
        <DropdownMenuSeparator className="mx-0 my-0" />

        <NotificationPermissionInline />

        {visibleConversations.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            No tienes mensajes nuevos.
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto py-1">
            {visibleConversations.map((conversation) => {
              const count = conversation.incomingCount ?? 0;
              const countLabel = count > 99 ? "99+" : String(count);
              const href = conversation.key
                ? `/cliente/chats?chatKey=${encodeURIComponent(conversation.key)}`
                : "/cliente/chats";

              return (
                <DropdownMenuItem
                  key={conversation.key ?? conversation.label}
                  asChild
                  className="gap-2.5 px-3 py-2"
                >
                  <Link href={href}>
                    <span className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[13px] font-semibold text-muted-foreground">
                      {conversation.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={conversation.avatarUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        getInitial(conversation.label)
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {conversation.label?.trim() || "Sin nombre"}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {renderPreview(conversation)}
                      </span>
                    </span>
                    <span className="ml-1 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#2563eb] px-1 text-[10px] font-semibold leading-none text-white">
                      {countLabel}
                    </span>
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </div>
        )}

        {remaining > 0 ? (
          <>
            <DropdownMenuSeparator className="mx-0 my-0" />
            <DropdownMenuItem asChild className="justify-center px-3 py-2 text-[13px] font-medium text-primary">
              <Link href="/cliente/chats">Ver todos los chats</Link>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
