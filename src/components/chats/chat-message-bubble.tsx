"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  Facebook,
  Download,
  Forward,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Pencil,
  Pin,
  MoreVertical,
  Reply,
  RotateCcw,
  Star,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { extractEvolutionLocation } from "@/lib/evolution-webhook";
import { tapaDePdfDesdeUrl, type TapaDePdf } from "@/lib/portada-de-pdf";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { reaccionarAlMensajeAction, recuperarArchivoPerdidoAction } from "@/app/actions/chats-actions";
import type { SharedInboxMessageItem } from "./chat-inbox-types";
import {
  chatDateFormatter,
  formatChatTime,
  formatActivityDate,
  formatDateDivider,
  isActivityMessage,
  getMediaPreviewLabel,
  getCallMessageSummary,
} from "./chat-inbox-format";
import {
  isMediaSourceUrl,
  toProxiedMediaUrl,
  extractMediaUrlFromPayload,
  formatDocumentSize,
  getDocumentIcon,
  getDocumentMetaFromMessage,
  collectImagePreviewUrls,
  extractChatAdPreview,
  extraerVistaPreviaDeEnlace,
} from "./chat-inbox-media";

/*
  Los enlaces que llegan en un mensaje se pueden tocar.

  Se veian como texto negro cualquiera: nadie sabia que eran un enlace y tocarlos no hacia nada.
  Los clientes mandan links todo el tiempo -un video de Facebook, una publicacion, una ubicacion- y
  la asesora tenia que copiarlo a mano y pegarlo en el navegador.

  Azul y subrayado, como WhatsApp. Se probo primero con el color del texto -por miedo a que un azul
  fijo se viera mal sobre el verde de la burbuja saliente- y no: se leen bien en las dos, y el azul
  es lo que la gente reconoce como "esto se toca".
*/
const ENLACE = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

function enlazar(texto: string, claveBase: string) {
  return texto.split(ENLACE).map((trozo, indice) => {
    if (!trozo) {
      return null;
    }
    const clave = `${claveBase}-${indice}`;
    if (!/^(https?:\/\/|www\.)/i.test(trozo)) {
      return <span key={clave}>{trozo}</span>;
    }

    /*
      La puntuacion del final no es parte del enlace.

      "mira esto https://sitio.com/algo." o "(https://sitio.com)": si se la deja adentro, el enlace
      se abre roto. Se corta y se muestra aparte, como texto.
    */
    const cola = trozo.match(/[).,;:!?"»']+$/)?.[0] ?? "";
    const limpio = cola ? trozo.slice(0, -cola.length) : trozo;
    const destino = /^www\./i.test(limpio) ? `https://${limpio}` : limpio;

    return (
      <span key={clave}>
        <a
          href={destino}
          target="_blank"
          rel="noreferrer noopener"
          // La burbuja escucha clics (abrir la foto, responder): sin esto, tocar el enlace
          // dispararia tambien eso.
          onClick={(evento) => evento.stopPropagation()}
          className="break-all text-blue-600 underline underline-offset-2 dark:text-blue-400"
        >
          {limpio}
        </a>
        {cola}
      </span>
    );
  });
}

function renderWhatsAppText(content: string) {
  const parts = content.split(/(\*[^*\n]+\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return (
        <strong key={`${part}-${index}`} className="font-semibold">
          {enlazar(part.slice(1, -1), `b-${index}`)}
        </strong>
      );
    }

    return <span key={`${part}-${index}`}>{enlazar(part, `t-${index}`)}</span>;
  });
}

function renderMessageText(content?: string | null, className = "") {
  if (!content?.trim()) {
    return null;
  }

  return <p className={`whitespace-pre-wrap break-words ${className}`}>{renderWhatsAppText(content)}</p>;
}

function AudioMessageCard({
  mediaUrl,
  content,
}: {
  mediaUrl: string;
  content: string | null;
}) {
  return (
    <div className="w-[280px] max-w-full space-y-2">
      <audio
        src={mediaUrl}
        controls
        preload="metadata"
        className="block w-full min-w-0 rounded-xl"
      />

      {renderMessageText(content)}
    </div>
  );
}

const subscribeNoop = () => () => {};
const getMountedClient = () => true;
const getMountedServer = () => false;

// Extrae el preview de una cita (Responder): para mensajes propios usa el `replyTo`
// que guardamos al enviar; para entrantes lee la cita de WhatsApp (contextInfo).
function getMessageReplyPreview(message: SharedInboxMessageItem): { author: string; text: string } | null {
  const raw = message.rawPayload;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;

  const replyTo = record.replyTo;
  if (replyTo && typeof replyTo === "object") {
    const r = replyTo as Record<string, unknown>;
    const text = typeof r.content === "string" ? r.content.trim() : "";
    return { author: r.direction === "OUTBOUND" ? "Tú" : "Cliente", text: text || "Mensaje" };
  }

  const evolution = record.evolution as Record<string, unknown> | undefined;
  const data = evolution?.data as Record<string, unknown> | undefined;
  const msg = data?.message as Record<string, unknown> | undefined;
  if (msg) {
    for (const value of Object.values(msg)) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const ctx = (value as Record<string, unknown>).contextInfo as Record<string, unknown> | undefined;
      const quoted = ctx?.quotedMessage as Record<string, unknown> | undefined;
      if (!quoted) {
        continue;
      }
      const ext = quoted.extendedTextMessage as Record<string, unknown> | undefined;
      const text =
        (typeof quoted.conversation === "string" && quoted.conversation) ||
        (ext && typeof ext.text === "string" ? ext.text : "") ||
        "";
      if (text) {
        return { author: "", text: text.trim() };
      }
    }
  }
  return null;
}

function copyMessageText(message: SharedInboxMessageItem) {
  const text = (message.content ?? "").trim();
  if (!text) {
    toast.info("Este mensaje no tiene texto para copiar");
    return;
  }
  if (!navigator.clipboard?.writeText) {
    toast.error("Tu navegador no permite copiar");
    return;
  }
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success("Mensaje copiado"))
    .catch(() => toast.error("No se pudo copiar el mensaje"));
}

// En el celular no hay hover: la flecha del menu nunca aparece. Igual que en
// WhatsApp, se mantiene apretada la burbuja y sube la hoja de acciones.
const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE = 10;

function useLongPress(onLongPress: () => void, enabled: boolean) {
  const timerRef = useRef<number | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  // Un long press termina en "click" cuando el dedo se levanta: hay que tragarselo
  // o abrir la hoja tambien abriria la foto / el documento de abajo.
  const firedRef = useRef(false);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Solo dedo: con mouse manda el menu de hover de siempre.
      if (!enabled || event.pointerType !== "touch" || !event.isPrimary) {
        return;
      }
      cancel();
      firedRef.current = false;
      originRef.current = { x: event.clientX, y: event.clientY };
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        originRef.current = null;
        firedRef.current = true;
        onLongPress();
      }, LONG_PRESS_MS);
    },
    [cancel, enabled, onLongPress],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      const origin = originRef.current;
      if (!origin) {
        return;
      }
      // Si el dedo se movio, estaba scrolleando la conversacion, no apretando.
      if (
        Math.abs(event.clientX - origin.x) > LONG_PRESS_MOVE_TOLERANCE ||
        Math.abs(event.clientY - origin.y) > LONG_PRESS_MOVE_TOLERANCE
      ) {
        cancel();
      }
    },
    [cancel],
  );

  const handleClickCapture = useCallback((event: React.MouseEvent) => {
    if (!firedRef.current) {
      return;
    }
    firedRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    // Android abre su propio menu de seleccion al mantener apretado: estorba.
    if (originRef.current || firedRef.current) {
      event.preventDefault();
    }
  }, []);

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: handleClickCapture,
    onContextMenu: handleContextMenu,
  };
}

/**
 * La tarjeta de un PDF, con la primera hoja a la vista.
 *
 * Como en WhatsApp: arriba el principio de la pagina 1, abajo el nombre y "2 paginas - 395 kB -
 * PDF". Un icono rojo igual para todos obliga a abrir uno por uno; con la hoja a la vista, una
 * tanda de hojas de vida se reconoce de un vistazo.
 *
 * La tapa se dibuja EN EL NAVEGADOR y solo cuando la burbuja llega a la pantalla: pdf.js pesa y el
 * archivo hay que bajarlo entero para dibujarlo. Un chat con veinte PDF mas arriba no se baja
 * veinte archivos al abrirlo; se bajan los que se miran. Mientras tanto -y si el PDF esta roto,
 * protegido o pesa demasiado- se ve la tarjeta de siempre, que nunca falla.
 */
function TarjetaDePdf({
  url,
  nombre,
  etiquetaDeTamano,
  outbound,
}: {
  url: string;
  nombre: string;
  etiquetaDeTamano: string | null;
  outbound: boolean;
}) {
  const contenedorRef = useRef<HTMLAnchorElement | null>(null);
  const [tapa, setTapa] = useState<TapaDePdf | null>(null);
  const [esTactil, setEsTactil] = useState(false);

  /*
    En el celular el PDF se lo queda el TELEFONO; en computadora se abre en otra pestaña.

    Son dos formas distintas de leer lo mismo. En el escritorio, otra pestaña con el visor del
    navegador es lo comodo: se lee al lado del chat y se cierra. En el telefono no: ahi la gente
    ya tiene su lector -es el que le sale a WhatsApp en "Abrir con"- y es el que sabe hacer zoom
    con los dedos, pasar hojas y compartir. `download` es lo unico que la web puede hacer para
    llegar a eso: el archivo baja y el telefono ofrece abrirlo con lo que uno tenga.
  */
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const consulta = window.matchMedia("(pointer: coarse)");
    const anotar = () => setEsTactil(consulta.matches);
    anotar();
    consulta.addEventListener("change", anotar);
    return () => consulta.removeEventListener("change", anotar);
  }, []);

  useEffect(() => {
    const elemento = contenedorRef.current;
    if (!elemento) {
      return;
    }

    let vivo = true;
    const dibujar = () => {
      void tapaDePdfDesdeUrl(url).then((resultado) => {
        if (vivo && resultado) {
          setTapa(resultado);
        }
      });
    };

    // Sin IntersectionObserver (navegadores viejos) se dibuja de una: mejor gastar datos que
    // dejar la tarjeta muda para siempre.
    if (typeof IntersectionObserver === "undefined") {
      dibujar();
      return () => {
        vivo = false;
      };
    }

    /*
      Con margen de una pantalla: la tapa tarda un momento en dibujarse, asi que se empieza ANTES
      de que la burbuja se vea. Si se esperara al pixel exacto, uno la vería aparecer ya estando
      ahi, que se siente como una falla.
    */
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((entrada) => entrada.isIntersecting)) {
          observador.disconnect();
          dibujar();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observador.observe(elemento);

    return () => {
      vivo = false;
      observador.disconnect();
    };
  }, [url]);

  // El peso que manda WhatsApp gana: es el del archivo original. El nuestro sale de lo que se
  // bajo, y solo existe cuando la tapa ya se dibujo.
  const tamano = etiquetaDeTamano ?? formatDocumentSize(tapa?.bytes ?? null);
  const detalle = [
    tapa ? `${tapa.paginas} ${tapa.paginas === 1 ? "página" : "páginas"}` : null,
    tamano,
    "PDF",
  ]
    .filter(Boolean)
    .join(" • ");

  return (
    <a
      ref={contenedorRef}
      href={url}
      target="_blank"
      rel="noreferrer"
      // Con `download` el navegador ignora el target y guarda el archivo: es lo que hace que el
      // telefono saque su "Abrir con".
      download={esTactil ? nombre : undefined}
      title={nombre}
      className={`block w-[min(250px,70vw)] overflow-hidden rounded-xl transition ${
        outbound
          ? "bg-[var(--chat-out-overlay)] hover:bg-[var(--chat-out-overlay-strong)]"
          : "bg-background hover:bg-muted"
      }`}
    >
      {tapa ? (
        /*
          Recortada por arriba y no encogida entera: lo que identifica una hoja de vida es el
          nombre y la foto, que estan en los primeros centimetros. Una hoja A4 completa a este
          tamano no se lee.
        */
        <span className="block h-[128px] w-full overflow-hidden bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={tapa.imagen}
            alt={`Primera página de ${nombre}`}
            decoding="async"
            className="h-full w-full object-cover object-top"
          />
        </span>
      ) : null}

      <span className="flex items-center gap-2 p-1.5 pr-2.5">
        {tapa ? null : (
          <>
            {(() => {
              const { Icon, color } = getDocumentIcon("PDF");
              return <Icon className="size-8 shrink-0" style={{ color }} />;
            })()}
          </>
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={`truncate text-[13px] font-normal leading-tight ${
              outbound ? "text-[var(--chat-out-text)]" : "text-foreground"
            }`}
          >
            {nombre}
          </span>
          <span
            className={`truncate text-[11px] leading-tight ${
              outbound ? "text-[var(--chat-out-text-faint)]" : "text-muted-foreground"
            }`}
          >
            {detalle}
          </span>
        </span>
        {tapa ? (
          <Download
            className={`size-4 shrink-0 ${
              outbound ? "text-[var(--chat-out-text-faint)]" : "text-muted-foreground"
            }`}
          />
        ) : null}
      </span>
    </a>
  );
}

/*
  Los seis de WhatsApp, en el mismo orden.

  Son los que la gente ya tiene en el dedo: reconocerlos es mas rapido que leerlos. El septimo
  -el "+"- no esta todavia; con estos se cubre casi todo, y un selector completo de emojis en el
  celular es otra pantalla.
*/
const EMOJIS_DE_REACCION = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

/**
 * La fila de emoticones que aparece sobre la burbuja.
 *
 * Reacciona de verdad: se manda a WhatsApp y el cliente la ve en su telefono. Tocando el mismo
 * emoji que ya estaba, se quita -asi funciona WhatsApp, y es lo que uno intenta sin pensarlo-.
 */
function FilaDeReacciones({
  message,
  onDone,
}: {
  message: SharedInboxMessageItem;
  onDone?: () => void;
}) {
  const [enviando, setEnviando] = useState<string | null>(null);

  const reaccionar = (emoji: string) => {
    const quitar = message.reactionEmoji === emoji;
    setEnviando(emoji);
    void reaccionarAlMensajeAction({ messageId: message.id, emoji: quitar ? "" : emoji })
      .then((resultado) => {
        if (!resultado?.ok) {
          toast.error(resultado?.error ?? "No se pudo reaccionar");
          return;
        }
        onDone?.();
      })
      .catch(() => toast.error("No se pudo reaccionar"))
      .finally(() => setEnviando(null));
  };

  return (
    <div className="flex items-center justify-center gap-1 px-2 py-1.5">
      {EMOJIS_DE_REACCION.map((emoji) => {
        const puesto = message.reactionEmoji === emoji;
        return (
          <button
            key={emoji}
            type="button"
            disabled={enviando !== null}
            onClick={() => reaccionar(emoji)}
            aria-label={puesto ? `Quitar ${emoji}` : `Reaccionar con ${emoji}`}
            aria-pressed={puesto}
            className={`inline-flex size-10 items-center justify-center rounded-full text-[22px] leading-none transition active:scale-95 disabled:opacity-50 ${
              puesto ? "bg-primary/15" : "hover:bg-muted"
            }`}
          >
            {enviando === emoji ? <LoaderCircle className="size-4 animate-spin" /> : emoji}
          </button>
        );
      })}
    </div>
  );
}

function MessageTouchActionsSheet({
  message,
  open,
  onOpenChange,
  onReply,
  onForward,
  onDelete,
}: {
  message: SharedInboxMessageItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReply?: (message: SharedInboxMessageItem) => void;
  onForward?: (message: SharedInboxMessageItem) => void;
  onDelete?: (message: SharedInboxMessageItem) => void;
}) {
  // Se cierra primero y despues se actua: Eliminar levanta un confirm() del
  // navegador y pelearia con el foco atrapado de la hoja.
  const run = (action?: () => void) => () => {
    onOpenChange(false);
    if (action) {
      window.setTimeout(action, 10);
    }
  };

  const preview = (message.content ?? "").trim() || getMediaPreviewLabel(message.type) || "Mensaje";

  const acciones = [
    { label: "Responder", icon: Reply, onClick: onReply ? () => onReply(message) : undefined },
    { label: "Reenviar", icon: Forward, onClick: onForward ? () => onForward(message) : undefined },
    { label: "Copiar", icon: Copy, onClick: () => copyMessageText(message) },
    { label: "Eliminar", icon: Trash2, onClick: onDelete ? () => onDelete(message) : undefined, destructive: true },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="gap-0 rounded-t-2xl pb-[max(env(safe-area-inset-bottom),0.75rem)]"
      >
        <SheetTitle className="sr-only">Opciones del mensaje</SheetTitle>
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-border" />
        {/* Las reacciones van ARRIBA de la lista, como en WhatsApp: es lo que mas se usa. */}
        <FilaDeReacciones message={message} onDone={() => onOpenChange(false)} />
        <p className="truncate border-t border-border px-4 pb-2 pt-3 text-xs text-muted-foreground">
          {preview}
        </p>
        <div className="border-t border-border">
          {acciones.map(({ label, icon: Icon, onClick, destructive }) => (
            <button
              key={label}
              type="button"
              disabled={!onClick}
              onClick={run(onClick)}
              className={`flex w-full items-center gap-3 px-4 py-3.5 text-left text-[15px] active:bg-muted disabled:opacity-40 ${
                destructive ? "text-destructive" : "text-foreground"
              }`}
            >
              <Icon className="size-[18px] shrink-0" />
              {label}
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Menu de acciones del mensaje (estilo WhatsApp): flecha que aparece al pasar el
// mouse y abre las opciones. "Copiar" y "Responder" funcionan; el resto se
// implementa por partes (varias requieren backend: Evolution API + schema + realtime).
function MessageActionsMenu({
  message,
  outbound,
  onReply,
  onForward,
  onDelete,
}: {
  message: SharedInboxMessageItem;
  outbound: boolean;
  onReply?: (message: SharedInboxMessageItem) => void;
  onForward?: (message: SharedInboxMessageItem) => void;
  onDelete?: (message: SharedInboxMessageItem) => void;
}) {
  // El DropdownMenu de base-ui (FloatingTree/ids/atributos) no es estable en SSR y
  // provoca un mismatch de hidratación que ROMPE la interactividad del menú. Lo
  // montamos solo en el cliente (useSyncExternalStore: false en server, true en
  // cliente) para evitarlo sin setState dentro de un efecto.
  const mounted = useSyncExternalStore(subscribeNoop, getMountedClient, getMountedServer);

  const handleCopy = () => copyMessageText(message);

  const pending = (label: string) => () => toast.info(`${label}: disponible próximamente`);

  if (!mounted) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Opciones del mensaje"
          className={`absolute right-0.5 top-0.5 z-10 inline-flex size-6 items-center justify-center rounded-full opacity-0 shadow-sm transition group-hover/bubble:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100 ${
            outbound
              ? "bg-[var(--chat-out-overlay)] text-[var(--chat-out-text-soft)] hover:bg-[var(--chat-out-overlay-strong)]"
              : "bg-card text-muted-foreground hover:bg-muted"
          }`}
        >
          <ChevronDown className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className="w-52">
        {/* Igual que en el celular: los emoticones primero, que es lo que mas se usa. */}
        <FilaDeReacciones message={message} />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onReply?.(message)}>
          <Reply className="size-4" /> Responder
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopy}>
          <Copy className="size-4" /> Copiar
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => onForward?.(message)}>
          <Forward className="size-4" /> Reenviar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={pending("Fijar")}>
          <Pin className="size-4" /> Fijar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={pending("Destacar")}>
          <Star className="size-4" /> Destacar
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onDelete?.(message)}>
          <Trash2 className="size-4" /> Eliminar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Componente memoizado: solo re-renderiza si cambian sus props directas.
// Evita que los ~N mensajes renderizados re-ejecuten cuando cambia estado de UI
// en SharedInbox (modal abierto, optimisticOutgoingMessage, pendingConversation, etc.).
export const MessageBubble = memo(function MessageBubble({
  message,
  previousMessage,
  onRetry,
  onReply,
  onForward,
  onDelete,
  seleccionado,
  haySeleccion,
  onSeleccionar,
  mostrarReacciones,
}: {
  message: SharedInboxMessageItem;
  previousMessage: SharedInboxMessageItem | undefined;
  onRetry?: () => void;
  onReply?: (message: SharedInboxMessageItem) => void;
  onForward?: (message: SharedInboxMessageItem) => void;
  onDelete?: (message: SharedInboxMessageItem) => void;
  /** Esta burbuja esta seleccionada: se pinta la fila entera. */
  seleccionado?: boolean;
  /** Hay una seleccion abierta: un toque simple suma o saca, sin mantener apretado. */
  haySeleccion?: boolean;
  onSeleccionar?: (message: SharedInboxMessageItem) => void;
  /** Los emoticones flotan sobre esta burbuja (solo cuando es la unica seleccionada). */
  mostrarReacciones?: boolean;
}) {
  const [imagePreviewIndex, setImagePreviewIndex] = useState(0);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [menuDeImagenAbierto, setMenuDeImagenAbierto] = useState(false);
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const outbound = message.direction === "OUTBOUND";
  const currentDateKey = chatDateFormatter.format(message.createdAt);
  const previousDateKey = previousMessage ? chatDateFormatter.format(previousMessage.createdAt) : null;
  const showDateDivider = currentDateKey !== previousDateKey;
  const adPreview = useMemo(() => extractChatAdPreview(message.rawPayload), [message]);
  /*
    El archivo que se fue a buscar despues, cuando la primera descarga habia fallado.

    Se guarda aca y no se espera a que la lista se refresque: el mensaje ya quedo arreglado en la
    base, pero la burbuja tiene que mostrarlo en el momento, que es cuando la asesora lo pidio.
  */
  const [archivoRecuperado, setArchivoRecuperado] = useState<{
    url: string;
    tipo: "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT";
  } | null>(null);
  const [buscandoElArchivo, setBuscandoElArchivo] = useState(false);
  const isImageMessage = message.type === "IMAGE";
  const isStickerMessage = message.type === "STICKER";
  const imagePreviewUrls = useMemo(() => {
    if (archivoRecuperado?.tipo === "IMAGE" || archivoRecuperado?.tipo === "STICKER") {
      return [archivoRecuperado.url];
    }
    return isImageMessage ? collectImagePreviewUrls(message) : [];
  }, [archivoRecuperado, isImageMessage, message]);
  const imagePreviewUrl = imagePreviewUrls[imagePreviewIndex] ?? null;
  const audioUrl = useMemo(
    () =>
      archivoRecuperado?.tipo === "AUDIO"
        ? archivoRecuperado.url
        : message.type === "AUDIO"
          ? extractMediaUrlFromPayload(message, "AUDIO")
          : null,
    [archivoRecuperado, message],
  );
  const videoUrl = useMemo(
    () =>
      archivoRecuperado?.tipo === "VIDEO"
        ? archivoRecuperado.url
        : message.type === "VIDEO"
          ? extractMediaUrlFromPayload(message, "VIDEO")
          : null,
    [archivoRecuperado, message],
  );
  const stickerUrl = useMemo(
    () =>
      archivoRecuperado?.tipo === "STICKER"
        ? archivoRecuperado.url
        : isStickerMessage
          ? extractMediaUrlFromPayload(message, "STICKER")
          : null,
    [archivoRecuperado, isStickerMessage, message],
  );
  const documentUrl = useMemo(
    () =>
      archivoRecuperado?.tipo === "DOCUMENT"
        ? archivoRecuperado.url
        : message.type === "DOCUMENT"
          ? extractMediaUrlFromPayload(message, "DOCUMENT")
          : null,
    [archivoRecuperado, message],
  );
  /*
    Se mira el nombre Y la direccion: el nombre puede venir vacio, y la direccion de un archivo ya
    guardado siempre termina en `.pdf`, porque la extension se pone al guardarlo.
  */
  const esPdf = useMemo(() => {
    const direccion = (documentUrl ?? "").toLowerCase();
    return /\.pdf($|[?#])/.test(direccion) || direccion.includes(".pdf");
  }, [documentUrl]);

  const vistaPreviaDelEnlace = useMemo(
    () => extraerVistaPreviaDeEnlace(message.rawPayload),
    [message.rawPayload],
  );
  const documentMeta = useMemo(
    () => (message.type === "DOCUMENT" ? getDocumentMetaFromMessage(message) : null),
    [message],
  );
  // Ubicacion compartida: se lee del payload crudo y se muestra como tarjeta con enlace
  // al mapa (antes caia al fallback y la burbuja salia con un "-").
  const locationInfo = useMemo(
    () => (message.type === "LOCATION" ? extractEvolutionLocation(message.rawPayload) : null),
    [message],
  );
  // Mensaje de archivo aún enviándose (burbuja optimista): muestra spinner en vez de hora.
  const isPendingMedia = message.id.startsWith("optimistic-media:");
  const isDeleted = Boolean(message.deletedAt);
  const mediaPreviewLabel = getMediaPreviewLabel(message.type);
  /*
    Si el archivo ya se recupero, el aviso de que no se pudo bajar deja de ser cierto.

    En la base ya se borro al recuperarlo, pero la burbuja sigue teniendo el texto viejo hasta que
    la lista se vuelva a cargar: quedaba el audio sonando con un cartel abajo diciendo que no se
    habia podido descargar.
  */
  const contenidoVisible =
    archivoRecuperado && (message.content ?? "").includes("no se pudo descargar")
      ? null
      : message.content;
  const mediaCaption = contenidoVisible?.trim() || "";
  const shouldRenderMediaCaption = mediaCaption && mediaCaption !== mediaPreviewLabel;
  /*
    Este mensaje traia un archivo y se quedo sin el.

    El aviso lo escribe el webhook cuando la descarga falla, y se reconoce por el: no alcanza con
    mirar que no haya archivo -un mensaje de texto tampoco tiene- ni con el tipo, porque WhatsApp
    manda los audios perdidos como si fueran un documento.
  */
  const archivoQueNoBajo =
    !archivoRecuperado &&
    message.direction === "INBOUND" &&
    (message.content ?? "").includes("no se pudo descargar");

  const buscarElArchivo = async () => {
    setBuscandoElArchivo(true);
    try {
      const resultado = await recuperarArchivoPerdidoAction(message.id);
      if (resultado.ok && resultado.mediaUrl && resultado.tipo) {
        setArchivoRecuperado({ url: resultado.mediaUrl, tipo: resultado.tipo });
        toast.success("Archivo recuperado");
        return;
      }
      toast.error(resultado.error ?? "No se pudo recuperar el archivo");
    } catch {
      toast.error("No se pudo recuperar el archivo");
    } finally {
      setBuscandoElArchivo(false);
    }
  };

  const hasImagePreview = isImageMessage && imagePreviewUrl !== null;
  const imagePreviewExhausted = isImageMessage && imagePreviewUrls.length > 0 && !hasImagePreview;
  const showInlineImageTimestamp = hasImagePreview;
  // La hora vive en una columna aparte, a la DERECHA del contenido. Con una foto o un video
  // verticales eso dejaba una franja blanca al lado y la hora colgada en el aire. En esos casos
  // se dibuja encima del propio archivo, como WhatsApp, y la burbuja se ajusta al ancho real.
  const showInlineMediaTimestamp = hasImagePreview || Boolean(videoUrl);

  const handleImageError = () => {
    setImagePreviewIndex((current) => {
      const nextIndex = current + 1;
      return nextIndex < imagePreviewUrls.length ? nextIndex : current;
    });
  };

  const openImageViewer = useCallback(() => {
    if (hasImagePreview) {
      setIsImageViewerOpen(true);
    }
  }, [hasImagePreview]);

  const closeImageViewer = useCallback(() => {
    setIsImageViewerOpen(false);
    // Si no, al volver a abrir la foto el menu aparece ya desplegado.
    setMenuDeImagenAbierto(false);
  }, []);

  useEffect(() => {
    if (!isImageViewerOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsImageViewerOpen(false);
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isImageViewerOpen]);

  const callSummary = getCallMessageSummary(message);
  const CallIcon = callSummary?.icon ?? null;
  const replyPreview = useMemo(() => getMessageReplyPreview(message), [message]);
  const activity = isActivityMessage(message);

  // Acciones del mensaje: menu de hover en escritorio, hoja al mantener apretado en el celular.
  const [isTouchMenuOpen, setIsTouchMenuOpen] = useState(false);
  const tieneAcciones = !isDeleted && !callSummary;
  /*
    Mantener apretado SELECCIONA, como en WhatsApp.

    Antes abria una hoja desde abajo con la lista de acciones. Ahora la burbuja se marca, los
    accesos rapidos aparecen ARRIBA -donde no tapan la conversacion- y los emoticones flotan
    sobre el mensaje.

    La hoja queda de respaldo para una pantalla que no ofrezca seleccion: antes que no pase nada,
    que abra lo de antes.
  */
  const abrirMenuTactil = useCallback(() => {
    navigator.vibrate?.(15);
    if (onSeleccionar) {
      onSeleccionar(message);
      return;
    }
    setIsTouchMenuOpen(true);
  }, [message, onSeleccionar]);
  const longPress = useLongPress(abrirMenuTactil, tieneAcciones);

  return (
    <div
      className="space-y-2.5 md:space-y-3"
    >
      {showDateDivider ? (
        <div className="flex justify-center">
          {/*
            Texto en `text-foreground` y no en `text-muted-foreground`: la pastilla flota sobre el
            fondo estampado del chat, y en tema oscuro un gris medio sobre gris oscuro no se leia.
            Es la unica referencia de "que dia es esto" en toda la conversacion.
          */}
          <span className="rounded-full border border-border bg-muted px-3 py-1 text-[11px] font-medium text-foreground shadow-sm backdrop-blur">
            {formatDateDivider(message.createdAt)}
          </span>
        </div>
      ) : null}

      {activity ? (
        // Badge de actividad (asignación, resuelto/reabierto, etiqueta, etapa). Tooltip con fecha.
        <div className="flex justify-center">
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger
                type="button"
                className="cursor-default rounded-full border border-border bg-white px-3 py-1 text-[11px] font-medium text-black shadow-sm"
              >
                {message.content}
              </TooltipTrigger>
              <TooltipContent side="top">{formatActivityDate(message.createdAt)}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      ) : (
      <>
      {mostrarReacciones ? (
        <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
          <div className="rounded-full border border-border bg-popover px-1 shadow-lg">
            <FilaDeReacciones message={message} />
          </div>
        </div>
      ) : null}

      <div
        className={`flex ${outbound ? "justify-end" : "justify-start"} ${
          seleccionado ? "-mx-2 rounded-md bg-[var(--primary)]/12 px-2 py-0.5" : ""
        }`}
        onClick={(evento) => {
          /*
            Con la seleccion abierta, un toque suma o saca. Sin seleccion, el toque sigue siendo
            para lo de siempre: abrir una foto, reproducir un audio, seguir un enlace.
          */
          if (!haySeleccion || !onSeleccionar) {
            return;
          }
          evento.preventDefault();
          evento.stopPropagation();
          onSeleccionar(message);
        }}
        onContextMenu={(evento) => {
          /*
            En computadora se entra a la seleccion con el boton derecho.

            Mantener apretado es un gesto de dedo: con mouse no existe. Sin esto, en el escritorio
            no habria forma de marcar un mensaje. En el celular el menu del navegador ya viene
            frenado mas adentro, asi que esto no le pisa nada.
          */
          if (!onSeleccionar) {
            return;
          }
          evento.preventDefault();
          onSeleccionar(message);
        }}
      >
        <div
          {...longPress}
          className={`group/bubble relative max-w-[88%] rounded-[8px] px-[7px] py-[6px] text-[14px] leading-5 shadow-[0_1px_1px_rgba(15,23,42,0.14)] [-webkit-touch-callout:none] md:max-w-[72%] [@media(pointer:coarse)]:select-none ${
            outbound
              ? "rounded-tr-[3px] bg-[var(--chat-out-bubble)] text-[var(--chat-out-text)]"
              : "rounded-tl-[3px] border border-border bg-card text-card-foreground"
          } ${isTouchMenuOpen ? "ring-2 ring-[var(--primary)]/40" : ""}`}
        >
          {tieneAcciones ? (
            <>
              <MessageActionsMenu message={message} outbound={outbound} onReply={onReply} onForward={onForward} onDelete={onDelete} />
              <MessageTouchActionsSheet
                message={message}
                open={isTouchMenuOpen}
                onOpenChange={setIsTouchMenuOpen}
                onReply={onReply}
                onForward={onForward}
                onDelete={onDelete}
              />
            </>
          ) : null}
          {replyPreview ? (
            <div
              className={`mb-1 rounded-md border-l-2 px-2 py-1 text-[11px] ${
                outbound ? "border-[var(--chat-out-quote-border)] bg-[var(--chat-out-overlay)]" : "border-[var(--primary)] bg-muted"
              }`}
            >
              {replyPreview.author ? (
                <p className={`font-semibold ${outbound ? "text-[var(--chat-out-accent)]" : "text-[var(--primary)]"}`}>
                  {replyPreview.author}
                </p>
              ) : null}
              <p className={`truncate ${outbound ? "text-[var(--chat-out-text-soft)]" : "text-muted-foreground"}`}>
                {replyPreview.text}
              </p>
            </div>
          ) : null}
          {/* Contenido + hora en flujo tipo WhatsApp: en mensajes cortos la hora
              queda a la derecha en la MISMA linea; en los largos baja al pie. */}
          <div className="flex flex-wrap items-end gap-x-2">
          <div className="min-w-0">
          {callSummary ? (
            <div className="space-y-2">
              <Badge
                className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold normal-case tracking-normal shadow-none ${
                  outbound ? "bg-[var(--chat-out-overlay)] text-[var(--chat-out-text)]" : "bg-muted text-foreground"
                }`}
              >
                {CallIcon ? <CallIcon className={`h-4 w-4 ${outbound ? "text-[var(--chat-out-text-soft)]" : "text-[var(--primary)]"}`} /> : null}
                <span>Llamada {callSummary.directionLabel}</span>
                {callSummary.statusText ? (
                  <span className={`font-normal ${outbound ? "text-[var(--chat-out-text-faint)]" : "text-muted-foreground"}`}>
                    {callSummary.statusText}
                  </span>
                ) : null}
              </Badge>
            </div>
          ) : adPreview ? (
            <div className="space-y-3">
              {adPreview.sourceUrl ? (
                <a
                  href={adPreview.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={adPreview.sourceUrl}
                  className={`group flex w-full max-w-[280px] items-center gap-3 overflow-hidden rounded-2xl border px-2.5 py-2 text-left transition ${
                    outbound
                      ? "border-[var(--chat-out-border)] bg-[var(--chat-out-overlay)] hover:bg-[var(--chat-out-overlay-strong)]"
                      : "border-border bg-muted hover:bg-muted/80"
                  }`}
                >
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-black/5 bg-card">
                    {adPreview.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={isMediaSourceUrl(adPreview.thumbnailUrl) ? toProxiedMediaUrl(adPreview.thumbnailUrl) : ""}
                        alt={adPreview.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-muted">
                        {adPreview.sourceApp === "facebook" ? (
                          <Facebook className="h-4 w-4 text-blue-600" />
                        ) : (
                          <MessageCircle className="h-4 w-4 text-emerald-600" />
                        )}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      {adPreview.sourceApp === "facebook" ? (
                        <Facebook className={`h-3.5 w-3.5 ${outbound ? "text-[var(--chat-out-text-soft)]" : "text-blue-600"}`} />
                      ) : (
                        <MessageCircle className={`h-3.5 w-3.5 ${outbound ? "text-[var(--chat-out-text-soft)]" : "text-emerald-600"}`} />
                      )}
                      <span className={`text-[11px] font-medium ${outbound ? "text-[var(--chat-out-text-faint)]" : "text-muted-foreground"}`}>
                        {adPreview.sourceApp === "facebook" ? "Anuncio de Facebook" : "Referencia de anuncio"}
                      </span>
                    </div>
                    <p className={`truncate text-[13px] font-semibold leading-5 ${outbound ? "text-[var(--chat-out-text)]" : "text-foreground"}`}>
                      {adPreview.title}
                    </p>
                    <p className={`text-[11px] font-medium ${outbound ? "text-[var(--chat-out-text-soft)]" : "text-muted-foreground"}`}>
                      Ver detalles
                    </p>
                  </div>
                </a>
              ) : (
                <div
                  className={`flex w-full max-w-[280px] items-center gap-3 overflow-hidden rounded-2xl border px-2.5 py-2 ${
                    outbound
                      ? "border-[var(--chat-out-border)] bg-[var(--chat-out-overlay)]"
                      : "border-border bg-muted"
                  }`}
                >
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-black/5 bg-card">
                    {adPreview.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={isMediaSourceUrl(adPreview.thumbnailUrl) ? toProxiedMediaUrl(adPreview.thumbnailUrl) : ""}
                        alt={adPreview.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-muted">
                        {adPreview.sourceApp === "facebook" ? (
                          <Facebook className="h-4 w-4 text-blue-600" />
                        ) : (
                          <MessageCircle className="h-4 w-4 text-emerald-600" />
                        )}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      {adPreview.sourceApp === "facebook" ? (
                        <Facebook className={`h-3.5 w-3.5 ${outbound ? "text-[var(--chat-out-text-soft)]" : "text-blue-600"}`} />
                      ) : (
                        <MessageCircle className={`h-3.5 w-3.5 ${outbound ? "text-[var(--chat-out-text-soft)]" : "text-emerald-600"}`} />
                      )}
                      <span className={`text-[11px] font-medium ${outbound ? "text-[var(--chat-out-text-faint)]" : "text-muted-foreground"}`}>
                        {adPreview.sourceApp === "facebook" ? "Anuncio de Facebook" : "Referencia de anuncio"}
                      </span>
                    </div>
                    <p className={`truncate text-[13px] font-semibold leading-5 ${outbound ? "text-[var(--chat-out-text)]" : "text-foreground"}`}>
                      {adPreview.title}
                    </p>
                    <p className={`text-[11px] font-medium ${outbound ? "text-[var(--chat-out-text-soft)]" : "text-muted-foreground"}`}>
                      Ver detalles
                    </p>
                  </div>
                </div>
              )}
              {renderMessageText(contenidoVisible)}
            </div>
          ) : hasImagePreview ? (
            <div className="space-y-2 max-w-[360px]">
              <div className="relative">
                <button
                  type="button"
                  onClick={openImageViewer}
                  className="group block w-full cursor-zoom-in overflow-hidden rounded-xl"
                  aria-label="Abrir imagen en pantalla completa"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imagePreviewUrl}
                    alt={message.content?.trim() || "Imagen del chat"}
                    loading="lazy"
                    decoding="async"
                    onError={handleImageError}
                    className="max-h-[260px] w-full rounded-xl object-cover transition duration-200 group-hover:scale-[1.01]"
                  />
                  <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-black/5 transition group-hover:bg-black/5" />
                </button>
                {showInlineImageTimestamp ? (
                  <div
                    className={`absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] leading-none backdrop-blur-sm ${
                      outbound ? "bg-black/45 text-white" : "bg-black/45 text-white"
                    }`}
                  >
                    {message.authorType === "bot" ? (
                      <Bot className="h-3 w-3" />
                    ) : (
                      <UserRound className="h-3 w-3" />
                    )}
                    {formatChatTime(message.createdAt)}
                  </div>
                ) : null}
              </div>
              {renderMessageText(contenidoVisible)}
              {portalTarget && isImageViewerOpen && hasImagePreview
                ? createPortal(
                    <div
                      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 px-3 py-3 backdrop-blur-sm"
                      role="dialog"
                      aria-modal="true"
                      aria-label="Vista previa de imagen"
                      onClick={closeImageViewer}
                    >
                      <div
                        className="relative flex h-full w-full items-center justify-center"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {/*
                          Arriba: cerrar y los tres puntos. Abajo a la derecha: responder.

                          Se separan a proposito. Cerrar y "que hago con esta foto" son cosas de la
                          ventana y viven en su borde de arriba; responder es lo que uno hace
                          DESPUES de mirarla, y el pulgar ya esta abajo a la derecha.
                        */}
                        <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setMenuDeImagenAbierto((abierto) => !abierto)}
                              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                              aria-label="Opciones de la imagen"
                              aria-expanded={menuDeImagenAbierto}
                            >
                              <MoreVertical className="h-5 w-5" />
                            </button>
                            {menuDeImagenAbierto ? (
                              <div className="absolute right-0 top-12 w-52 overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-lg">
                                <a
                                  href={imagePreviewUrl}
                                  download
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={() => setMenuDeImagenAbierto(false)}
                                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-foreground transition hover:bg-muted"
                                >
                                  <Download className="size-4 shrink-0 text-muted-foreground" />
                                  Descargar
                                </a>
                                {onForward ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMenuDeImagenAbierto(false);
                                      closeImageViewer();
                                      onForward(message);
                                    }}
                                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-foreground transition hover:bg-muted"
                                  >
                                    <Forward className="size-4 shrink-0 text-muted-foreground" />
                                    Reenviar a otro contacto
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={closeImageViewer}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                            aria-label="Cerrar imagen"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        </div>

                        {onReply ? (
                          <button
                            type="button"
                            onClick={() => {
                              closeImageViewer();
                              onReply(message);
                            }}
                            className="absolute bottom-4 right-4 z-10 inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-white/25"
                          >
                            <Reply className="size-4" />
                            Responder
                          </button>
                        ) : null}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imagePreviewUrl}
                          alt={message.content?.trim() || "Imagen del chat"}
                          className="max-h-[calc(100dvh-1.5rem)] max-w-[calc(100dvw-1.5rem)] select-none object-contain shadow-[0_24px_80px_-24px_rgba(0,0,0,0.65)]"
                          draggable={false}
                        />
                      </div>
                    </div>,
                    portalTarget,
                  )
                : null}
            </div>
          ) : imagePreviewExhausted ? (
            <div className="space-y-2">
              <div className={`flex h-[180px] w-full items-center justify-center rounded-xl border border-dashed ${
                outbound ? "border-[var(--chat-out-border)] bg-[var(--chat-out-overlay)] text-[var(--chat-out-text-soft)]" : "border-border bg-muted text-muted-foreground"
              }`}>
                <span className="text-sm font-medium">Imagen no disponible</span>
              </div>
              {renderMessageText(contenidoVisible)}
            </div>
          ) : videoUrl ? (
            <div className="space-y-2">
              <div className="relative w-fit max-w-full overflow-hidden rounded-xl">
                <video
                  src={videoUrl}
                  controls
                  preload="metadata"
                  className="max-h-[320px] w-auto max-w-full rounded-xl bg-black"
                />
                {/* Arriba y no abajo: el reproductor pone sus propios botones en el borde
                    inferior y la hora quedaría tapada por el play y el volumen. */}
                <div className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/45 px-1.5 py-0.5 text-[10px] leading-none text-white backdrop-blur-sm">
                  {message.authorType === "bot" ? (
                    <Bot className="h-3 w-3" />
                  ) : (
                    <UserRound className="h-3 w-3" />
                  )}
                  {formatChatTime(message.createdAt)}
                </div>
              </div>
              {renderMessageText(contenidoVisible)}
            </div>
          ) : stickerUrl ? (
            <div className="space-y-2">
              <div className="inline-flex max-w-[220px] items-center justify-center overflow-hidden rounded-xl border border-border bg-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={stickerUrl}
                  alt={message.content?.trim() || "Sticker"}
                  loading="lazy"
                  decoding="async"
                  className="h-auto w-full max-w-[220px] object-contain"
                />
              </div>
              {renderMessageText(contenidoVisible)}
            </div>
          ) : audioUrl ? (
            <AudioMessageCard
              mediaUrl={audioUrl}
              content={contenidoVisible}
            />
          ) : documentUrl ? (
            <div className="space-y-2">
              {/*
                Un PDF se mira aca; los demas archivos siguen abriendose como siempre.

                Es la diferencia entre "lo puedo leer" y "lo tengo que bajar": casi todo lo que
                mandan es un curriculum en PDF, y un Excel o un Word el navegador no los sabe
                mostrar igual, asi que ahi abrir aparte sigue siendo lo correcto.

                Sigue siendo un enlace -no un boton- para no perder lo que uno espera de uno: el
                clic del medio y "abrir en otra pestaña" siguen funcionando.
              */}
              {esPdf ? (
                <TarjetaDePdf
                  url={documentUrl}
                  nombre={documentMeta?.fileName ?? "Documento"}
                  etiquetaDeTamano={documentMeta?.sizeLabel ?? null}
                  outbound={outbound}
                />
              ) : (
              <a
                href={documentUrl}
                target="_blank"
                rel="noreferrer"
                title={documentMeta?.fileName ?? "Abrir documento"}
                className={`flex max-w-[min(230px,68vw)] items-center gap-2 rounded-xl p-1.5 pr-3 transition ${
                  outbound ? "bg-[var(--chat-out-overlay)] hover:bg-[var(--chat-out-overlay-strong)]" : "bg-background hover:bg-muted"
                }`}
              >
                {(() => {
                  const { Icon, color } = getDocumentIcon(documentMeta?.typeLabel ?? "ARCHIVO");
                  return <Icon className="size-8 shrink-0" style={{ color }} />;
                })()}
                <span className="flex min-w-0 flex-col">
                  <span className={`truncate text-[13px] font-normal leading-tight ${outbound ? "text-[var(--chat-out-text)]" : "text-foreground"}`}>
                    {documentMeta?.fileName ?? "Documento"}
                  </span>
                  <span className={`truncate text-[11px] leading-tight ${outbound ? "text-[var(--chat-out-text-faint)]" : "text-muted-foreground"}`}>
                    {documentMeta?.sizeLabel
                      ? `${documentMeta.typeLabel} • ${documentMeta.sizeLabel}`
                      : documentMeta?.typeLabel ?? "Documento"}
                  </span>
                </span>
              </a>
              )}

              {/* No repetir el nombre del archivo abajo: WhatsApp manda el nombre como
                  "caption" cuando no hay mensaje real, y ya se muestra en la tarjeta. */}
              {message.content?.trim() && message.content.trim() !== (documentMeta?.fileName ?? "").trim()
                ? renderMessageText(contenidoVisible)
                : null}
            </div>
          ) : locationInfo ? (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${locationInfo.latitude},${locationInfo.longitude}`}
              target="_blank"
              rel="noreferrer"
              title="Abrir ubicacion en el mapa"
              className={`flex max-w-[min(230px,68vw)] items-center gap-2 rounded-xl p-1.5 pr-3 transition ${
                outbound ? "bg-[var(--chat-out-overlay)] hover:bg-[var(--chat-out-overlay-strong)]" : "bg-background hover:bg-muted"
              }`}
            >
              <MapPin className={`size-8 shrink-0 ${outbound ? "text-[var(--chat-out-text)]" : "text-primary"}`} />
              <span className="flex min-w-0 flex-col">
                <span className={`truncate text-[13px] font-normal leading-tight ${outbound ? "text-[var(--chat-out-text)]" : "text-foreground"}`}>
                  {locationInfo.name || locationInfo.address || "Ubicacion"}
                </span>
                <span className={`truncate text-[11px] leading-tight ${outbound ? "text-[var(--chat-out-text-faint)]" : "text-muted-foreground"}`}>
                  {locationInfo.name && locationInfo.address
                    ? locationInfo.address
                    : `${locationInfo.latitude.toFixed(5)}, ${locationInfo.longitude.toFixed(5)}`}
                </span>
              </span>
            </a>
          ) : mediaPreviewLabel ? (
            <div className="space-y-2">
              {/*
                La ruedita SOLO mientras el archivo se esta yendo de verdad (burbuja optimista).
                Antes giraba siempre que no se podia abrir el archivo, y eso pasa para siempre en
                los que llegan con una direccion del CDN de WhatsApp (los que manda la asesora
                desde su celular): el mensaje quedaba "cargando" eternamente aunque ya se hubiera
                entregado. Mentir con un cargando es peor que decir que no se puede abrir.
              */}
              <div
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${
                  outbound
                    ? "border-[var(--chat-out-border)] bg-[var(--chat-out-overlay)] text-[var(--chat-out-text)]"
                    : "border-border bg-muted text-foreground"
                }`}
              >
                {isPendingMedia ? (
                  <LoaderCircle className={`h-4 w-4 shrink-0 animate-spin ${outbound ? "text-[var(--chat-out-text-soft)]" : "text-muted-foreground"}`} />
                ) : (
                  (() => {
                    const { Icon, color } = getDocumentIcon(documentMeta?.typeLabel ?? "ARCHIVO");
                    return <Icon className="size-5 shrink-0" style={{ color }} />;
                  })()
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{documentMeta?.fileName ?? mediaPreviewLabel}</span>
                  {!isPendingMedia ? (
                    <span className={`truncate text-[11px] font-normal leading-tight ${outbound ? "text-[var(--chat-out-text-faint)]" : "text-muted-foreground"}`}>
                      {archivoQueNoBajo ? "No se pudo descargar" : "Enviado · no se puede abrir desde acá"}
                    </span>
                  ) : null}
                </span>
              </div>
              {/*
                Se puede ir a buscarlo: que la descarga fallara no quiere decir que el archivo se
                haya perdido. Probando un audio que habia quedado asi, WhatsApp lo devolvio entero
                horas despues. Se pide a mano y no solo porque a veces si expira, y reintentar en
                cada carga seria pegarle al gateway por gusto.
              */}
              {archivoQueNoBajo ? (
                <button
                  type="button"
                  onClick={buscarElArchivo}
                  disabled={buscandoElArchivo}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition disabled:opacity-60 ${
                    outbound
                      ? "border-[var(--chat-out-border)] text-[var(--chat-out-text)] hover:bg-[var(--chat-out-overlay)]"
                      : "border-border text-foreground hover:bg-muted"
                  }`}
                >
                  {buscandoElArchivo ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                  {buscandoElArchivo ? "Buscando..." : "Buscar el archivo"}
                </button>
              ) : null}
              {shouldRenderMediaCaption ? renderMessageText(contenidoVisible) : null}
            </div>
          ) : (
            <div className="space-y-1.5">
              {/*
                La tarjeta del enlace va ARRIBA del texto, como en WhatsApp: primero se ve de que
                es el link y despues la direccion.
              */}
              {vistaPreviaDelEnlace ? (
                <a
                  href={vistaPreviaDelEnlace.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={(evento) => evento.stopPropagation()}
                  className={`block w-full max-w-[280px] overflow-hidden rounded-xl border transition hover:opacity-90 ${
                    outbound
                      ? "border-[var(--chat-out-overlay-strong)] bg-[var(--chat-out-overlay)]"
                      : "border-border bg-background"
                  }`}
                >
                  {vistaPreviaDelEnlace.miniatura ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={vistaPreviaDelEnlace.miniatura}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-auto max-h-[160px] w-full object-cover"
                    />
                  ) : null}
                  <div className="space-y-0.5 px-2.5 py-2">
                    <p className={`line-clamp-2 text-[12px] font-medium leading-4 ${outbound ? "text-[var(--chat-out-text)]" : "text-foreground"}`}>
                      {vistaPreviaDelEnlace.titulo}
                    </p>
                    {vistaPreviaDelEnlace.sitio ? (
                      <p className={`truncate text-[11px] ${outbound ? "text-[var(--chat-out-text-soft)]" : "text-muted-foreground"}`}>
                        {vistaPreviaDelEnlace.sitio}
                      </p>
                    ) : null}
                  </div>
                </a>
              ) : null}
              {renderMessageText(contenidoVisible) || (
                <p className={`text-[12px] italic ${outbound ? "text-[var(--chat-out-text-faint)]" : "text-muted-foreground"}`}>
                  {isDeleted ? "Mensaje eliminado" : "-"}
                </p>
              )}
            </div>
          )}
          </div>

          <div className={`ml-auto flex shrink-0 items-center justify-end gap-1 text-[10px] ${outbound ? "text-[var(--chat-out-text-soft)]" : "text-muted-foreground"}`}>
            {isDeleted ? (
              <Badge className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-normal tracking-[0.08em] shadow-none ${
                outbound ? "bg-[var(--chat-out-overlay)] text-[var(--chat-out-text-soft)]" : "bg-rose-50 text-rose-600"
              }`}>
                <Trash2 className="h-2.5 w-2.5" />
                Eliminado
              </Badge>
            ) : null}
            {message.editedAt ? (
              <Badge className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-normal tracking-[0.08em] shadow-none ${
                outbound ? "bg-[var(--chat-out-overlay)] text-[var(--chat-out-text-soft)]" : "bg-muted text-muted-foreground"
              }`}>
                <Pencil className="h-2.5 w-2.5" />
                Editado
              </Badge>
            ) : null}
            {!showInlineMediaTimestamp ? (
              message.authorType === "bot" ? (
                <Bot className="h-3 w-3" />
              ) : (
                <UserRound className="h-3 w-3" />
              )
            ) : null}
            {!showInlineMediaTimestamp ? <span>{formatChatTime(message.createdAt)}</span> : null}
            {isPendingMedia ? (
              <LoaderCircle className="ml-0.5 h-3 w-3 shrink-0 animate-spin" aria-label="Enviando" />
            ) : null}
            {outbound && message.outboundStatusLabel ? (
              // Acuses tipo WhatsApp. La API oficial sí avisa cuando el cliente RECIBIÓ y cuando
              // ABRIÓ el mensaje; antes se imprimía el estado crudo ("DELIVERED", "READ") como
              // texto. El doble check azul es el que dice "lo leyó".
              message.outboundStatusLabel === "READ" ? (
                <CheckCheck className="ml-1 h-3 w-3 shrink-0 text-sky-500" aria-label="Leído" />
              ) : message.outboundStatusLabel === "DELIVERED" ? (
                <CheckCheck className="ml-1 h-3 w-3 shrink-0" aria-label="Entregado" />
              ) : message.outboundStatusLabel === "SENT" ? (
                <Check className="ml-1 h-3 w-3 shrink-0" aria-label="Enviado" />
              ) : message.outboundStatusLabel === "FAILED" ? (
                // Antes era solo un triangulito, sin texto: la asesora veia que "algo paso" y
                // tenia que mandar el archivo a mano sin saber por que. Ahora se dice, y el
                // motivo exacto de WhatsApp queda en el tooltip.
                <span
                  // El ambar oscuro se pierde sobre la burbuja verde profunda del tema noche.
                  className="ml-1 inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-300"
                  title={message.errorDetail?.trim() || "WhatsApp rechazó el mensaje."}
                >
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                  No se envió
                </span>
              ) : message.outboundStatusLabel === "entregado" ? (
                <CheckCheck className="ml-1 h-3 w-3 shrink-0" aria-hidden="true" />
              ) : message.outboundStatusLabel === "error" ? (
                <span className="ml-1 inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                  No se envió
                  {onRetry ? (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="ml-0.5 inline-flex cursor-pointer items-center gap-0.5 rounded-full bg-amber-600/15 px-1.5 py-0.5 font-semibold text-amber-800 transition hover:bg-amber-600/25 dark:bg-amber-300/20 dark:text-amber-200 dark:hover:bg-amber-300/30"
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                      Reintentar
                    </button>
                  ) : null}
                </span>
              ) : (
                <span className="ml-1">{message.outboundStatusLabel}</span>
              )
            ) : null}
          </div>
          </div>

          {/* Reaccion del cliente (👍 ❤️ …): circulito pegado abajo a la derecha de la burbuja,
              como en WhatsApp. No es un mensaje aparte; antes llegaba como burbuja vacia. */}
          {message.reactionEmoji ? (
            <span
              className="absolute -bottom-2.5 right-2 inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full border border-border bg-card px-1 text-[13px] leading-none shadow-[0_1px_3px_rgba(15,23,42,0.2)]"
              title="Reacción del cliente"
            >
              {message.reactionEmoji}
            </span>
          ) : null}
        </div>
      </div>
      </>
      )}
    </div>
  );
});

