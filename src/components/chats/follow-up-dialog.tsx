"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Mic, Paperclip, Square, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createChatFollowUpAction } from "@/app/actions/follow-actions";
import { SeguimientosDelCliente } from "@/components/chats/seguimientos-del-cliente";
import { dentroDelHorario, siguienteApertura } from "@/lib/anti-bloqueo/reglas";
import { subirArchivoPorPedazos } from "@/lib/subir-archivo-por-pedazos";
import {
  MAXIMO_DIAS_FECHA_EXACTA,
  ahoraEnBogotaParaInput,
  diaMasHoraDeBogota,
  formatoBogota,
  horaDeBogotaAUtc,
  horaDeBogotaParaInput,
  validarFechaExacta,
} from "@/features/seguimientos/dominio/fecha-exacta";

// Atajos de cuando volver a escribir. Son los tiempos que se usan de verdad al vender: mismo dia,
// al otro dia, o unos dias despues. Sin esto habria que llenar un formulario para cada seguimiento.
// Los de dias llevan ademas la hora (Alex, 11-nov-2026: "fecha y hora"); "En 2 horas" no.
const PRESETS: Array<{ label: string; timeType: "HOURS" | "DAYS"; timeValue: number }> = [
  { label: "En 2 horas", timeType: "HOURS", timeValue: 2 },
  { label: "Mañana", timeType: "DAYS", timeValue: 1 },
  { label: "En 2 días", timeType: "DAYS", timeValue: 2 },
  { label: "En 3 días", timeType: "DAYS", timeValue: 3 },
  { label: "En 1 semana", timeType: "DAYS", timeValue: 7 },
];

// Sexto boton: la asesora escoge dia y hora exactos en el calendario (siempre hora de Colombia).
const OTRA_FECHA = PRESETS.length;
const DIA_MS = 24 * 60 * 60 * 1000;

/*
  Fotos, videos, PDF y notas de voz (Alex, 11-nov-2026: "no solo texto: texto + audio, lo que quiera,
  foto"). Se suben apenas se eligen, a las mismas rutas que usa el chat, asi al Agendar ya estan.
  Salen como en WhatsApp: el texto va debajo de la primera foto, video o PDF; los audios despues
  (lo arma createChatFollowUpAction).
*/
type TipoDeAdjunto = "IMAGE" | "VIDEO" | "DOC" | "AUDIO";
type Adjunto = {
  id: string;
  tipo: TipoDeAdjunto;
  nombre: string;
  vistaPrevia: string | null;
  estado: "subiendo" | "listo" | "error";
  url: string | null;
  motivo: string | null;
};
const MAXIMO_DE_ADJUNTOS = 5;
const RUTA_DE_ARCHIVOS = "/api/cliente/chats/upload-media";
const RUTA_DE_AUDIOS = "/api/cliente/chats/upload-audio";
/** Una nota de menos de esto es un toque sin querer (igual que en el chat). */
const NOTA_MINIMA_BYTES = 2 * 1024;

function tipoDelArchivo(archivo: File): TipoDeAdjunto | null {
  if (archivo.type.startsWith("image/")) return "IMAGE";
  if (archivo.type.startsWith("video/")) return "VIDEO";
  if (archivo.type === "application/pdf" || /\.pdf$/i.test(archivo.name)) return "DOC";
  return null;
}

function duracionTexto(ms: number) {
  const segundos = Math.floor(ms / 1000);
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
}

function nuevoId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Siempre en hora de Colombia, aunque el aparato de la asesora este en otra zona.
function formatWhen(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  return formatoBogota(date);
}

/**
 * "Agendar seguimiento" desde el chat: la asesora elige cuándo y qué mandar (texto, fotos, videos,
 * PDF, notas de voz), y sale solo a esa hora. Si el cliente responde antes, se cancela (no lo
 * perseguimos).
 */
export function FollowUpDialog({
  open,
  onClose,
  contactId,
}: {
  open: boolean;
  onClose: () => void;
  contactId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // "Ver seguimientos" (Alex, 11-nov-2026): la misma ventana muestra los de este cliente.
  const [vista, setVista] = useState<"agendar" | "lista">("agendar");
  const [presetIndex, setPresetIndex] = useState(1);
  const [content, setContent] = useState("");
  const [fechaExacta, setFechaExacta] = useState("");
  // La hora de los atajos de dias. Arranca en la hora de ahora (lo que hacian antes); se cambia.
  const [hora, setHora] = useState("");
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([]);
  const [grabandoDesde, setGrabandoDesde] = useState<number | null>(null);
  const [ahoraGrabando, setAhoraGrabando] = useState(0);
  // El horario de envíos del negocio: fuera de él, el seguimiento sale en la próxima apertura.
  const [horario, setHorario] = useState<{ activo: boolean; desdeHora: number; hastaHora: number } | null>(null);
  const grabadoraRef = useRef<MediaRecorder | null>(null);
  const selectorRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setVista("agendar");
      setPresetIndex(1);
      setContent("");
      setFechaExacta("");
      setHora(horaDeBogotaParaInput(new Date()));
      setAdjuntos([]);
      setGrabandoDesde(null);
      return;
    }
    // Al cerrar: se corta la grabacion (sin guardarla) y se suelta el microfono.
    const grabadora = grabadoraRef.current;
    if (grabadora && grabadora.state !== "inactive") {
      grabadora.onstop = null;
      grabadora.stop();
      grabadora.stream.getTracks().forEach((pista) => pista.stop());
    }
    grabadoraRef.current = null;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let vivo = true;
    fetch("/api/cliente/chats/seguimientos?solo=horario", { cache: "no-store" })
      .then((respuesta) => respuesta.json())
      .then((datos: { horario?: { activo: boolean; desdeHora: number; hastaHora: number } }) => {
        if (vivo && datos?.horario) setHorario(datos.horario);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [open]);

  useEffect(() => {
    if (grabandoDesde === null) return;
    const intervalo = window.setInterval(() => setAhoraGrabando(Date.now()), 250);
    return () => window.clearInterval(intervalo);
  }, [grabandoDesde]);

  const actualizarAdjunto = (id: string, cambio: Partial<Adjunto>) =>
    setAdjuntos((lista) => lista.map((adjunto) => (adjunto.id === id ? { ...adjunto, ...cambio } : adjunto)));

  const subirAdjunto = async (adjunto: Adjunto, archivo: File) => {
    try {
      if (adjunto.tipo === "AUDIO") {
        // La misma ruta que la nota de voz del chat: la deja en un formato que WhatsApp reproduce.
        const formData = new FormData();
        formData.append("file", archivo);
        const respuesta = await fetch(RUTA_DE_AUDIOS, { method: "POST", body: formData });
        const datos = (await respuesta.json().catch(() => null)) as { url?: string; error?: string } | null;
        if (!respuesta.ok || !datos?.url) {
          actualizarAdjunto(adjunto.id, { estado: "error", motivo: datos?.error || "No se pudo subir el audio" });
          return;
        }
        actualizarAdjunto(adjunto.id, { estado: "listo", url: datos.url });
        return;
      }
      const resultado = await subirArchivoPorPedazos({ file: archivo, endpoint: `${RUTA_DE_ARCHIVOS}/chunk` });
      if (!resultado.archivo) {
        actualizarAdjunto(adjunto.id, { estado: "error", motivo: resultado.error || "No se pudo subir" });
        return;
      }
      actualizarAdjunto(adjunto.id, { estado: "listo", url: resultado.archivo.url });
    } catch {
      actualizarAdjunto(adjunto.id, { estado: "error", motivo: "No se pudo subir" });
    }
  };

  const agregarArchivos = (lista: FileList | null) => {
    if (!lista?.length) return;
    const libres = Math.max(0, MAXIMO_DE_ADJUNTOS - adjuntos.length);
    const archivos = Array.from(lista);
    if (archivos.length > libres) {
      toast.error(`Puedes adjuntar hasta ${MAXIMO_DE_ADJUNTOS} archivos`);
    }
    const nuevos: Array<{ adjunto: Adjunto; archivo: File }> = [];
    for (const archivo of archivos.slice(0, libres)) {
      const tipo = tipoDelArchivo(archivo);
      if (!tipo) {
        toast.error(`"${archivo.name}" no es foto, video ni PDF`);
        continue;
      }
      nuevos.push({
        archivo,
        adjunto: {
          id: nuevoId(),
          tipo,
          nombre: archivo.name,
          vistaPrevia: tipo === "IMAGE" || tipo === "VIDEO" ? URL.createObjectURL(archivo) : null,
          estado: "subiendo",
          url: null,
          motivo: null,
        },
      });
    }
    if (!nuevos.length) return;
    setAdjuntos((actual) => [...actual, ...nuevos.map((item) => item.adjunto)]);
    for (const item of nuevos) void subirAdjunto(item.adjunto, item.archivo);
  };

  const empezarAGrabar = async () => {
    if (grabadoraRef.current || adjuntos.length >= MAXIMO_DE_ADJUNTOS) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Este navegador no deja grabar audio");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const grabadora = new MediaRecorder(stream);
      const pedazos: BlobPart[] = [];
      const inicio = Date.now();
      grabadora.ondataavailable = (evento) => {
        if (evento.data.size > 0) pedazos.push(evento.data);
      };
      grabadora.onstop = () => {
        stream.getTracks().forEach((pista) => pista.stop());
        grabadoraRef.current = null;
        setGrabandoDesde(null);
        const mime = (grabadora.mimeType || "audio/webm").split(";")[0].trim() || "audio/webm";
        const grabado = new Blob(pedazos, { type: mime });
        if (grabado.size < NOTA_MINIMA_BYTES) {
          toast.error("La nota de voz quedó vacía. Graba un poco más.");
          return;
        }
        const ext = mime.includes("ogg") || mime.includes("opus") ? "ogg" : mime.includes("mp4") ? "mp4" : "webm";
        const archivo = new File([grabado], `nota-de-voz-${Date.now()}.${ext}`, { type: mime });
        const adjunto: Adjunto = {
          id: nuevoId(),
          tipo: "AUDIO",
          nombre: `Nota de voz · ${duracionTexto(Date.now() - inicio)}`,
          vistaPrevia: URL.createObjectURL(archivo),
          estado: "subiendo",
          url: null,
          motivo: null,
        };
        setAdjuntos((actual) => [...actual, adjunto]);
        void subirAdjunto(adjunto, archivo);
      };
      grabadoraRef.current = grabadora;
      grabadora.start();
      setGrabandoDesde(inicio);
      setAhoraGrabando(inicio);
    } catch {
      toast.error("No se pudo usar el micrófono. Revisa el permiso del navegador.");
    }
  };

  const terminarDeGrabar = () => {
    const grabadora = grabadoraRef.current;
    if (grabadora && grabadora.state !== "inactive") grabadora.stop();
  };

  const quitarAdjunto = (id: string) => {
    setAdjuntos((lista) => {
      const quitado = lista.find((adjunto) => adjunto.id === id);
      if (quitado?.vistaPrevia) URL.revokeObjectURL(quitado.vistaPrevia);
      return lista.filter((adjunto) => adjunto.id !== id);
    });
  };

  const esOtraFecha = presetIndex === OTRA_FECHA;
  const presetElegido = esOtraFecha ? null : PRESETS[presetIndex];
  const llevaHora = presetElegido?.timeType === "DAYS";
  const ahora = new Date();
  // Atajo de dias + hora = una fecha exacta en hora de Colombia. "En 2 horas" sigue siendo relativo.
  const fechaDelAtajo =
    llevaHora && presetElegido && /^\d{2}:\d{2}$/.test(hora) ? diaMasHoraDeBogota(ahora, presetElegido.timeValue, hora) : null;
  const textoDeFecha = esOtraFecha ? fechaExacta : (fechaDelAtajo ?? "");
  const fechaElegida = textoDeFecha ? horaDeBogotaAUtc(textoDeFecha) : null;
  const validacion = fechaElegida ? validarFechaExacta(fechaElegida, ahora) : null;
  const fechaValida = Boolean(fechaElegida && validacion?.ok);
  const faltaFecha = (esOtraFecha || llevaHora) && !fechaValida;
  const subiendo = adjuntos.some((adjunto) => adjunto.estado === "subiendo");
  const conError = adjuntos.some((adjunto) => adjunto.estado === "error");
  const listos = adjuntos.filter((adjunto) => adjunto.estado === "listo" && adjunto.url);
  const faltaMensaje = content.trim().length < 2 && listos.length === 0;
  const grabando = grabandoDesde !== null;
  // Cuándo sale DE VERDAD: si la hora elegida cae fuera del horario de envíos, en la próxima apertura
  // (antes la ventana decía "sale a las 9:36 p. m." y salía a la mañana siguiente).
  const fechaDeEnvio = presetElegido && !llevaHora ? new Date(ahora.getTime() + presetElegido.timeValue * 3_600_000) : fechaElegida;
  const saleRealmente =
    horario?.activo && fechaDeEnvio && (!llevaHora && !esOtraFecha ? true : fechaValida) && !dentroDelHorario(fechaDeEnvio, horario)
      ? siguienteApertura(fechaDeEnvio, horario)
      : null;
  const horaCorta = (hora24: number) => (hora24 === 0 || hora24 === 24 ? "12 a. m." : hora24 === 12 ? "12 m." : hora24 < 12 ? `${hora24} a. m.` : `${hora24 - 12} p. m.`);

  const handleSave = () => {
    if (!contactId) {
      toast.error("No se pudo identificar el contacto.");
      return;
    }
    if (faltaFecha || faltaMensaje || subiendo || conError || grabando) {
      return;
    }
    const preset = esOtraFecha || llevaHora ? null : PRESETS[presetIndex];
    const adjuntosListos = listos.map((adjunto) => ({ tipo: adjunto.tipo, url: adjunto.url as string }));
    startTransition(async () => {
      const result = await createChatFollowUpAction(
        preset
          ? { contactId, timeType: preset.timeType, timeValue: preset.timeValue, content, adjuntos: adjuntosListos }
          : // El schema exige timeType/timeValue; con fechaExacta el servidor los ignora.
            { contactId, timeType: "MINUTES", timeValue: 1, content, fechaExacta: textoDeFecha, adjuntos: adjuntosListos },
      );
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const when = formatWhen(result.executeAt);
      toast.success(when ? `Seguimiento agendado para el ${when}` : "Seguimiento agendado");
      onClose();
      router.refresh();
    });
  };

  const botonDeAtajo = (activo: boolean) =>
    `rounded-full border px-3 py-1.5 text-[13px] transition ${
      activo ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-foreground hover:bg-muted"
    }`;

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-md grid-cols-[minmax(0,1fr)] overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          {/*
            Sin bajada: decia lo mismo que la nota del final ("si el cliente escribe antes, el
            seguimiento se cancela solo"), asi que era la misma frase dos veces en una ventana
            que se abre para hacer una cosa rapida.
          */}
          <div className="flex min-w-0 items-center justify-between gap-2 pr-8">
            <DialogTitle>{vista === "lista" ? "Seguimientos del cliente" : "Agendar seguimiento"}</DialogTitle>
            <button
              type="button"
              onClick={() => setVista(vista === "lista" ? "agendar" : "lista")}
              disabled={grabando}
              className="shrink-0 rounded-full px-2.5 py-1 text-[13px] font-medium text-primary transition hover:bg-primary/10 disabled:opacity-50"
            >
              {vista === "lista" ? "Agendar uno" : "Ver seguimientos"}
            </button>
          </div>
        </DialogHeader>

        {vista === "lista" ? <SeguimientosDelCliente contactId={contactId} /> : null}

        <div className={vista === "lista" ? "hidden" : "min-w-0 space-y-3"}>
          <div className="space-y-1.5">
            <Label>¿Cuándo?</Label>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((preset, index) => (
                <button key={preset.label} type="button" onClick={() => setPresetIndex(index)} className={botonDeAtajo(index === presetIndex)}>
                  {preset.label}
                </button>
              ))}
              <button type="button" onClick={() => setPresetIndex(OTRA_FECHA)} className={botonDeAtajo(esOtraFecha)}>
                Otra fecha
              </button>
            </div>
            {llevaHora ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-muted-foreground">A las</span>
                  <input
                    type="time"
                    value={hora}
                    onChange={(evento) => setHora(evento.target.value)}
                    className="h-9 min-w-0 rounded-xl border border-border bg-card px-2.5 text-[13px] text-foreground outline-none"
                    aria-label="Hora del seguimiento (hora de Colombia)"
                  />
                </div>
                {fechaElegida && validacion?.ok ? (
                  <p className="text-[12px] text-muted-foreground">Sale el {formatoBogota(fechaElegida)} (hora de Colombia)</p>
                ) : (
                  <p className="text-[12px] text-destructive">Escoge la hora</p>
                )}
              </div>
            ) : null}
            {esOtraFecha ? (
              <div className="space-y-1">
                <input
                  type="datetime-local"
                  value={fechaExacta}
                  onChange={(evento) => setFechaExacta(evento.target.value)}
                  min={ahoraEnBogotaParaInput(ahora)}
                  max={ahoraEnBogotaParaInput(new Date(ahora.getTime() + MAXIMO_DIAS_FECHA_EXACTA * DIA_MS))}
                  className="h-9 w-full min-w-0 rounded-xl border border-border bg-card px-2.5 text-[13px] text-foreground outline-none"
                  aria-label="Fecha y hora del seguimiento (hora de Colombia)"
                />
                {fechaElegida && validacion?.ok ? (
                  <p className="text-[12px] text-muted-foreground">
                    Sale el {formatoBogota(fechaElegida)} (hora de Colombia)
                  </p>
                ) : validacion && !validacion.ok ? (
                  <p className="text-[12px] text-destructive">
                    {validacion.motivo === "pasada"
                      ? "Escoge una fecha y hora que todavía no haya pasado"
                      : `Escoge una fecha dentro de los próximos ${MAXIMO_DIAS_FECHA_EXACTA} días`}
                  </p>
                ) : fechaExacta ? (
                  <p className="text-[12px] text-destructive">Escoge una fecha y hora completas</p>
                ) : null}
              </div>
            ) : null}
          </div>

          {saleRealmente && horario ? (
            <p className="rounded-lg bg-amber-100 px-3 py-2 text-[12px] text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
              Esa hora es fuera del horario de envíos ({horaCorta(horario.desdeHora)} a {horaCorta(horario.hastaHora)}). Sale el{" "}
              <span className="font-medium">{formatoBogota(saleRealmente)}</span>, o hasta 30 minutos después.
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="followUpContent">Mensaje que se va a enviar</Label>
            <Textarea
              id="followUpContent"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={4}
              placeholder="Ej. Hola 😊 ¿Pudiste ver las fotos del combo? Quedo atenta."
            />
          </div>

          <div className="space-y-1.5">
            {adjuntos.length ? (
              <ul className="min-w-0 space-y-1.5">
                {adjuntos.map((adjunto) => (
                  <li key={adjunto.id} className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card p-1.5">
                    <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                      {adjunto.tipo === "IMAGE" && adjunto.vistaPrevia ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={adjunto.vistaPrevia} alt="" className="size-full object-cover" />
                      ) : adjunto.tipo === "VIDEO" && adjunto.vistaPrevia ? (
                        <video src={adjunto.vistaPrevia} muted playsInline className="size-full object-cover" />
                      ) : adjunto.tipo === "AUDIO" ? (
                        <Mic className="size-5 text-muted-foreground" />
                      ) : (
                        <FileText className="size-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-foreground">{adjunto.nombre}</p>
                      <p className={`text-[12px] ${adjunto.estado === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                        {adjunto.estado === "subiendo" ? "Subiendo…" : adjunto.estado === "error" ? adjunto.motivo || "No se pudo subir" : "Listo"}
                      </p>
                      {adjunto.tipo === "AUDIO" && adjunto.vistaPrevia ? (
                        <audio src={adjunto.vistaPrevia} controls preload="metadata" className="mt-1 block h-8 w-full min-w-0 max-w-full" />
                      ) : null}
                    </div>
                    {adjunto.estado === "subiendo" ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : null}
                    <button
                      type="button"
                      onClick={() => quitarAdjunto(adjunto.id)}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                      aria-label={`Quitar ${adjunto.nombre}`}
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <input
              ref={selectorRef}
              type="file"
              accept="image/*,video/*,application/pdf"
              multiple
              className="hidden"
              onChange={(evento) => {
                agregarArchivos(evento.target.files);
                evento.target.value = "";
              }}
            />
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => selectorRef.current?.click()}
                disabled={adjuntos.length >= MAXIMO_DE_ADJUNTOS || grabando}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[13px] text-foreground transition hover:bg-muted disabled:opacity-50"
              >
                <Paperclip className="size-4" />
                Foto, video o PDF
              </button>
              {grabando ? (
                <button
                  type="button"
                  onClick={terminarDeGrabar}
                  className="inline-flex items-center gap-1.5 rounded-full border border-destructive bg-destructive/10 px-3 py-1.5 text-[13px] font-medium text-destructive"
                >
                  <Square className="size-3.5 fill-current" />
                  Terminar · {duracionTexto(Math.max(0, ahoraGrabando - (grabandoDesde ?? ahoraGrabando)))}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void empezarAGrabar()}
                  disabled={adjuntos.length >= MAXIMO_DE_ADJUNTOS}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[13px] text-foreground transition hover:bg-muted disabled:opacity-50"
                >
                  <Mic className="size-4" />
                  Grabar audio
                </button>
              )}
            </div>
            {listos.some((adjunto) => adjunto.tipo !== "AUDIO") && content.trim() ? (
              <p className="text-[12px] text-muted-foreground">El texto sale debajo de la primera foto, video o PDF.</p>
            ) : null}
          </div>

          <p className="rounded-lg bg-muted px-3 py-2 text-[12px] text-muted-foreground">
            Si el cliente escribe antes de esa fecha, el seguimiento se cancela solo.
          </p>
        </div>

        <DialogFooter className={vista === "lista" ? "hidden" : undefined}>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isPending || faltaMensaje || faltaFecha || subiendo || conError || grabando}>
            {isPending ? "Agendando…" : subiendo ? "Subiendo…" : "Agendar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
