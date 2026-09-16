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
  lastMessageAt?: string | null;
};

/** Lo que la campana guarda de cada chat: cuantos sin leer y de cuando es el ultimo. */
type AvisoDeChat = { cuenta: number; cuando: number };

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
  const [porChat, setPorChat] = React.useState<Record<string, AvisoDeChat>>({});
  const [hasAccess, setHasAccess] = React.useState(true);

  /*
    Hasta cuando ya se miraron las notificaciones.

    El punto rojo NO es "mensajes sin leer": es "avisos nuevos desde la ultima vez que entre a
    Notificaciones" (Alex, 15-sep-2026). Marcar leidos los mensajes al entrar seria otra cosa -eso
    pasa al abrir cada chat- y le borraria a la asesora la marca de lo que le falta contestar.

    Se lee del servidor para que valga en todos sus dispositivos; hasta que conteste, se cuenta
    todo, que es como venia funcionando.
  */
  const [vistoEl, setVistoEl] = React.useState(0);

  /*
    Cuantas veces "sono" la campana. Se usa como `key` del dibujo: cambiarla lo vuelve a montar y
    la animacion arranca de nuevo aunque lleguen dos mensajes seguidos.
  */
  const [vecesQueSono, setVecesQueSono] = React.useState(0);
  const sonar = React.useCallback(() => setVecesQueSono((veces) => veces + 1), []);

  // Suena apenas el altavoz avisa un mensaje del cliente, sin esperar a la consulta.
  React.useEffect(() => {
    window.addEventListener("chat-incoming-message", sonar);
    return () => window.removeEventListener("chat-incoming-message", sonar);
  }, [sonar]);

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
    let enCurso = false;
    let pedirOtraVez = false;

    const poll = async () => {
      /*
        Una sola cadena de consultas, no una por aviso.

        Cada consulta agenda la siguiente al terminar. Cuando un aviso del altavoz la llamaba
        mientras la anterior esperaba su turno, quedaban DOS cadenas corriendo, y con cada mensaje
        del dia se sumaba otra: una pestaña abierta toda la tarde terminaba pidiendo la lista -la
        consulta mas cara de la app- cientos de veces por minuto. Se cancela el turno pendiente, y
        si ya hay una consulta en vuelo se pide otra para cuando termine en vez de lanzarla encima.
      */
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      if (enCurso) {
        pedirOtraVez = true;
        return;
      }
      enCurso = true;
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
          const cuentas: Record<string, AvisoDeChat> = {};
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
            const cuando = conversation.lastMessageAt ? new Date(conversation.lastMessageAt).getTime() : 0;
            cuentas[clave] = { cuenta, cuando: Number.isFinite(cuando) ? cuando : 0 };
          }
          setPorChat(cuentas);
        }
      } catch {
        // Ignoramos errores de red: se reintenta en el siguiente intervalo.
      } finally {
        enCurso = false;
        if (!cancelled) {
          timeoutId = setTimeout(poll, pedirOtraVez ? 1500 : POLL_INTERVAL_MS);
        }
        pedirOtraVez = false;
      }
    };

    void poll();

    // Desde cuando ya se miraron: sin esto, el punto contaria avisos que ya vio en otro dispositivo.
    void fetch("/api/cliente/notificaciones/visto", { cache: "no-store" })
      .then((respuesta) => (respuesta.ok ? respuesta.json() : null))
      .then((datos: { vistoEl?: string | null } | null) => {
        const marca = datos?.vistoEl ? new Date(datos.vistoEl).getTime() : 0;
        if (!cancelled && Number.isFinite(marca)) {
          setVistoEl(marca);
        }
      })
      .catch(() => undefined);

    /*
      Ademas del minuto, la campanita escucha el aviso del altavoz.

      Con solo el intervalo, el punto podia tardar hasta 60 segundos en aparecer despues de que el
      mensaje YA estaba en la bandeja: se veia la fila nueva y la campana seguia apagada, que es
      peor que no tenerla. El intervalo queda de red de seguridad por si el socket esta caido.
    */
    const alLlegarAlgo = (evento: Event) => {
      // Un visto, o el eco de un mensaje nuestro, no cambian cuantos hay sin leer.
      const tipo = (evento as CustomEvent<{ type?: string | null } | null>).detail?.type;
      if (tipo === "waha-ack" || tipo === "waha-update") {
        return;
      }
      void poll();
    };
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

    /*
      Entrar a Notificaciones apaga el punto en el acto.

      Lo avisa la propia pantalla (notificaciones-workspace) apenas abre, sin esperar a que el
      servidor conteste: el punto tiene que apagarse mientras uno mira, no un minuto despues.
    */
    const alMirarLasNotificaciones = () => setVistoEl(Date.now());
    window.addEventListener("notificaciones-vistas", alMirarLasNotificaciones);

    return () => {
      cancelled = true;
      window.removeEventListener("official-realtime-poke", alLlegarAlgo);
      window.removeEventListener("chat-conversation-read", alLeerUnChat);
      window.removeEventListener("notificaciones-vistas", alMirarLasNotificaciones);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  if (!hasAccess) {
    return null;
  }

  /*
    Solo lo llegado DESPUES de la ultima visita a Notificaciones.

    Un mensaje sin leer de ayer, que ya se vio en la lista de avisos, no tiene por que seguir
    encendiendo el punto: para eso esta el contador de cada chat en la bandeja.
  */
  const totalUnread = Object.values(porChat).reduce(
    (suma, aviso) => (aviso.cuando > vistoEl ? suma + aviso.cuenta : suma),
    0,
  );
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
      <Bell key={vecesQueSono} className={cn("size-6", vecesQueSono > 0 && "campana-sonando")} />
      {hasUnread ? (
        /*
          Redondo, rojo y liso.

          Tenia un borde del color del encabezado para despegarlo de la campana: se veia como un
          aro blanco alrededor y ensuciaba la forma. Sin el, el circulo se lee de una.

          El numero va chico a proposito -10px sobre un circulo de 18-: lo que avisa es la mancha
          roja, que se ve de lejos y de reojo; el numero se lee despues, ya mirando.
        */
        <span
          key={`punto-${vecesQueSono}`}
          className={cn(
            "absolute top-0 right-0 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#ef4444] px-1 shadow-[0_1px_4px_rgba(15,23,42,0.18)]",
            vecesQueSono > 0 && "punto-de-campana-saltando",
          )}
        >
          <span className="text-[10px] font-semibold leading-none text-white">{badgeLabel}</span>
        </span>
      ) : null}
    </Link>
  );
}
