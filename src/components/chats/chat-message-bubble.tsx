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
  Forward,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Pencil,
  Pin,
  Reply,
  RotateCcw,
  Smile,
  Star,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { extractEvolutionLocation } from "@/lib/evolution-webhook";
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
  getDocumentIcon,
  getDocumentMetaFromMessage,
  collectImagePreviewUrls,
  extractChatAdPreview,
} from "./chat-inbox-media";

function renderWhatsAppText(content: string) {
  const parts = content.split(/(\*[^*\n]+\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return (
        <strong key={`${part}-${index}`} className="font-semibold">
          {part.slice(1, -1)}
        </strong>
      );
    }

    return <span key={`${part}-${index}`}>{part}</span>;
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
        <p className="truncate px-4 pb-2 pt-3 text-xs text-muted-foreground">{preview}</p>
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
              ? "bg-black/[0.06] text-black/60 hover:bg-black/10"
              : "bg-card text-muted-foreground hover:bg-muted"
          }`}
        >
          <ChevronDown className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className="w-52">
        <DropdownMenuItem onClick={() => onReply?.(message)}>
          <Reply className="size-4" /> Responder
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopy}>
          <Copy className="size-4" /> Copiar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={pending("Reaccionar")}>
          <Smile className="size-4" /> Reaccionar
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
}: {
  message: SharedInboxMessageItem;
  previousMessage: SharedInboxMessageItem | undefined;
  onRetry?: () => void;
  onReply?: (message: SharedInboxMessageItem) => void;
  onForward?: (message: SharedInboxMessageItem) => void;
  onDelete?: (message: SharedInboxMessageItem) => void;
}) {
  const [imagePreviewIndex, setImagePreviewIndex] = useState(0);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const outbound = message.direction === "OUTBOUND";
  const currentDateKey = chatDateFormatter.format(message.createdAt);
  const previousDateKey = previousMessage ? chatDateFormatter.format(previousMessage.createdAt) : null;
  const showDateDivider = currentDateKey !== previousDateKey;
  const adPreview = useMemo(() => extractChatAdPreview(message.rawPayload), [message]);
  const isImageMessage = message.type === "IMAGE";
  const isStickerMessage = message.type === "STICKER";
  const imagePreviewUrls = useMemo(() => (isImageMessage ? collectImagePreviewUrls(message) : []), [message, isImageMessage]);
  const imagePreviewUrl = imagePreviewUrls[imagePreviewIndex] ?? null;
  const audioUrl = useMemo(
    () => (message.type === "AUDIO" ? extractMediaUrlFromPayload(message, "AUDIO") : null),
    [message],
  );
  const videoUrl = useMemo(
    () => (message.type === "VIDEO" ? extractMediaUrlFromPayload(message, "VIDEO") : null),
    [message],
  );
  const stickerUrl = useMemo(
    () => (isStickerMessage ? extractMediaUrlFromPayload(message, "STICKER") : null),
    [isStickerMessage, message],
  );
  const documentUrl = useMemo(
    () => (message.type === "DOCUMENT" ? extractMediaUrlFromPayload(message, "DOCUMENT") : null),
    [message],
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
  const mediaCaption = message.content?.trim() || "";
  const shouldRenderMediaCaption = mediaCaption && mediaCaption !== mediaPreviewLabel;
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
  const abrirMenuTactil = useCallback(() => {
    navigator.vibrate?.(15);
    setIsTouchMenuOpen(true);
  }, []);
  const longPress = useLongPress(abrirMenuTactil, tieneAcciones);

  return (
    <div
      className="space-y-2.5 md:space-y-3"
    >
      {showDateDivider ? (
        <div className="flex justify-center">
          <span className="rounded-full border border-border bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">
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
      <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
        <div
          {...longPress}
          className={`group/bubble relative max-w-[88%] rounded-[8px] px-[7px] py-[6px] text-[14px] leading-5 shadow-[0_1px_1px_rgba(15,23,42,0.14)] [-webkit-touch-callout:none] md:max-w-[72%] [@media(pointer:coarse)]:select-none ${
            outbound
              ? "rounded-tr-[3px] bg-[#d9fdd3] text-[#111b21]"
              : "rounded-tl-[3px] border border-border bg-card text-[#111b21] dark:text-foreground"
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
                outbound ? "border-[#0a7d62]/50 bg-black/[0.05]" : "border-[var(--primary)] bg-muted"
              }`}
            >
              {replyPreview.author ? (
                <p className={`font-semibold ${outbound ? "text-[#0a7d62]" : "text-[var(--primary)]"}`}>
                  {replyPreview.author}
                </p>
              ) : null}
              <p className={`truncate ${outbound ? "text-black/60" : "text-muted-foreground"}`}>
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
                  outbound ? "bg-black/[0.06] text-[#111b21]" : "bg-muted text-foreground"
                }`}
              >
                {CallIcon ? <CallIcon className={`h-4 w-4 ${outbound ? "text-black/65" : "text-[var(--primary)]"}`} /> : null}
                <span>Llamada {callSummary.directionLabel}</span>
                {callSummary.statusText ? (
                  <span className={`font-normal ${outbound ? "text-black/55" : "text-muted-foreground"}`}>
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
                      ? "border-black/10 bg-black/[0.05] hover:bg-black/[0.08]"
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
                        <Facebook className={`h-3.5 w-3.5 ${outbound ? "text-black/60" : "text-blue-600"}`} />
                      ) : (
                        <MessageCircle className={`h-3.5 w-3.5 ${outbound ? "text-black/60" : "text-emerald-600"}`} />
                      )}
                      <span className={`text-[11px] font-medium ${outbound ? "text-black/55" : "text-muted-foreground"}`}>
                        {adPreview.sourceApp === "facebook" ? "Anuncio de Facebook" : "Referencia de anuncio"}
                      </span>
                    </div>
                    <p className={`truncate text-[13px] font-semibold leading-5 ${outbound ? "text-[#111b21]" : "text-foreground"}`}>
                      {adPreview.title}
                    </p>
                    <p className={`text-[11px] font-medium ${outbound ? "text-black/60" : "text-muted-foreground"}`}>
                      Ver detalles
                    </p>
                  </div>
                </a>
              ) : (
                <div
                  className={`flex w-full max-w-[280px] items-center gap-3 overflow-hidden rounded-2xl border px-2.5 py-2 ${
                    outbound
                      ? "border-black/10 bg-black/[0.05]"
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
                        <Facebook className={`h-3.5 w-3.5 ${outbound ? "text-black/60" : "text-blue-600"}`} />
                      ) : (
                        <MessageCircle className={`h-3.5 w-3.5 ${outbound ? "text-black/60" : "text-emerald-600"}`} />
                      )}
                      <span className={`text-[11px] font-medium ${outbound ? "text-black/55" : "text-muted-foreground"}`}>
                        {adPreview.sourceApp === "facebook" ? "Anuncio de Facebook" : "Referencia de anuncio"}
                      </span>
                    </div>
                    <p className={`truncate text-[13px] font-semibold leading-5 ${outbound ? "text-[#111b21]" : "text-foreground"}`}>
                      {adPreview.title}
                    </p>
                    <p className={`text-[11px] font-medium ${outbound ? "text-black/60" : "text-muted-foreground"}`}>
                      Ver detalles
                    </p>
                  </div>
                </div>
              )}
              {renderMessageText(message.content)}
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
              {renderMessageText(message.content)}
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
                        <button
                          type="button"
                          onClick={closeImageViewer}
                          className="absolute right-2 top-2 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                          aria-label="Cerrar imagen"
                        >
                          <X className="h-5 w-5" />
                        </button>
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
                outbound ? "border-black/10 bg-black/[0.05] text-black/60" : "border-border bg-muted text-muted-foreground"
              }`}>
                <span className="text-sm font-medium">Imagen no disponible</span>
              </div>
              {renderMessageText(message.content)}
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
              {renderMessageText(message.content)}
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
              {renderMessageText(message.content)}
            </div>
          ) : audioUrl ? (
            <AudioMessageCard
              mediaUrl={audioUrl}
              content={message.content}
            />
          ) : documentUrl ? (
            <div className="space-y-2">
              <a
                href={documentUrl}
                target="_blank"
                rel="noreferrer"
                title={documentMeta?.fileName ?? "Abrir documento"}
                className={`flex max-w-[min(230px,68vw)] items-center gap-2 rounded-xl p-1.5 pr-3 transition ${
                  outbound ? "bg-black/[0.06] hover:bg-black/10" : "bg-background hover:bg-muted"
                }`}
              >
                {(() => {
                  const { Icon, color } = getDocumentIcon(documentMeta?.typeLabel ?? "ARCHIVO");
                  return <Icon className="size-8 shrink-0" style={{ color }} />;
                })()}
                <span className="flex min-w-0 flex-col">
                  <span className={`truncate text-[13px] font-normal leading-tight ${outbound ? "text-[#111b21]" : "text-foreground"}`}>
                    {documentMeta?.fileName ?? "Documento"}
                  </span>
                  <span className={`truncate text-[11px] leading-tight ${outbound ? "text-black/50" : "text-muted-foreground"}`}>
                    {documentMeta?.sizeLabel
                      ? `${documentMeta.typeLabel} • ${documentMeta.sizeLabel}`
                      : documentMeta?.typeLabel ?? "Documento"}
                  </span>
                </span>
              </a>
              {/* No repetir el nombre del archivo abajo: WhatsApp manda el nombre como
                  "caption" cuando no hay mensaje real, y ya se muestra en la tarjeta. */}
              {message.content?.trim() && message.content.trim() !== (documentMeta?.fileName ?? "").trim()
                ? renderMessageText(message.content)
                : null}
            </div>
          ) : locationInfo ? (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${locationInfo.latitude},${locationInfo.longitude}`}
              target="_blank"
              rel="noreferrer"
              title="Abrir ubicacion en el mapa"
              className={`flex max-w-[min(230px,68vw)] items-center gap-2 rounded-xl p-1.5 pr-3 transition ${
                outbound ? "bg-black/[0.06] hover:bg-black/10" : "bg-background hover:bg-muted"
              }`}
            >
              <MapPin className={`size-8 shrink-0 ${outbound ? "text-[#111b21]" : "text-primary"}`} />
              <span className="flex min-w-0 flex-col">
                <span className={`truncate text-[13px] font-normal leading-tight ${outbound ? "text-[#111b21]" : "text-foreground"}`}>
                  {locationInfo.name || locationInfo.address || "Ubicacion"}
                </span>
                <span className={`truncate text-[11px] leading-tight ${outbound ? "text-black/50" : "text-muted-foreground"}`}>
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
                    ? "border-black/10 bg-black/[0.05] text-[#111b21]"
                    : "border-border bg-muted text-foreground"
                }`}
              >
                {isPendingMedia ? (
                  <LoaderCircle className={`h-4 w-4 shrink-0 animate-spin ${outbound ? "text-black/60" : "text-muted-foreground"}`} />
                ) : (
                  (() => {
                    const { Icon, color } = getDocumentIcon(documentMeta?.typeLabel ?? "ARCHIVO");
                    return <Icon className="size-5 shrink-0" style={{ color }} />;
                  })()
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{documentMeta?.fileName ?? mediaPreviewLabel}</span>
                  {!isPendingMedia ? (
                    <span className={`truncate text-[11px] font-normal leading-tight ${outbound ? "text-black/50" : "text-muted-foreground"}`}>
                      Enviado · no se puede abrir desde acá
                    </span>
                  ) : null}
                </span>
              </div>
              {shouldRenderMediaCaption ? renderMessageText(message.content) : null}
            </div>
          ) : (
            renderMessageText(message.content) || (
              <p className={`text-[12px] italic ${outbound ? "text-black/55" : "text-muted-foreground"}`}>
                {isDeleted ? "Mensaje eliminado" : "-"}
              </p>
            )
          )}
          </div>

          <div className={`ml-auto flex shrink-0 items-center justify-end gap-1 text-[10px] ${outbound ? "text-black/60" : "text-muted-foreground"}`}>
            {isDeleted ? (
              <Badge className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-normal tracking-[0.08em] shadow-none ${
                outbound ? "bg-black/[0.06] text-black/60" : "bg-rose-50 text-rose-600"
              }`}>
                <Trash2 className="h-2.5 w-2.5" />
                Eliminado
              </Badge>
            ) : null}
            {message.editedAt ? (
              <Badge className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-normal tracking-[0.08em] shadow-none ${
                outbound ? "bg-black/[0.06] text-black/60" : "bg-muted text-muted-foreground"
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
                  className="ml-1 inline-flex items-center gap-1 font-medium text-amber-700"
                  title={message.errorDetail?.trim() || "WhatsApp rechazó el mensaje."}
                >
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                  No se envió
                </span>
              ) : message.outboundStatusLabel === "entregado" ? (
                <CheckCheck className="ml-1 h-3 w-3 shrink-0" aria-hidden="true" />
              ) : message.outboundStatusLabel === "error" ? (
                <span className="ml-1 inline-flex items-center gap-1 font-medium text-amber-700">
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                  No se envió
                  {onRetry ? (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="ml-0.5 inline-flex cursor-pointer items-center gap-0.5 rounded-full bg-amber-600/15 px-1.5 py-0.5 font-semibold text-amber-800 transition hover:bg-amber-600/25"
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
      )}
    </div>
  );
});

