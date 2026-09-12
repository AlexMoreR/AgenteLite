"use client";

import * as React from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Cada cuanto la campanita pregunta si hay mensajes sin leer.
 *
 * Estaba en 15s, y cada consulta trae la lista COMPLETA de conversaciones con su ultimo mensaje
 * y su conteo de no leidos: era la consulta mas cara de la app (medida el 29-jul-2026: ~2s cada
 * una). O sea que la campanita, sola, mantenia al servidor y a la base trabajando sin parar todo
 * el dia, aunque nadie la mirara.
 *
 * A 60s sigue avisando a tiempo -- es una notificacion, no un cronometro -- y hace la cuarta
 * parte del trabajo. Ademas el altavoz la adelanta cuando entra un mensaje de verdad, asi que el
 * minuto casi nunca llega a cumplirse.
 */
const POLL_INTERVAL_MS = 60000;

type NotificationConversation = {
  key?: string;
  incomingCount?: number | null;
};

type ConversationListResponse = {
  ok?: boolean;
  conversations?: NotificationConversation[];
};

/**
 * La campanita del encabezado: un numero y un enlace.
 *
 * Antes abria un menu colgado con los 8 ultimos chats sin leer. En el celular ese menu tapaba la
 * lista y se cerraba solo al desplazar, asi que leerlo era pelearse con el. Ahora lleva a
 * /cliente/notificaciones, que muestra lo mismo con la pantalla entera.
 *
 * Lo unico que se quedo aca es el conteo: es lo que enciende el punto rojo.
 */
export function ChatNotificationBell({ className }: { className?: string }) {
  /*
    Cuantos sin leer tiene CADA chat, no solo el total.

    Guardado chat por chat se puede apagar el que se acaba de abrir sin esperar a la proxima
    consulta. Con un total suelto habria que restar a ciegas y dos aperturas seguidas lo dejarian
    en negativo.
  */
  const [porChat, setPorChat] = React.useState<Record<string, number>>({});
  const [hasAccess, setHasAccess] = React.useState(true);

  /*
    Chats recien abiertos, con la hora.

    El servidor marca los mensajes como leidos DESPUES de responder la pantalla. En esos segundos
    una consulta todavia los cuenta, asi que sin esto el numero se apagaba al abrir el chat y
    volvia a encenderse solo un momento despues -un parpadeo peor que el problema original-.

    15 segundos alcanzan de sobra para esa escritura y son pocos para tapar un mensaje nuevo de
    verdad: si entra otro en ese rato, aparece en la consulta siguiente.
  */
  const leidosRecien = React.useRef<Map<string, number>>(new Map());

  React.useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        /*
          `assigned=all`: el punto avisa de CUALQUIER mensaje nuevo, no solo de los chats propios.

          Sin esto la campanita preguntaba por la bandeja "Mias" -el default de la ruta-, asi que
          un mensaje entrando a un chat de otra asesora, o a uno sin asignar, no encendia nada.
          Alex mira las 79 conversaciones y tiene 41 propias: para el se quedaba muda casi siempre.

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
          const ahora = Date.now();
          const cuentas: Record<string, number> = {};
          for (const conversation of payload.conversations) {
            const clave = conversation.key?.trim();
            const cuenta = conversation.incomingCount ?? 0;
            if (!clave || cuenta <= 0) {
              continue;
            }
            const leidoHace = leidosRecien.current.get(clave);
            if (leidoHace && ahora - leidoHace < 15000) {
              continue;
            }
            cuentas[clave] = cuenta;
          }
          setPorChat(cuentas);
        }
      } catch {
        // Ignoramos errores de red: se reintenta en el siguiente intervalo.
      } finally {
        if (!cancelled) {
          timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    };

    void poll();

    /*
      Ademas del minuto, la campanita escucha el aviso del altavoz.

      Con solo el intervalo, el punto podia tardar hasta 60 segundos en aparecer despues de que el
      mensaje YA estaba en la bandeja: se veia la fila nueva y la campana seguia apagada, que es
      peor que no tenerla. El intervalo queda de red de seguridad por si el socket esta caido.
    */
    const alLlegarAlgo = () => void poll();
    window.addEventListener("official-realtime-poke", alLlegarAlgo);

    /*
      Abrir un chat apaga su aviso en el acto (lo avisa shared-inbox).

      Sin esto el numero seguia ahi hasta un minuto despues de haber leido el mensaje: uno
      entraba, leia, volvia, y la campanita seguia en 1. Y no alcanzaba con volver a preguntar al
      navegar, porque el servidor marca los mensajes como leidos DESPUES de responder.
    */
    const alLeerUnChat = (evento: Event) => {
      const clave = (evento as CustomEvent<{ key?: string }>).detail?.key?.trim();
      if (!clave) {
        return;
      }
      leidosRecien.current.set(clave, Date.now());
      setPorChat((actuales) => {
        if (!actuales[clave]) {
          return actuales;
        }
        const siguiente = { ...actuales };
        delete siguiente[clave];
        return siguiente;
      });
    };
    window.addEventListener("chat-conversation-read", alLeerUnChat);

    return () => {
      cancelled = true;
      window.removeEventListener("official-realtime-poke", alLlegarAlgo);
      window.removeEventListener("chat-conversation-read", alLeerUnChat);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  if (!hasAccess) {
    return null;
  }

  const totalUnread = Object.values(porChat).reduce((suma, cuenta) => suma + cuenta, 0);
  const hasUnread = totalUnread > 0;
  const badgeLabel = totalUnread > 99 ? "99+" : String(totalUnread);

  return (
    <Link
      href="/cliente/notificaciones"
      prefetch={false}
      aria-label={hasUnread ? `${totalUnread} mensajes nuevos en chats` : "Notificaciones"}
      title="Notificaciones"
      // El tamaño del dibujo va en el <Bell/> de abajo, no aca: el boton base trae
      // `[&_svg:not([class*='size-'])]:size-4` y ese `:not` le gana a cualquier clase de afuera.
      // Ver la nota larga en buscador-global.tsx.
      className={cn(
        "relative inline-flex size-9 items-center justify-center rounded-lg text-foreground transition hover:bg-muted",
        className,
      )}
    >
      <Bell className="size-6" />
      {hasUnread ? (
        /*
          Redondo, rojo y liso.

          Tenia un borde del color del encabezado para despegarlo de la campana: se veia como un
          aro blanco alrededor y ensuciaba la forma. Sin el, el circulo se lee de una.

          El numero va chico a proposito -10px sobre un circulo de 18-: lo que avisa es la mancha
          roja, que se ve de lejos y de reojo; el numero se lee despues, ya mirando.
        */
        <span className="absolute top-0 right-0 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#ef4444] px-1 shadow-[0_1px_4px_rgba(15,23,42,0.18)]">
          <span className="text-[10px] font-semibold leading-none text-white">{badgeLabel}</span>
        </span>
      ) : null}
    </Link>
  );
}
