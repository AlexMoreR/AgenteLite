"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  LogOut,
  MessageSquare,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Send,
  X,
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

export type PaseDeLaSala = { url: string; pase: string; identidad: string; nombre: string; puedeTerminar: boolean };

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

/** Pega una pista de video (la pantalla compartida) a su elemento mientras está en la sala. */
function VideoDePista({ pista }: { pista: PistaLK }) {
  const video = useRef<HTMLVideoElement>(null);
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
  return <video ref={video} autoPlay playsInline muted className="size-full object-contain" />;
}

function Cuadro({ participante }: { participante: ParticipanteLK }) {
  const nombre = participante.name || participante.identity;
  return (
    <div
      className={cn(
        "relative flex aspect-video min-h-0 items-center justify-center overflow-hidden rounded-lg bg-neutral-800",
        participante.isSpeaking && "ring-2 ring-emerald-400",
      )}
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-neutral-700 text-xl font-semibold text-white">
        {nombre.slice(0, 1).toUpperCase()}
      </span>
      <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
        {participante.isMicrophoneEnabled ? null : <MicOff className="size-3" />}
        {nombre}
        {participante.isLocal ? " (tú)" : ""}
      </span>
    </div>
  );
}

/**
 * Adentro de la reunión: micrófono, compartir pantalla, chat y salir. Sin cámara. La pantalla
 * compartida se ve grande para todos y NO se graba (solo se graba el audio de los micrófonos).
 * Quien la creó, el dueño y los administradores ven
 * "Terminar reunión", que la cierra para todos.
 */
export function SalaDeReunion({
  codigo,
  titulo,
  pase,
  onSalir,
}: {
  codigo: string;
  titulo: string;
  pase: PaseDeLaSala;
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

  const repintar = useCallback(() => setVersion((valor) => valor + 1), []);

  useEffect(() => {
    let cancelada = false;
    let room: SalaLK | null = null;

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
          E.ActiveSpeakersChanged,
          E.ParticipantNameChanged,
        ]) {
          if (evento) {
            room.on(evento, repintar);
          }
        }
        room.on(E.AudioPlaybackStatusChanged, () => setSinAudio(!room?.canPlaybackAudio));
        room.on(E.Reconnecting, () => setReconectando(true));
        room.on(E.Reconnected, () => setReconectando(false));
        room.on(E.Disconnected, ((motivo?: number | string) => {
          const borrada = cliente.DisconnectReason?.ROOM_DELETED;
          setMotivoDeSalida(borrada !== undefined && motivo === borrada ? "La reunión terminó." : "Saliste de la reunión.");
          setEstado("fuera");
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
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
        } catch {
          toast.error("No se pudo usar el micrófono. Revisa el permiso del navegador.");
        }
        repintar();
      } catch (error) {
        if (!cancelada) {
          setMotivoDeSalida(error instanceof Error && /videollamada/.test(error.message) ? error.message : "No se pudo conectar a la reunión.");
          setEstado("fuera");
        }
      }
    })();

    return () => {
      cancelada = true;
      void room?.disconnect();
    };
  }, [pase.url, pase.pase, repintar]);

  const local = room?.localParticipant;

  // Compartir pantalla solo existe en navegadores de PC; en celular el botón no aparece.
  const [puedeCompartir, setPuedeCompartir] = useState(false);
  useEffect(() => {
    setPuedeCompartir(typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function");
  }, []);

  const alternarPantalla = async () => {
    if (!local) {
      return;
    }
    try {
      await local.setScreenShareEnabled(!local.isScreenShareEnabled);
    } catch (error) {
      // Si la persona cancela el permiso no se muestra nada; otro fallo da un aviso corto.
      const nombreDelError = error instanceof Error ? error.name : "";
      if (nombreDelError !== "NotAllowedError" && nombreDelError !== "AbortError") {
        toast.error("No se pudo compartir la pantalla. Revisa el permiso del navegador o del sistema.");
      }
    }
    repintar();
  };

  const alternarMicrofono = async () => {
    if (!local) {
      return;
    }
    try {
      await local.setMicrophoneEnabled(!local.isMicrophoneEnabled);
    } catch {
      toast.error("No se pudo. Revisa el permiso del navegador.");
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
          {motivoDeSalida !== "La reunión terminó." ? <Button onClick={onSalir}>Volver a entrar</Button> : null}
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

  // La pantalla que comparte otra persona se ve grande; la propia se ve en pequeño (aviso).
  const pantalla = lk
    ? participantes
        .filter((participante) => !participante.isLocal)
        .flatMap((participante) => {
          const publicacion = participante.getTrackPublication(lk.Track.Source.ScreenShare);
          return publicacion?.track ? [{ participante, pista: publicacion.track, trackSid: publicacion.trackSid }] : [];
        })[0]
    : undefined;

  return (
    <div className="flex h-dvh flex-col bg-neutral-950 text-white">
      <div className="flex shrink-0 items-center bg-neutral-900 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-sm text-white/80">{titulo}</span>
      </div>
      {reconectando ? <div className="shrink-0 bg-amber-600 px-3 py-1 text-xs">Reconectando…</div> : null}
      {sinAudio && room ? (
        <button type="button" onClick={() => void room.startAudio()} className="shrink-0 bg-sky-700 px-3 py-1.5 text-left text-xs">
          Toca aquí para escuchar a los demás
        </button>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {estado === "conectando" || !lk ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-white/80">
              <Loader2 className="size-4 animate-spin" /> Entrando…
            </div>
          ) : (
            <>
              {pantalla ? (
                <div className="relative min-h-0 flex-1 basis-2/3 overflow-hidden rounded-lg bg-black">
                  <VideoDePista key={pantalla.trackSid} pista={pantalla.pista} />
                  <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-xs">
                    Pantalla de {pantalla.participante.name || pantalla.participante.identity}
                  </span>
                </div>
              ) : null}
              {local?.isScreenShareEnabled ? (
                <div className="shrink-0 rounded bg-sky-800 px-3 py-1.5 text-xs">Estás compartiendo tu pantalla.</div>
              ) : null}
              <div className={cn("grid gap-2", pantalla ? "shrink-0 grid-cols-3 md:grid-cols-6" : "grid-cols-2 md:grid-cols-3")}>
                {participantes.map((participante) => (
                  <Cuadro key={participante.identity} participante={participante} />
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
          disabled={!local}
          aria-label="Micrófono"
        >
          {local?.isMicrophoneEnabled ? <Mic /> : <MicOff />}
        </Button>
        {puedeCompartir ? (
          <Button
            size="icon-lg"
            variant={local?.isScreenShareEnabled ? "default" : "secondary"}
            onClick={() => void alternarPantalla()}
            disabled={!local}
            aria-label={local?.isScreenShareEnabled ? "Dejar de compartir pantalla" : "Compartir pantalla"}
            title={local?.isScreenShareEnabled ? "Dejar de compartir" : "Compartir pantalla"}
          >
            {local?.isScreenShareEnabled ? <MonitorOff /> : <Monitor />}
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
        <Button size="lg" variant="outline" onClick={() => void room?.disconnect()} className="text-foreground">
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
