"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, Pause, Play } from "lucide-react";

import { ContactAvatar } from "@/components/chats/contact-avatar";
import { getAudioMetaFromMessage } from "./chat-inbox-media";
import type { SharedInboxMessageItem } from "./chat-inbox-types";

/*
  Cuantas barras se dibujan.

  WhatsApp manda 64. Poniendo esas 64 -o 40- en los 180px que quedan, cada raya salia de 2px y
  se veian como pelos: la onda parecia una trama gris y no un audio. Con 26 cada raya pasa de 2
  a 5px y se leen como las de WhatsApp. Se pierde detalle del dibujo, que no es lo que uno mira:
  lo que uno mira es por donde va.
*/
const BARRAS = 26;

/**
 * Una onda inventada, siempre la misma para el mismo audio.
 *
 * Un tercio de las notas llegan sin la onda de WhatsApp. Dibujar una barra lisa ahi haria que
 * esas se vean rotas al lado de las otras; dibujar una al azar haria que cambiara de forma en
 * cada repintado, que es peor. Esta sale del id del mensaje: distinta entre audios, identica
 * siempre para el mismo.
 */
function ondaInventada(semilla: string): number[] {
  let x = 0;
  for (let i = 0; i < semilla.length; i += 1) {
    x = (x * 31 + semilla.charCodeAt(i)) % 233280;
  }
  const barras: number[] = [];
  for (let i = 0; i < BARRAS; i += 1) {
    x = (x * 9301 + 49297) % 233280;
    // Entre 25 y 100: sin valores muy bajos, para que no queden huecos que parezcan silencio.
    barras.push(25 + Math.round((x / 233280) * 75));
  }
  return barras;
}

/** Lleva la onda de WhatsApp (64 valores) a las barras que entran, promediando. */
function acomodarOnda(onda: number[]): number[] {
  if (onda.length === BARRAS) {
    return onda;
  }
  const salida: number[] = [];
  const porBarra = onda.length / BARRAS;
  for (let i = 0; i < BARRAS; i += 1) {
    const desde = Math.floor(i * porBarra);
    const hasta = Math.max(desde + 1, Math.floor((i + 1) * porBarra));
    let suma = 0;
    for (let j = desde; j < hasta && j < onda.length; j += 1) {
      suma += onda[j];
    }
    salida.push(Math.round(suma / (hasta - desde)));
  }
  return salida;
}

function reloj(segundos: number) {
  if (!Number.isFinite(segundos) || segundos < 0) {
    return "0:00";
  }
  const m = Math.floor(segundos / 60);
  const s = Math.floor(segundos % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Las que ofrece WhatsApp, en el mismo orden. */
const VELOCIDADES = [1, 1.5, 2] as const;

/**
 * La nota de voz, como en WhatsApp.
 *
 * Antes era el reproductor de fábrica del navegador: una barra gris con el volumen y unos tres
 * puntos que no hacen nada util en un chat. Ocupaba lo mismo y no decia ninguna de las dos cosas
 * que uno quiere saber de un audio -cuanto dura y por donde va-.
 *
 * Ahora: la foto de quien habla con el microfono encima, el boton de reproducir, la onda del
 * audio -la de verdad, la que manda WhatsApp- y el tiempo. Tocando la onda se salta a ese punto.
 *
 * Y una que WhatsApp tiene y aca hacia falta de verdad: la velocidad. Las asesoras escuchan
 * decenas de audios largos por dia; a 2x la mitad del tiempo.
 */
export function AudioMessageCard({
  message,
  mediaUrl,
  outbound,
  avatarUrl,
  contactLabel,
  hora,
  children,
}: {
  message: SharedInboxMessageItem;
  mediaUrl: string;
  outbound: boolean;
  avatarUrl?: string | null;
  contactLabel?: string | null;
  /**
   * La hora del mensaje con sus chulitos, que la arma la burbuja.
   *
   * Viene de afuera y se dibuja aca, al lado de la duracion: en una nota de voz la esquina de
   * abajo a la derecha la ocupa la foto de quien habla, y la hora ahi quedaba apretada contra
   * el avatar.
   */
  hora?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [sonando, setSonando] = useState(false);
  const [posicion, setPosicion] = useState(0);
  const [duracion, setDuracion] = useState(0);
  const [velocidad, setVelocidad] = useState<(typeof VELOCIDADES)[number]>(1);

  const meta = useMemo(() => getAudioMetaFromMessage(message), [message]);

  const barras = useMemo(
    () => (meta.waveform ? acomodarOnda(meta.waveform) : ondaInventada(message.id)),
    [message.id, meta.waveform],
  );

  /*
    La duracion sale del mensaje y no del archivo.

    El navegador solo la sabe cuando ya bajo la cabecera del audio, y hasta entonces devuelve
    Infinity: la tarjeta mostraria "0:00" hasta que uno le da play. WhatsApp ya nos dice cuanto
    dura, asi que se ve bien desde el primer momento y el archivo se baja recien al reproducir.
  */
  const duracionMostrada = duracion || meta.seconds || 0;
  const avance = duracionMostrada > 0 ? Math.min(1, posicion / duracionMostrada) : 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = velocidad;
    }
  }, [velocidad]);

  const alternar = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      audio.playbackRate = velocidad;
      void audio.play();
    } else {
      audio.pause();
    }
  }, [velocidad]);

  const saltarA = useCallback(
    (evento: React.MouseEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      if (!audio || duracionMostrada <= 0) {
        return;
      }
      const caja = evento.currentTarget.getBoundingClientRect();
      const parte = Math.min(1, Math.max(0, (evento.clientX - caja.left) / caja.width));
      audio.currentTime = parte * duracionMostrada;
      setPosicion(parte * duracionMostrada);
    },
    [duracionMostrada],
  );

  const colorLeido = outbound ? "bg-[var(--chat-out-accent)]" : "bg-[var(--primary)]";
  const colorPendiente = outbound ? "bg-[var(--chat-out-text-faint)]" : "bg-muted-foreground/35";

  const foto = (
    <span className="relative inline-block shrink-0">
      <ContactAvatar
        avatarUrl={avatarUrl}
        label={contactLabel ?? ""}
        className="size-12 rounded-full border-0 bg-muted text-muted-foreground after:border-0"
        fallbackClassName="rounded-full bg-muted text-muted-foreground"
      />
      {/*
        El microfono pegado a la foto. Azul mientras no se escucho y gris despues: de un vistazo
        se ve cuales quedan pendientes en una tanda de audios.

        Azul y no el verde de WhatsApp por pedido de Alex, y ademas se lee mejor: la burbuja
        saliente ya es verde y ahi el microfono se perdia contra el fondo.
      */}
      <span
        className={`absolute -bottom-0.5 -right-0.5 inline-flex size-[22px] items-center justify-center rounded-full ${
          posicion > 0 ? "text-muted-foreground" : "text-[#2563eb]"
        }`}
      >
        <Mic className="size-[18px] fill-current" />
      </span>
    </span>
  );

  return (
    <div className="w-[276px] max-w-full">
      <div className="flex items-center gap-2">
        {outbound ? foto : null}

        {/*
          El triangulo y la onda comparten fila; esa fila y el pie comparten columna; el avatar
          queda AFUERA de todo.

          De ahi salen las tres cosas: el avatar abarca las dos lineas y llega hasta abajo, el pie
          termina donde termina la onda -sin meterse debajo de la foto- y el triangulo queda
          centrado CON LA ONDA y no con la tarjeta entera, que era lo que lo dejaba un poco caido.
        */}
        <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={alternar}
          aria-label={sonando ? "Pausar" : "Reproducir"}
          className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${
            outbound ? "text-[var(--chat-out-text)]" : "text-foreground"
          }`}
        >
          {sonando ? (
            <Pause className="size-[18px] fill-current" />
          ) : (
            <Play className="size-[18px] fill-current" />
          )}
        </button>

        <div
          onClick={saltarA}
          role="slider"
          tabIndex={0}
          aria-label="Avance del audio"
          aria-valuemin={0}
          aria-valuemax={Math.round(duracionMostrada)}
          aria-valuenow={Math.round(posicion)}
          className="relative flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-[2px]"
        >
          {barras.map((alto, indice) => {
            const leida = indice / BARRAS <= avance;
            return (
              <span
                key={indice}
                className={`w-full rounded-full ${leida ? colorLeido : colorPendiente}`}
                // El minimo de 3px es para que las partes calladas se sigan viendo como una
                // linea y la onda no se corte por la mitad.
                style={{ height: `${Math.max(3, Math.round((alto / 100) * 26))}px` }}
              />
            );
          })}
          {/* La bolita del avance, encima de la onda. */}
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ${
              outbound ? "bg-[var(--chat-out-accent)]" : "bg-[var(--primary)]"
            }`}
            style={{ left: `${avance * 100}%` }}
          />
        </div>
        </div>

        {/*
          El pie arranca donde arranca la ONDA, no debajo del triangulo.

          Los 40px son el ancho del boton de play (32) mas su separacion (8). Sin esto la duracion
          quedaba colgada debajo del triangulo, en el borde de la tarjeta, y se leia como si fuera
          parte del boton en vez del audio.
        */}
        <div
          className={`mt-0.5 flex items-center justify-between gap-2 pl-10 ${
            outbound ? "text-[var(--chat-out-text-faint)]" : "text-muted-foreground"
          }`}
        >
          <span className="text-[11px] leading-none tabular-nums">
            {reloj(posicion > 0 ? posicion : duracionMostrada)}
          </span>

          <span className="flex items-center gap-1.5">

        {/*
          La velocidad aparece recien cuando el audio arranco.

          Antes de tocar play es un boton que no significa nada; despues es justo lo que se busca
          en un audio de dos minutos. Las asesoras escuchan decenas por dia.
        */}
        {posicion > 0 ? (
          <button
            type="button"
            onClick={() =>
              setVelocidad(
                (actual) => VELOCIDADES[(VELOCIDADES.indexOf(actual) + 1) % VELOCIDADES.length],
              )
            }
            aria-label={`Velocidad ${velocidad}x`}
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none transition ${
              outbound ? "bg-[var(--chat-out-overlay)]" : "bg-muted"
            }`}
          >
            {velocidad}x
          </button>
        ) : null}

            {hora}
          </span>
        </div>
        </div>

        {outbound ? null : foto}
      </div>

      <audio
        ref={audioRef}
        src={mediaUrl}
        preload="metadata"
        className="hidden"
        onPlay={() => setSonando(true)}
        onPause={() => setSonando(false)}
        onTimeUpdate={(evento) => setPosicion(evento.currentTarget.currentTime)}
        onLoadedMetadata={(evento) => {
          const valor = evento.currentTarget.duration;
          if (Number.isFinite(valor) && valor > 0) {
            setDuracion(valor);
          }
        }}
        onEnded={() => {
          setSonando(false);
          setPosicion(0);
        }}
      />

      {children}
    </div>
  );
}
