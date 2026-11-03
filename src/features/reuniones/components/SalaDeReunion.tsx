"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  LogOut,
  Maximize,
  MessageSquare,
  Minimize,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Send,
  X,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { terminarReunionAction } from "@/app/actions/reuniones-actions";
import {
  cargarLivekit,
  type LivekitClient,
  type ParticipanteLK,
  type PistaLK,
  type SalaLK,
} from "@/features/reuniones/components/cargar-livekit";
import { debeReconectar, esperaDelIntento, hayQueRendirse, nombreDelMotivo } from "@/features/reuniones/components/reconexion";

export type PaseDeLaSala = { url: string; pase: string; identidad: string; nombre: string; puedeTerminar: boolean };

/** Lo que devuelve pedir un pase: el pase, o el error (y si es porque la reunión ya terminó). */
export type ResultadoDelPase = { pase: PaseDeLaSala } | { error: string; terminada: boolean };

type Mensaje = { id: string; de: string; texto: string; mio: boolean };

const TEMA_DEL_CHAT = "chat";

/** Pega una pista de audio a su elemento mientras está en la sala. */
function AudioDePista({ pista }: { pista: PistaLK }) {
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const elemento = audio.current;
    if (!elemento) {
      return;
    }
    pista.attach(elemento);
    return () => {
      pista.detach(elemento);
    };
  }, [pista]);
  return <audio ref={audio} autoPlay />;
}

/** Distancia entre dos dedos, para el zoom. */
function distancia(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Pantalla compartida en grande (la de otra persona o la propia). Se ajusta sin cortarse, con botón de
 * pantalla completa (o a toda la ventana si el navegador no la permite) y zoom con dos dedos / arrastre.
 * El video va siempre sin sonido: el audio de la reunión llega por las pistas de los micrófonos (evita eco).
 */
function PantallaGrande({ pista, nombre, propia }: { pista: PistaLK; nombre: string; propia: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const [completa, setCompleta] = useState(false);
  const [ventanaCompleta, setVentanaCompleta] = useState(false);
  const [zoom, setZoom] = useState({ escala: 1, x: 0, y: 0 });
  const dedos = useRef(new Map<number, { x: number; y: number }>());
  const previa = useRef<{ separacion: number; centro: { x: number; y: number } } | null>(null);

  useEffect(() => {
    const elemento = video.current;
    if (!elemento) {
      return;
    }
    pista.attach(elemento);
    return () => {
      pista.detach(elemento);
    };
  }, [pista]);

  useEffect(() => {
    const alCambiar = () => setCompleta(document.fullscreenElement === caja.current);
    document.addEventListener("fullscreenchange", alCambiar);
    return () => document.removeEventListener("fullscreenchange", alCambiar);
  }, []);

  const alternarCompleta = async () => {
    const elemento = caja.current;
    if (!elemento) {
      return;
    }
    if (completa || ventanaCompleta) {
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => undefined);
      }
      setVentanaCompleta(false);
      return;
    }
    try {
      await elemento.requestFullscreen();
    } catch {
      // Respaldo (por ejemplo iPhone): se agranda a toda la ventana.
      setVentanaCompleta(true);
    }
  };

  const limitar = (escala: number, x: number, y: number) => {
    const ancho = caja.current?.clientWidth ?? 0;
    const alto = caja.current?.clientHeight ?? 0;
    const maxX = (ancho * (escala - 1)) / 2;
    const maxY = (alto * (escala - 1)) / 2;
    return { escala, x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  };

  const alBajar = (evento: React.PointerEvent) => {
    evento.currentTarget.setPointerCapture(evento.pointerId);
    dedos.current.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
    previa.current = null;
  };
  const alMover = (evento: React.PointerEvent) => {
    if (!dedos.current.has(evento.pointerId)) {
      return;
    }
    dedos.current.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });
    const puntos = Array.from(dedos.current.values());
    if (puntos.length >= 2) {
      const separacion = distancia(puntos[0], puntos[1]);
      const centro = { x: (puntos[0].x + puntos[1].x) / 2, y: (puntos[0].y + puntos[1].y) / 2 };
      const anterior = previa.current;
      if (anterior) {
        setZoom((actual) =>
          limitar(
            Math.max(1, Math.min(5, actual.escala * (separacion / anterior.separacion))),
            actual.x + centro.x - anterior.centro.x,
            actual.y + centro.y - anterior.centro.y,
          ),
        );
      }
      previa.current = { separacion, centro };
    } else if (puntos.length === 1) {
      const anterior = previa.current;
      if (anterior) {
        setZoom((actual) =>
          actual.escala > 1 ? limitar(actual.escala, actual.x + puntos[0].x - anterior.centro.x, actual.y + puntos[0].y - anterior.centro.y) : actual,
        );
      }
      previa.current = { separacion: 0, centro: puntos[0] };
    }
  };
  const alSoltar = (evento: React.PointerEvent) => {
    dedos.current.delete(evento.pointerId);
    previa.current = null;
  };

  const ampliada = completa || ventanaCompleta;
  return (
    <div
      ref={caja}
      className={cn(
        "relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg bg-black",
        ventanaCompleta && "fixed inset-0 z-50 rounded-none",
      )}
    >
      <div
        className="size-full touch-none"
        onPointerDown={alBajar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={alSoltar}
        onDoubleClick={() => setZoom({ escala: 1, x: 0, y: 0 })}
      >
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          className="size-full object-contain"
          style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.escala})` }}
        />
      </div>
      <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
        {propia ? "Estás compartiendo tu pantalla" : `Pantalla de ${nombre}`}
      </span>
      <div className="absolute top-1.5 right-1.5 flex gap-1.5">
        {zoom.escala > 1 ? (
          <button
            type="button"
            onClick={() => setZoom({ escala: 1, x: 0, y: 0 })}
            aria-label="Tamaño normal"
            className="flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-xs text-white hover:bg-black/80"
          >
            <ZoomOut className="size-3.5" /> Normal
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void alternarCompleta()}
          aria-label={ampliada ? "Salir de pantalla completa" : "Pantalla completa"}
          className="rounded bg-black/60 p-1.5 text-white hover:bg-black/80"
        >
          {ampliada ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
        </button>
      </div>
    </div>
  );
}

function Cuadro({ participante, compacto = false }: { participante: ParticipanteLK; compacto?: boolean }) {
  const nombre = participante.name || participante.identity;
  return (
    <div
      className={cn(
        "relative flex aspect-video min-h-0 items-center justify-center overflow-hidden rounded-lg bg-neutral-800",
        compacto && "h-full shrink-0 md:h-auto md:w-full",
        participante.isSpeaking && "ring-2 ring-emerald-400",
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-full bg-neutral-700 font-semibold text-white",
          compacto ? "size-8 text-sm" : "size-14 text-xl",
        )}
      >
        {nombre.slice(0, 1).toUpperCase()}
      </span>
      <span
        className={cn(
          "absolute bottom-1 left-1 flex max-w-[calc(100%-0.5rem)] items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-white",
          compacto ? "text-[10px]" : "text-xs",
        )}
      >
        {participante.isMicrophoneEnabled ? null : <MicOff className="size-3 shrink-0" />}
        <span className="truncate">
          {nombre}
          {participante.isLocal ? " (tú)" : ""}
        </span>
      </span>
    </div>
  );
}

const SALIO = "Saliste de la reunión.";
const TERMINO = "La reunión terminó.";

/** Texto de la pantalla de salida cuando NO se reconecta, según el motivo de LiveKit. */
function textoDeSalida(motivo: string | null) {
  if (motivo === "ROOM_DELETED") {
    return TERMINO;
  }
  if (motivo === "DUPLICATE_IDENTITY") {
    return "Entraste a esta reunión desde otro dispositivo.";
  }
  if (motivo === "PARTICIPANT_REMOVED") {
    return "Te sacaron de la reunión.";
  }
  return SALIO;
}

/**
 * Adentro de la reunión: voz (micrófono, silenciar, salir), compartir pantalla y chat. Sin cámara.
 * La pantalla compartida no se graba: el acta sale solo del audio de los micrófonos.
 * Quien la creó, el dueño y los administradores ven
 * "Terminar reunión", que la cierra para todos.
 *
 * Para el celular: mientras está adentro la pantalla no se apaga sola (Wake Lock); al volver a la
 * pestaña revisa el micrófono y el audio; y si la conexión se cae del todo vuelve a entrar sola a la
 * misma sala con un pase nuevo (misma identidad), así la grabación sigue con una pista nueva que el
 * CRM une por la hora con la anterior.
 */
export function SalaDeReunion({
  codigo,
  titulo,
  sinGrabar = false,
  pase,
  pedirPase,
  onSalir,
}: {
  codigo: string;
  titulo: string;
  sinGrabar?: boolean;
  pase: PaseDeLaSala;
  pedirPase: () => Promise<ResultadoDelPase>;
  onSalir: () => void;
}) {
  const [lk, setLk] = useState<LivekitClient | null>(null);
  const [room, setRoom] = useState<SalaLK | null>(null);
  const [, setVersion] = useState(0);
  const [estado, setEstado] = useState<"conectando" | "dentro" | "fuera">("conectando");
  const [motivoDeSalida, setMotivoDeSalida] = useState<string | null>(null);
  const [reconectando, setReconectando] = useState(false);
  const [sinAudio, setSinAudio] = useState(false);
  const [chatAbierto, setChatAbierto] = useState(false);
  const [sinLeer, setSinLeer] = useState(0);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [terminando, setTerminando] = useState(false);
  const chatAbiertoRef = useRef(false);
  useEffect(() => {
    chatAbiertoRef.current = chatAbierto;
  }, [chatAbierto]);
  // Lo que la persona quiere del micrófono (para prenderlo igual al reconectar o reiniciarlo al volver).
  const micDeseadoRef = useRef(true);
  // «Salir»: la salida es voluntaria y no se reconecta.
  const salidaVoluntariaRef = useRef(false);
  // El efecto de la conexión deja acá cómo intentar ya mismo y cómo dejar de intentar.
  const intentarYaRef = useRef<() => void>(() => undefined);
  const detenerReconexionRef = useRef<() => void>(() => undefined);
  const pedirPaseRef = useRef(pedirPase);
  useEffect(() => {
    pedirPaseRef.current = pedirPase;
  }, [pedirPase]);

  const repintar = useCallback(() => setVersion((valor) => valor + 1), []);

  useEffect(() => {
    let cancelada = false;
    let room: SalaLK | null = null;
    // Reconexión sola: desde cuándo está caída (null = conectada), número de intento y espera en curso.
    let caidaDesde: number | null = null;
    let intento = 0;
    let intentando = false;
    let temporizador: number | undefined;

    const salirSinReconectar = (texto: string) => {
      caidaDesde = null;
      window.clearTimeout(temporizador);
      setReconectando(false);
      setMotivoDeSalida(texto);
      setEstado("fuera");
    };
    detenerReconexionRef.current = () => {
      caidaDesde = null;
      window.clearTimeout(temporizador);
    };

    const prenderMicrofono = async (sala: SalaLK) => {
      if (!micDeseadoRef.current) {
        return;
      }
      try {
        await sala.localParticipant.setMicrophoneEnabled(true);
      } catch {
        // Sin permiso: no se insiste en cada reconexión; la persona lo prende con el botón.
        micDeseadoRef.current = false;
        toast.error("No se pudo usar el micrófono. Revisa el permiso del navegador.");
      }
    };

    const programar = () => {
      window.clearTimeout(temporizador);
      const espera = esperaDelIntento(intento);
      intento += 1;
      temporizador = window.setTimeout(() => void intentar(), espera);
    };

    // Un intento de volver a entrar: pase nuevo (misma identidad) y la misma sala.
    const intentar = async () => {
      if (cancelada || caidaDesde === null || intentando || !room) {
        return;
      }
      window.clearTimeout(temporizador);
      if (hayQueRendirse(caidaDesde, Date.now())) {
        salirSinReconectar("Se perdió la conexión con la reunión.");
        return;
      }
      intentando = true;
      try {
        const resultado = await pedirPaseRef.current();
        if (cancelada || caidaDesde === null) {
          return;
        }
        if ("pase" in resultado) {
          await room.connect(resultado.pase.url, resultado.pase.pase);
          if (cancelada || caidaDesde === null) {
            return;
          }
          caidaDesde = null;
          intento = 0;
          setReconectando(false);
          setSinAudio(!room.canPlaybackAudio);
          await prenderMicrofono(room);
          repintar();
        } else if (resultado.terminada) {
          salirSinReconectar(TERMINO);
        }
      } catch {
        // Sin señal todavía: se vuelve a intentar abajo.
      } finally {
        intentando = false;
        if (!cancelada && caidaDesde !== null) {
          programar();
        }
      }
    };
    intentarYaRef.current = () => void intentar();

    (async () => {
      try {
        const cliente = await cargarLivekit();
        if (cancelada) {
          return;
        }
        room = new cliente.Room();
        const E = cliente.RoomEvent;
        for (const evento of [
          E.ParticipantConnected,
          E.ParticipantDisconnected,
          E.TrackSubscribed,
          E.TrackUnsubscribed,
          E.TrackMuted,
          E.TrackUnmuted,
          E.LocalTrackPublished,
          E.LocalTrackUnpublished,
          E.TrackPublished,
          E.TrackUnpublished,
          E.ActiveSpeakersChanged,
          E.ParticipantNameChanged,
        ]) {
          if (evento) {
            room.on(evento, repintar);
          }
        }
        room.on(E.AudioPlaybackStatusChanged, () => setSinAudio(!room?.canPlaybackAudio));
        room.on(E.Reconnecting, () => setReconectando(true));
        room.on(E.Reconnected, () => {
          if (caidaDesde === null) {
            setReconectando(false);
          }
        });
        room.on(E.Disconnected, ((motivo?: number | string) => {
          // Al desmontar, o un intento de reconexión que falló (ya hay uno en curso): nada que hacer.
          if (cancelada || caidaDesde !== null) {
            return;
          }
          const voluntaria = salidaVoluntariaRef.current;
          if (!debeReconectar({ motivo, tabla: cliente.DisconnectReason, voluntaria })) {
            salirSinReconectar(voluntaria ? SALIO : textoDeSalida(nombreDelMotivo(motivo, cliente.DisconnectReason)));
            return;
          }
          // Se cayó la conexión: la sala sigue a la vista con «Reconectando…» y vuelve a entrar sola.
          caidaDesde = Date.now();
          intento = 0;
          setReconectando(true);
          repintar();
          programar();
        }) as (...argumentos: never[]) => void);
        room.on(E.DataReceived, ((datos: Uint8Array, participante?: ParticipanteLK, _tipo?: unknown, tema?: string) => {
          if (tema !== TEMA_DEL_CHAT) {
            return;
          }
          try {
            const { texto: recibido } = JSON.parse(new TextDecoder().decode(datos)) as { texto?: string };
            if (!recibido) {
              return;
            }
            setMensajes((anteriores) => [
              ...anteriores,
              { id: `${Date.now()}-${Math.random()}`, de: participante?.name || participante?.identity || "Alguien", texto: recibido.slice(0, 1000), mio: false },
            ]);
            if (!chatAbiertoRef.current) {
              setSinLeer((cuantos) => cuantos + 1);
            }
          } catch {
            // Un mensaje que no se entiende se ignora.
          }
        }) as (...argumentos: never[]) => void);

        await room.connect(pase.url, pase.pase);
        if (cancelada) {
          await room.disconnect();
          return;
        }
        setLk(cliente);
        setRoom(room);
        setEstado("dentro");
        setSinAudio(!room.canPlaybackAudio);
        await prenderMicrofono(room);
        repintar();
      } catch (error) {
        if (!cancelada) {
          setMotivoDeSalida(error instanceof Error && /videollamada/.test(error.message) ? error.message : "No se pudo conectar a la reunión.");
          setEstado("fuera");
        }
      }
    })();

    // Al volver la señal se intenta enseguida, sin esperar el turno.
    const alVolverLaSenal = () => void intentar();
    window.addEventListener("online", alVolverLaSenal);

    return () => {
      cancelada = true;
      window.clearTimeout(temporizador);
      window.removeEventListener("online", alVolverLaSenal);
      intentarYaRef.current = () => undefined;
      detenerReconexionRef.current = () => undefined;
      void room?.disconnect();
    };
  }, [pase.url, pase.pase, repintar]);

  const local = room?.localParticipant;

  // Pantalla encendida mientras está adentro. El navegador la suelta al pasar a segundo plano:
  // se vuelve a pedir al regresar a la pestaña. Si el navegador no lo permite, no pasa nada.
  useEffect(() => {
    if (estado !== "dentro") {
      return;
    }
    let activo = true;
    let candado: WakeLockSentinel | null = null;
    const pedir = async () => {
      if (!activo || document.visibilityState !== "visible" || !navigator.wakeLock || (candado && !candado.released)) {
        return;
      }
      try {
        const nuevo = await navigator.wakeLock.request("screen");
        if (activo) {
          candado = nuevo;
        } else {
          void nuevo.release().catch(() => undefined);
        }
      } catch {
        // Sin permiso o sin batería suficiente: la pantalla se apaga como siempre.
      }
    };
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === "visible") {
        void pedir();
      }
    };
    void pedir();
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    return () => {
      activo = false;
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      void candado?.release().catch(() => undefined);
      candado = null;
    };
  }, [estado]);

  // Se le dice al celular que hay audio en curso, para que no lo corte en segundo plano.
  useEffect(() => {
    if (estado !== "dentro" || !("mediaSession" in navigator)) {
      return;
    }
    try {
      if (typeof MediaMetadata !== "undefined") {
        navigator.mediaSession.metadata = new MediaMetadata({ title: titulo, artist: "Reunión" });
      }
      navigator.mediaSession.playbackState = "playing";
    } catch {
      // Navegador sin Media Session completa: no pasa nada.
    }
    return () => {
      try {
        navigator.mediaSession.playbackState = "none";
        navigator.mediaSession.metadata = null;
      } catch {
        // Igual que arriba.
      }
    };
  }, [estado, titulo]);

  // Al volver a la pestaña (se prende la pantalla o se regresa a la app): si la conexión está caída se
  // intenta ya; si el micrófono quedó terminado o silenciado por el sistema se reinicia; y si el audio de
  // los demás quedó pausado se reanuda (si el navegador no deja, sale «Toca aquí para escuchar…»).
  useEffect(() => {
    if (!room || !lk) {
      return;
    }
    const revisar = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      intentarYaRef.current();
      const pista = room.localParticipant.getTrackPublication(lk.Track.Source.Microphone)?.track;
      const delNavegador = pista?.mediaStreamTrack;
      if (micDeseadoRef.current && pista?.restartTrack && delNavegador && (delNavegador.readyState === "ended" || delNavegador.muted)) {
        try {
          await pista.restartTrack();
        } catch {
          toast.error("El micrófono se apagó. Tócalo para volver a prenderlo.");
        }
      }
      if (!room.canPlaybackAudio) {
        await room.startAudio().catch(() => undefined);
        setSinAudio(!room.canPlaybackAudio);
      }
      repintar();
    };
    const alCambiarVisibilidad = () => void revisar();
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    window.addEventListener("pageshow", alCambiarVisibilidad);
    return () => {
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      window.removeEventListener("pageshow", alCambiarVisibilidad);
    };
  }, [room, lk, repintar]);

  const alternarMicrofono = async () => {
    if (!local) {
      return;
    }
    const prender = !local.isMicrophoneEnabled;
    try {
      await local.setMicrophoneEnabled(prender);
      micDeseadoRef.current = prender;
    } catch {
      toast.error("No se pudo. Revisa el permiso del navegador.");
    }
    repintar();
  };

  const salir = () => {
    salidaVoluntariaRef.current = true;
    // Si estaba reconectando, la sala ya está desconectada y no avisa: se sale acá.
    detenerReconexionRef.current();
    setReconectando(false);
    setMotivoDeSalida(SALIO);
    setEstado("fuera");
    void room?.disconnect();
  };

  const puedeCompartir = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

  const alternarPantalla = async () => {
    if (!local) {
      return;
    }
    try {
      await local.setScreenShareEnabled(!local.isScreenShareEnabled);
    } catch (error) {
      const nombreDelError = error instanceof Error ? error.name : "";
      // Si la persona cancela el permiso no pasa nada.
      if (nombreDelError !== "NotAllowedError" && nombreDelError !== "AbortError") {
        toast.error("No se pudo compartir la pantalla.");
      }
    }
    repintar();
  };

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    const limpio = texto.trim().slice(0, 1000);
    if (!limpio || !local) {
      return;
    }
    try {
      await local.publishData(new TextEncoder().encode(JSON.stringify({ texto: limpio })), { reliable: true, topic: TEMA_DEL_CHAT });
      setMensajes((anteriores) => [...anteriores, { id: `${Date.now()}-yo`, de: pase.nombre, texto: limpio, mio: true }]);
      setTexto("");
    } catch {
      toast.error("No se pudo mandar el mensaje.");
    }
  };

  const terminar = async () => {
    if (!window.confirm("¿Terminar la reunión para todos?")) {
      return;
    }
    setTerminando(true);
    const resultado = await terminarReunionAction(codigo);
    setTerminando(false);
    if (resultado.error) {
      toast.error(resultado.error);
    }
  };

  if (estado === "fuera") {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <div className="max-w-sm space-y-3 text-center">
          <h1 className="text-lg font-semibold">{titulo}</h1>
          <p className="text-sm text-muted-foreground">{motivoDeSalida}</p>
          {motivoDeSalida !== TERMINO ? <Button onClick={onSalir}>Volver a entrar</Button> : null}
        </div>
      </div>
    );
  }

  const participantes: ParticipanteLK[] = room && lk ? [room.localParticipant, ...Array.from(room.remoteParticipants.values())] : [];
  const audios = lk
    ? participantes
        .filter((participante) => !participante.isLocal)
        .flatMap((participante) =>
          Array.from(participante.trackPublications.values()).filter((publicacion) => publicacion.kind === "audio" && publicacion.track),
        )
    : [];

  // Pantalla compartida (de otra persona o la propia): se ve en grande y las personas pasan a una tira.
  const pantalla = lk
    ? participantes
        .map((participante) => ({
          participante,
          publicacion: Array.from(participante.trackPublications.values()).find(
            (item) => item.source === lk.Track.Source.ScreenShare && item.kind === "video" && item.track,
          ),
        }))
        .find((item) => item.publicacion?.track)
    : undefined;

  return (
    <div className="flex h-dvh flex-col bg-neutral-950 text-white">
      <div className="flex shrink-0 items-center bg-neutral-900 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-sm text-white/80">{titulo}</span>
      </div>
      {sinGrabar ? <div className="shrink-0 bg-neutral-800 px-3 py-1 text-xs text-white/70">Esta reunión no se está grabando</div> : null}
      {reconectando ? <div className="shrink-0 bg-amber-600 px-3 py-1 text-xs">Reconectando…</div> : null}
      {sinAudio && room ? (
        <button type="button" onClick={() => void room.startAudio()} className="shrink-0 bg-sky-700 px-3 py-1.5 text-left text-xs">
          Toca aquí para escuchar a los demás
        </button>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1 gap-2 p-2",
            pantalla ? "flex-col md:flex-row" : "flex-col overflow-y-auto",
          )}
        >
          {estado === "conectando" || !lk ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-white/80">
              <Loader2 className="size-4 animate-spin" /> Entrando…
            </div>
          ) : (
            <>
              {pantalla?.publicacion?.track ? (
                <PantallaGrande
                  key={pantalla.publicacion.trackSid}
                  pista={pantalla.publicacion.track}
                  nombre={pantalla.participante.name || pantalla.participante.identity}
                  propia={pantalla.participante.isLocal}
                />
              ) : null}
              <div
                className={cn(
                  pantalla
                    ? "flex h-20 shrink-0 gap-2 overflow-x-auto md:h-auto md:w-44 md:flex-col md:overflow-y-auto md:overflow-x-hidden"
                    : "grid grid-cols-2 gap-2 md:grid-cols-3",
                )}
              >
                {participantes.map((participante) => (
                  <Cuadro key={participante.identity} participante={participante} compacto={!!pantalla} />
                ))}
              </div>
            </>
          )}
          {audios.map((publicacion) => (publicacion.track ? <AudioDePista key={publicacion.trackSid} pista={publicacion.track} /> : null))}
        </div>

        {chatAbierto ? (
          <aside className="absolute inset-x-0 bottom-16 top-9 z-10 flex flex-col border-l border-white/10 bg-neutral-900 md:static md:w-80">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-sm font-medium">
              Chat
              <button type="button" onClick={() => setChatAbierto(false)} aria-label="Cerrar chat" className="rounded p-1 hover:bg-white/10">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2 text-sm">
              {mensajes.length === 0 ? <p className="text-xs text-white/60">Los mensajes del chat no se guardan.</p> : null}
              {mensajes.map((mensaje) => (
                <p key={mensaje.id} className={cn(mensaje.mio && "text-right")}>
                  <span className="block text-xs text-white/60">{mensaje.mio ? "Tú" : mensaje.de}</span>
                  {mensaje.texto}
                </p>
              ))}
            </div>
            <form onSubmit={enviar} className="flex gap-1.5 border-t border-white/10 p-2">
              <Input value={texto} onChange={(evento) => setTexto(evento.target.value)} placeholder="Escribe un mensaje" className="text-foreground" />
              <Button type="submit" size="icon" aria-label="Enviar">
                <Send />
              </Button>
            </form>
          </aside>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center justify-center gap-2 border-t border-white/10 px-2 py-2.5">
        <Button
          size="icon-lg"
          variant={local?.isMicrophoneEnabled ? "secondary" : "destructive"}
          onClick={() => void alternarMicrofono()}
          disabled={!local || reconectando}
          aria-label="Micrófono"
        >
          {local?.isMicrophoneEnabled ? <Mic /> : <MicOff />}
        </Button>
        {puedeCompartir ? (
          <Button
            size="icon-lg"
            variant={local?.isScreenShareEnabled ? "default" : "outline"}
            onClick={() => void alternarPantalla()}
            disabled={!local || reconectando}
            aria-label="Compartir pantalla"
            className={cn(!local?.isScreenShareEnabled && "text-foreground")}
          >
            <MonitorUp />
          </Button>
        ) : null}
        <Button
          size="icon-lg"
          variant={chatAbierto ? "default" : "outline"}
          onClick={() => {
            setChatAbierto((abierto) => !abierto);
            setSinLeer(0);
          }}
          aria-label="Chat"
          className={cn("relative", !chatAbierto && "text-foreground")}
        >
          <MessageSquare />
          {sinLeer ? (
            <span className="absolute -top-1 -right-1 rounded-full bg-red-600 px-1 text-[10px] leading-4 text-white">{sinLeer}</span>
          ) : null}
        </Button>
        <Button size="lg" variant="outline" onClick={salir} className="text-foreground">
          <LogOut /> Salir
        </Button>
        {pase.puedeTerminar ? (
          <Button size="lg" variant="destructive" onClick={() => void terminar()} disabled={terminando} className="bg-red-600 text-white hover:bg-red-700">
            {terminando ? <Loader2 className="animate-spin" /> : <PhoneOff />}
            <span className="hidden sm:inline">Terminar reunión</span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
