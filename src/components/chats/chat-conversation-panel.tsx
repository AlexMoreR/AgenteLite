"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlarmClock,
  ArrowLeft,
  BookOpen,
  Camera,
  ChevronDown,
  Copy,
  FileText,
  Headphones,
  ImageIcon,
  LoaderCircle,
  MapPin,
  MessageSquareText,
  PenLine,
  Mic,
  Pencil,
  Plus,
  SendHorizonal,
  Smile,
  Sparkles,
  StickyNote,
  Trash2,
  Workflow,
  FolderOpen,
  X,
} from "lucide-react";
import { ChatScrollAnchor } from "@/components/agents/chat-scroll-anchor";
import { hayVersionNueva } from "@/components/app-version-guard";
import { ContactAvatar } from "@/components/chats/contact-avatar";
import { getContactDetailsAction, generateSuggestedReplyAction, refreshContactAvatarNowAction } from "@/app/actions/chats-actions";
import { sendChatLocationReplyAction } from "@/app/actions/agent-actions";
import { clearPendingConversationSelection } from "@/components/chats/chat-selection-store";
import { ChatTagsControl } from "@/components/chats/chat-tags-control";
import { QuickRepliesDialog } from "@/components/chats/quick-replies-dialog";
import { MediaLibraryDialog } from "@/components/chats/media-library-dialog";
import { subirArchivoPorPedazos } from "@/lib/subir-archivo-por-pedazos";
import { PlaybookPanelDialog } from "@/components/chats/playbook-panel-dialog";
import { ForwardMessageDialog } from "@/components/chats/forward-message-dialog";
import { SendFlowDialog } from "@/components/chats/send-flow-dialog";
import { InternalNoteDialog } from "@/components/chats/internal-note-dialog";
import { FollowUpDialog } from "@/components/chats/follow-up-dialog";
import { MediaPreviewDialog } from "@/components/chats/media-preview-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  ComposerReplyTarget,
  SharedInboxMessageItem,
  SharedInboxProps,
  SharedInboxSelectedConversation,
} from "./chat-inbox-types";
import { FichaDeCotizacion } from "@/features/cotizaciones/components/FichaDeCotizacion";
import { CHAT_COMPOSER_RECENT_KEY, type ComposerEmojiTab } from "./chat-inbox-emojis";
import { MessageBubble } from "./chat-message-bubble";
import { ComposerEmojiPicker, ComposerSendButton } from "./chat-composer";
import { AvisoDeCierre } from "./aviso-de-cierre";
import { BotonDeMapaDeCaminos } from "./boton-mapa-de-caminos";

const CHAT_MESSAGES_BACKGROUND_BASE_STYLE = {
  // Token por defecto de shadcn: blanco con una tonalidad un poco mas oscura.
  backgroundColor: "var(--muted)",
} as const;

const CHAT_MESSAGES_BACKGROUND_OVERLAY_STYLE = {
  backgroundImage: 'url("https://static.whatsapp.net/rsrc.php/yx/r/voSdkk88H7C.svg")',
  backgroundRepeat: "repeat",
  backgroundSize: "540px 960px",
  backgroundPosition: "0 0",
} as const;

type ConversationPanelProps = {
  backHref: string;
  composer: SharedInboxProps["composer"];
  composerHiddenFields: Array<{ name: string; value: string }>;
  hasSettledConversation: boolean;
  isLoadingOlderMessages: boolean;
  loadMoreSentinelRef: RefObject<HTMLDivElement | null>;
  messageScrollBehavior: "bottom" | "preserve";
  messagesScrollRef: RefObject<HTMLDivElement | null>;
  unreadCount: number;
  /** La firma de quien escribe. Se muestra en el campo para poder editarla o borrarla. */
  chatSignature: string;
  showJumpToBottom: boolean;
  onScrollToBottom: () => void;
  onEditContact: () => void;
  /** Dueño/admin: solo ellos pueden sumar el chat al mapa de caminos (cada uno cuesta IA). */
  isManager?: boolean;
  onComposerDraft: (message: string, formData: FormData) => void;
  onRetryFailedMessage?: () => void;
  onReplyToMessage?: (message: SharedInboxMessageItem) => void;
  onDeleteMessage?: (message: SharedInboxMessageItem) => void;
  replyTarget?: ComposerReplyTarget | null;
  onCancelReply?: () => void;
  onLoadOlderMessages: () => void | Promise<void>;
  renderedConversation: SharedInboxSelectedConversation | null;
  renderedMessages: SharedInboxMessageItem[];
  selectedConversationId: string;
  selectedConversationScrollKey: string;
  selectedConversationTags: Array<{
    label: string;
    color: string;
  }>;
  emptySelectionTitle: string;
  emptySelectionDescription: string;
  headerActions?: ReactNode;
  headerBadge?: ReactNode;
  contactPanelActions?: ReactNode;
  /**
   * Acciones de la CABECERA del panel de contacto, al lado del titulo.
   *
   * Traer el historial vivia en la barra del chat, apretado entre la etapa, el interruptor de la
   * IA y "Resolver". Es algo que se usa una vez por cliente y estaba compitiendo por lugar con
   * lo que se usa todo el dia; ademas en el celular ese renglon quedaba a reventar.
   */
  contactPanelHeaderActions?: ReactNode;
  canDeleteTags: boolean;
};

export const ConversationPanel = memo(function ConversationPanel({
  backHref,
  composer,
  composerHiddenFields,
  hasSettledConversation,
  isLoadingOlderMessages,
  loadMoreSentinelRef,
  messageScrollBehavior,
  messagesScrollRef,
  unreadCount,
  chatSignature,
  showJumpToBottom,
  onScrollToBottom,
  onEditContact,
  isManager = false,
  onComposerDraft,
  onRetryFailedMessage,
  onReplyToMessage,
  onDeleteMessage,
  replyTarget,
  onCancelReply,
  onLoadOlderMessages,
  renderedConversation,
  renderedMessages,
  selectedConversationId,
  selectedConversationScrollKey,
  emptySelectionTitle,
  emptySelectionDescription,
  headerActions,
  headerBadge,
  contactPanelActions,
  contactPanelHeaderActions,
  canDeleteTags,
}: ConversationPanelProps) {
  /**
   * Ya se respondio la pregunta del cierre en esta pantalla.
   *
   * El servidor tambien deja de mandarla, pero eso llega en el proximo repintado: sin este
   * estado la barra se queda un rato mas y parece que el toque no hizo nada.
   */
  const [cierreRespondido, setCierreRespondido] = useState(false);

  /**
   * El id PELADO del chat, para el mapa de caminos.
   *
   * `selectedConversationId` es la CLAVE del chat, con su fuente adelante ("agent:cmxxx"). Pasarla
   * tal cual a una accion que busca por id ya rompio el envio de mensajes una vez (commit 571d10e):
   * el WHERE no encontraba nada y fallaba en silencio.
   *
   * Los chats de la API oficial quedan afuera a proposito: viven en otra tabla y el mapa lee
   * Conversation. Mejor que el boton no aparezca a que aparezca y falle.
   */
  const idDeLaConversacionParaElMapa = selectedConversationId?.startsWith("agent:")
    ? selectedConversationId.slice("agent:".length)
    : "";
  const idDelChat = renderedConversation?.contactId ?? null;
  useEffect(() => {
    // Al cambiar de chat vuelve a preguntarse por el nuevo cliente.
    setCierreRespondido(false);
  }, [idDelChat]);

  const canLoadOlderMessages = Boolean(renderedConversation?.loadMoreCursor && renderedConversation.hasMoreMessages);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const [isQuickRepliesOpen, setIsQuickRepliesOpen] = useState(false);
  const [isPlaybookOpen, setIsPlaybookOpen] = useState(false);
  const [isSendFlowOpen, setIsSendFlowOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  // Mensaje que se esta reenviando (null = dialogo cerrado).
  const [mensajeAReenviar, setMensajeAReenviar] = useState<SharedInboxMessageItem | null>(null);
  const [isFollowUpOpen, setIsFollowUpOpen] = useState(false);
  // Archivos elegidos pendientes de confirmar en la vista previa (con caption) antes de enviar.
  const [pendingMediaFiles, setPendingMediaFiles] = useState<File[]>([]);
  const [isSuggestingReply, setIsSuggestingReply] = useState(false);
  const [emojiSearchQuery, setEmojiSearchQuery] = useState("");
  const [pestanaChat, setPestanaChat] = useState<"mensajes" | "cotizaciones">("mensajes");
  /**
   * "Escribiendo…", como en WhatsApp.
   *
   * No se guarda en la base: dura segundos y no es historia. Llega por el altavoz con el dato
   * adentro, porque un simple "algo cambio" no serviria -para cuando el navegador volviera a
   * preguntar, la persona ya paro-.
   */
  const [escribiendo, setEscribiendo] = useState<"escribiendo" | "grabando" | null>(null);
  const telefonoDelChat = renderedConversation?.secondaryLabel?.replace(/\D/g, "") ?? "";

  useEffect(() => {
    if (!telefonoDelChat) {
      return;
    }
    let apagar: ReturnType<typeof setTimeout> | null = null;

    const alLlegar = (evento: Event) => {
      const detalle = (evento as CustomEvent).detail as
        | { telefono?: string; activo?: boolean; que?: "escribiendo" | "grabando" | null }
        | null;
      if (!detalle?.telefono) {
        return;
      }
      if (detalle.telefono.replace(/\D/g, "") !== telefonoDelChat) {
        return;
      }

      if (apagar) {
        clearTimeout(apagar);
        apagar = null;
      }
      setEscribiendo(detalle.activo ? detalle.que ?? "escribiendo" : null);

      /*
        Apagado por las dudas a los 10 segundos.

        WhatsApp avisa cuando alguien PARA de escribir, pero ese aviso se puede perder -se corto la
        red, se cerro el chat-. Sin este limite, el "escribiendo…" quedaria clavado para siempre y
        la asesora esperaria un mensaje que no viene.
      */
      if (detalle.activo) {
        apagar = setTimeout(() => setEscribiendo(null), 10_000);
      }
    };

    window.addEventListener("chat-presence", alLlegar);
    return () => {
      window.removeEventListener("chat-presence", alLlegar);
      if (apagar) {
        clearTimeout(apagar);
      }
    };
  }, [telefonoDelChat]);

  // Al cambiar de chat se limpia: si no, se arrastraria el "escribiendo…" del anterior.
  useEffect(() => {
    setEscribiendo(null);
  }, [selectedConversationId]);
  const [emojiPickerTab, setEmojiPickerTab] = useState<ComposerEmojiTab>("todos");
  const [recentComposerEmojis, setRecentComposerEmojis] = useState<string[]>([]);
  const [recentComposerEmojisReady, setRecentComposerEmojisReady] = useState(false);
  const composerTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerSelectionRef = useRef({ start: 0, end: 0 });
  const composerRouter = useRouter();
  const [isRefreshingAvatar, setIsRefreshingAvatar] = useState(false);
  const [composerHasText, setComposerHasText] = useState(false);
  /**
   * El texto del cuadro salio de una respuesta rapida.
   *
   * Las respuestas rapidas son mensajes YA redactados (el catalogo, la garantia, los medios de
   * pago). Pegarles arriba "👩‍💻 Ingrid Sánchez" los arruina: quedan como si la asesora hubiera
   * escrito un anuncio. La firma tiene sentido cuando ella escribe de su puño, no acá.
   */
  const [desdeRespuestaRapida, setDesdeRespuestaRapida] = useState(false);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [isSendingAudio, setIsSendingAudio] = useState(false);

  // Trae la foto de perfil del contacto abierto AL INSTANTE (acción manual del usuario).
  const handleRefreshAvatar = useCallback(async () => {
    const contactId = renderedConversation?.contactId;
    if (!contactId || isRefreshingAvatar) {
      return;
    }
    setIsRefreshingAvatar(true);
    try {
      const result = await refreshContactAvatarNowAction(contactId);
      if (result.ok) {
        toast.success("Foto actualizada");
        composerRouter.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("No se pudo traer la foto");
    } finally {
      setIsRefreshingAvatar(false);
    }
  }, [renderedConversation?.contactId, isRefreshingAvatar, composerRouter]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordCancelledRef = useRef(false);
  const audioConfig = composer?.audio;
  const mediaConfig = composer?.media;
  const mediaFileInputRef = useRef<HTMLInputElement | null>(null);
  // Aparte del de fotos: con un solo input, el selector del celular ofrece la galeria y esconde
  // el explorador de archivos, que es justo donde esta el PDF.
  const documentoFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isSendingMedia, setIsSendingMedia] = useState(false);
  const [isSendingLocation, setIsSendingLocation] = useState(false);
  // Mensajes optimistas de archivos en envío: el documento/imagen aparece en el chat con un
  // spinner mientras se envía (estilo WhatsApp), SIN bloquear el composer. Se ocultan solos
  // cuando llega el mensaje real (se deduplican por mediaUrl en el render).
  const [optimisticMediaMessages, setOptimisticMediaMessages] = useState<SharedInboxMessageItem[]>([]);
  // Lista final a renderizar: mensajes reales + optimistas que aún no llegaron (mismo
  // mediaUrl ⇒ ya está el real, se descarta el optimista para no duplicar).
  const displayedMessages = useMemo(() => {
    if (optimisticMediaMessages.length === 0) {
      return renderedMessages;
    }
    const pending = optimisticMediaMessages.filter(
      (optimistic) =>
        !renderedMessages.some((real) => Boolean(real.mediaUrl) && real.mediaUrl === optimistic.mediaUrl),
    );
    return pending.length === 0 ? renderedMessages : [...renderedMessages, ...pending];
  }, [renderedMessages, optimisticMediaMessages]);
  const [isContactPanelOpen, setIsContactPanelOpen] = useState(false);
  const isMobile = useIsMobile();
  const [contactCity, setContactCity] = useState("");
  // Etiquetas REALES del contacto para el panel. renderedConversation.tags viene del detalle
  // (loader + /live), que NO incluye tags → al abrir un chat con clic el panel salía vacío
  // aunque la lista sí mostraba "Lead". Las traemos de getContactDetailsAction (ContactTag real)
  // y las mantenemos en sync con el evento global al agregar/quitar.
  const [contactPanelTags, setContactPanelTags] = useState<Array<{ label: string; color: string }> | null>(null);

  const panelContactId = renderedConversation?.contactId ?? null;
  useEffect(() => {
    if (!isContactPanelOpen || !panelContactId) {
      setContactCity("");
      setContactPanelTags(null);
      return;
    }

    let cancelled = false;
    getContactDetailsAction(panelContactId).then((result) => {
      if (cancelled) return;
      if ("details" in result) {
        setContactCity(result.details.city);
        setContactPanelTags(result.details.tags.map((tag) => ({ label: tag.name, color: tag.color })));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isContactPanelOpen, panelContactId]);

  // Sincroniza las etiquetas del panel cuando se agregan/quitan (ChatTagsControl emite este
  // evento). Sin esto, mostrar contactPanelTags (que preferimos sobre renderedConversation.tags)
  // dejaría el badge "pegado" tras quitar una etiqueta.
  useEffect(() => {
    if (!panelContactId) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { contactId?: string; tags?: Array<{ label: string; color: string }> }
        | undefined;
      if (!detail || detail.contactId !== panelContactId) return;
      setContactPanelTags(detail.tags ?? []);
    };
    window.addEventListener("chat-tags-updated", handler as EventListener);
    return () => window.removeEventListener("chat-tags-updated", handler as EventListener);
  }, [panelContactId]);

  // Manda la ubicación del local con un toque. Las coordenadas viven en la configuración de
  // Negocio (no las elige quien envía), así que acá solo hace falta saber a qué chat va.
  const handleSendLocation = useCallback(async () => {
    const conversationId = mediaConfig?.conversationId ?? audioConfig?.conversationId;
    if (!conversationId || isSendingLocation) {
      return;
    }

    setIsSendingLocation(true);
    try {
      const result = await sendChatLocationReplyAction({
        conversationId,
        agentId: mediaConfig?.agentId ?? audioConfig?.agentId ?? undefined,
        returnTo: mediaConfig?.returnTo ?? audioConfig?.returnTo ?? undefined,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Ubicación enviada");
      onScrollToBottom?.();
    } catch {
      toast.error("No se pudo enviar la ubicación");
    } finally {
      setIsSendingLocation(false);
    }
  }, [mediaConfig, audioConfig, isSendingLocation, onScrollToBottom]);

  // Sube y envía UN archivo; devuelve true si se envió. No toca el estado de carga global
  // (eso lo maneja el batch) para poder reutilizarlo al enviar varios en secuencia.
  const sendSingleMediaFile = useCallback(
    async (file: File, caption?: string): Promise<boolean> => {
      if (!mediaConfig) {
        return false;
      }

      const trimmedCaption = caption?.trim() || "";
      let optimisticId: string | null = null;
      try {
        /**
         * Por pedazos, con reintento por pedazo.
         *
         * Es el camino que mas se usa: la asesora toca adjuntar, entra a Drive, el catalogo se
         * BAJA al celular y se SUBE aca. Con la señal de la calle (14-32 KB/s medidos el
         * 14-ago-2026) 15 MB en una sola peticion tardan entre 8 y 18 minutos y no llegan a
         * terminar: se cortaba sin dejar rastro y el chat decia "No se pudo enviar".
         */
        const subida = await subirArchivoPorPedazos({
          file,
          endpoint: `${mediaConfig.uploadPath}/chunk`,
        });
        if (subida.error || !subida.archivo) {
          toast.error(subida.error || `No se pudo subir "${file.name}".`);
          return false;
        }
        const data = subida.archivo;

        // Burbuja optimista: el archivo aparece en el chat con spinner mientras se envía.
        optimisticId = `optimistic-media:${data.url}`;
        const optimisticMessage: SharedInboxMessageItem = {
          id: optimisticId,
          content: trimmedCaption || null,
          direction: "OUTBOUND",
          createdAt: new Date(),
          authorType: "bot",
          outboundStatusLabel: null,
          type: data.mediaType,
          mediaUrl: data.url,
          rawPayload: {
            source: "manual",
            fileName: data.fileName || file.name,
            mimeType: data.mimeType || file.type,
            fileSize: file.size,
          },
        };
        setOptimisticMediaMessages((prev) => [...prev, optimisticMessage]);
        window.requestAnimationFrame(() => onScrollToBottom());

        const result = await mediaConfig.sendAction({
          source: mediaConfig.source,
          conversationId: mediaConfig.conversationId,
          agentId: mediaConfig.agentId,
          mediaUrl: data.url,
          mediaType: data.mediaType,
          fileName: data.fileName || file.name,
          mimeType: data.mimeType || file.type,
          caption: trimmedCaption || undefined,
          returnTo: mediaConfig.returnTo,
        });

        if (result && "ok" in result && result.ok) {
          return true;
        }

        // Falló el envío: quitar la burbuja optimista.
        setOptimisticMediaMessages((prev) => prev.filter((message) => message.id !== optimisticId));
        toast.error((result && "error" in result && result.error) || `No se pudo enviar "${file.name}".`);
        return false;
      } catch {
        if (optimisticId) {
          const failedId = optimisticId;
          setOptimisticMediaMessages((prev) => prev.filter((message) => message.id !== failedId));
        }

        /**
         * La causa mas comun de que reviente aca no tiene nada que ver con el archivo: la app
         * lleva horas abierta, desplegamos, y el envio le pega a una version del servidor que
         * ya no existe. Decirle "no se pudo enviar el PDF" manda a la asesora a pelear con el
         * archivo equivocado, asi que primero se pregunta si la pagina quedo vieja.
         */
        if (await hayVersionNueva()) {
          toast.error("Actualizamos la app. Recargá y volvé a mandarlo.", {
            duration: 15000,
            action: { label: "Recargar", onClick: () => window.location.reload() },
          });
          return false;
        }

        toast.error(`No se pudo enviar "${file.name}".`);
        return false;
      }
    },
    [mediaConfig, onScrollToBottom],
  );

  // Envía uno o varios archivos en secuencia. No bloquea el composer: cada archivo aparece
  // como burbuja optimista con spinner y se resuelve al llegar el mensaje real.
  const uploadAndSendMediaFiles = useCallback(
    async (files: File[], caption?: string) => {
      if (!mediaConfig || files.length === 0) {
        return;
      }

      setIsSendingMedia(true);

      let sentCount = 0;
      for (let index = 0; index < files.length; index += 1) {
        // El caption (mensaje) va con el primer archivo, como WhatsApp.
        const ok = await sendSingleMediaFile(files[index], index === 0 ? caption : undefined);
        if (ok) {
          sentCount += 1;
        }
      }

      if (sentCount > 0) {
        composerRouter.refresh();
      }

      setIsSendingMedia(false);
    },
    [mediaConfig, sendSingleMediaFile, composerRouter],
  );

  const stopRecordTracks = useCallback(() => {
    recordStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordStreamRef.current = null;
  }, []);

  const clearRecordTimer = useCallback(() => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }, []);

  const uploadAndSendAudio = useCallback(
    async (blob: Blob, mimeType: string) => {
      if (!audioConfig) {
        return;
      }

      setIsSendingAudio(true);
      let optimisticId: string | null = null;
      try {
        // El mime de MediaRecorder suele venir como "audio/webm;codecs=opus"; usamos el tipo base.
        const baseMime = mimeType.split(";")[0].trim() || "audio/webm";
        const ext = baseMime.includes("ogg") || baseMime.includes("opus") ? "ogg" : baseMime.includes("mp4") ? "mp4" : "webm";
        const file = new File([blob], `nota-de-voz-${Date.now()}.${ext}`, { type: baseMime });
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(audioConfig.uploadPath, { method: "POST", body: formData });
        const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
        if (!response.ok || !data?.url) {
          toast.error(data?.error || "No se pudo subir la nota de voz.");
          return;
        }

        optimisticId = `optimistic-media:${data.url}`;
        const optimisticMessage: SharedInboxMessageItem = {
          id: optimisticId,
          content: null,
          direction: "OUTBOUND",
          createdAt: new Date(),
          authorType: "bot",
          outboundStatusLabel: null,
          type: "AUDIO",
          mediaUrl: data.url,
          rawPayload: {
            source: "manual",
            fileName: file.name,
            mimeType: baseMime,
            fileSize: file.size,
          },
        };
        setOptimisticMediaMessages((prev) => [...prev, optimisticMessage]);
        window.requestAnimationFrame(() => onScrollToBottom());

        const result = await audioConfig.sendAction({
          source: audioConfig.source,
          conversationId: audioConfig.conversationId,
          agentId: audioConfig.agentId,
          audioUrl: data.url,
          returnTo: audioConfig.returnTo,
        });

        if (result && "ok" in result && result.ok) {
          composerRouter.refresh();
        } else {
          if (optimisticId) {
            const failedId = optimisticId;
            setOptimisticMediaMessages((prev) => prev.filter((message) => message.id !== failedId));
          }
          toast.error((result && "error" in result && result.error) || "No se pudo enviar la nota de voz.");
        }
      } catch {
        if (optimisticId) {
          const failedId = optimisticId;
          setOptimisticMediaMessages((prev) => prev.filter((message) => message.id !== failedId));
        }
        toast.error("No se pudo enviar la nota de voz.");
      } finally {
        setIsSendingAudio(false);
      }
    },
    [audioConfig, composerRouter, onScrollToBottom],
  );

  const startAudioRecording = useCallback(async () => {
    if (!audioConfig || isRecordingAudio || isSendingAudio) {
      return;
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recordCancelledRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        clearRecordTimer();
        stopRecordTracks();
        setIsRecordingAudio(false);
        setRecordSeconds(0);

        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        const cancelled = recordCancelledRef.current;
        const mimeType = recorder.mimeType || "audio/webm";

        if (cancelled || chunks.length === 0) {
          return;
        }

        void uploadAndSendAudio(new Blob(chunks, { type: mimeType }), mimeType);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecordingAudio(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => setRecordSeconds((value) => value + 1), 1000);
    } catch {
      stopRecordTracks();
    }
  }, [audioConfig, clearRecordTimer, isRecordingAudio, isSendingAudio, stopRecordTracks, uploadAndSendAudio]);

  const stopAndSendAudio = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      recordCancelledRef.current = false;
      mediaRecorderRef.current.stop();
    }
  }, []);

  const cancelAudioRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      recordCancelledRef.current = true;
      mediaRecorderRef.current.stop();
    }
  }, []);

  useEffect(() => {
    return () => {
      clearRecordTimer();
      stopRecordTracks();
    };
  }, [clearRecordTimer, stopRecordTracks]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CHAT_COMPOSER_RECENT_KEY);
      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        return;
      }

      const nextRecent = parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
      if (nextRecent.length > 0) {
        setRecentComposerEmojis(nextRecent.slice(0, 24));
      }
    } catch {
      // Ignore storage parsing issues.
    } finally {
      setRecentComposerEmojisReady(true);
    }
  }, []);

  useEffect(() => {
    if (!recentComposerEmojisReady) {
      return;
    }

    try {
      window.localStorage.setItem(CHAT_COMPOSER_RECENT_KEY, JSON.stringify(recentComposerEmojis.slice(0, 24)));
    } catch {
      // Ignore storage write issues.
    }
  }, [recentComposerEmojis, recentComposerEmojisReady]);

  useEffect(() => {
    composerSelectionRef.current = { start: 0, end: 0 };
    setIsEmojiPickerOpen(false);
    setEmojiSearchQuery("");
    setEmojiPickerTab("todos");
  }, [selectedConversationId]);

  const syncComposerSelection = useCallback((target: HTMLTextAreaElement | null) => {
    if (!target) {
      return;
    }

    composerSelectionRef.current = {
      start: target.selectionStart ?? target.value.length,
      end: target.selectionEnd ?? target.value.length,
    };
  }, []);

  // Ajusta la altura del textarea al contenido para que se expanda hacia arriba
  // (el composer esta anclado abajo) en lugar de mostrar scroll. Solo aparece
  // scroll una vez superada la altura maxima.
  const autoResizeComposer = useCallback((target: HTMLTextAreaElement | null) => {
    if (!target) {
      return;
    }

    const maxHeight = 160;
    target.style.height = "auto";
    const nextHeight = Math.min(target.scrollHeight, maxHeight);
    target.style.height = `${nextHeight}px`;
    target.style.overflowY = target.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  const firma = chatSignature.trim();

  /**
   * Interruptor para mandar SIN firma.
   *
   * La firma la agrega el servidor al enviar, asi que en el campo no se ve y no habia forma de
   * sacarla cuando no correspondia: un dato suelto, una respuesta seca, un reenvio. Esto la apaga
   * para los mensajes que siguen —queda apagada hasta que se vuelva a prender— sin tener que
   * borrarla a mano cada vez.
   */
  const [firmaActiva, setFirmaActiva] = useState(true);

  const insertComposerEmoji = useCallback((emoji: string) => {
    const textarea = composerTextAreaRef.current;
    if (!textarea) {
      return;
    }

    const currentValue = textarea.value;
    const fallbackSelection = composerSelectionRef.current;
    const start = textarea.selectionStart ?? fallbackSelection.start ?? currentValue.length;
    const end = textarea.selectionEnd ?? fallbackSelection.end ?? currentValue.length;
    const nextCursor = start + emoji.length;

    textarea.setRangeText(emoji, start, end, "end");
    composerSelectionRef.current = { start: nextCursor, end: nextCursor };
    setComposerHasText(textarea.value.trim().length > 0);
    autoResizeComposer(textarea);
    setIsEmojiPickerOpen(false);
    setEmojiSearchQuery("");
    setRecentComposerEmojis((current) => [emoji, ...current.filter((item) => item !== emoji)].slice(0, 24));

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }, [autoResizeComposer]);

  // Inserta el texto de una respuesta rápida en el cuadro (en la posición del cursor),
  // sin enviarlo, para que la chica lo revise/edite antes de mandar.
  const insertQuickReply = useCallback((content: string) => {
    const textarea = composerTextAreaRef.current;
    if (!textarea) {
      return;
    }

    const currentValue = textarea.value;
    const fallbackSelection = composerSelectionRef.current;
    const start = textarea.selectionStart ?? fallbackSelection.start ?? currentValue.length;
    const end = textarea.selectionEnd ?? fallbackSelection.end ?? currentValue.length;
    const nextCursor = start + content.length;

    textarea.setRangeText(content, start, end, "end");
    composerSelectionRef.current = { start: nextCursor, end: nextCursor };
    setComposerHasText(textarea.value.trim().length > 0);
    setDesdeRespuestaRapida(true);
    autoResizeComposer(textarea);

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }, [autoResizeComposer]);

  const handleSuggestReply = useCallback(async () => {
    // Se usa el chat REALMENTE abierto y no mediaConfig: en los chats de la API oficial ese
    // config no existía, así que el botón ✨ se veía pero al tocarlo no pasaba NADA (ni un aviso).
    const conversationId =
      renderedConversation?.id ?? mediaConfig?.conversationId ?? audioConfig?.conversationId;
    if (!conversationId || isSuggestingReply) {
      return;
    }

    setIsSuggestingReply(true);
    try {
      const result = await generateSuggestedReplyAction(conversationId);
      if (result.error || !result.suggestion) {
        toast.error(result.error || "No se pudo generar la sugerencia");
        return;
      }

      const textarea = composerTextAreaRef.current;
      if (textarea) {
        const suggestion = result.suggestion;
        textarea.value = suggestion;
        composerSelectionRef.current = { start: suggestion.length, end: suggestion.length };
        setComposerHasText(suggestion.trim().length > 0);
        autoResizeComposer(textarea);
        window.requestAnimationFrame(() => {
          textarea.focus();
          textarea.setSelectionRange(suggestion.length, suggestion.length);
        });
      }
    } catch (error) {
      console.error("[handleSuggestReply] error", error);
      toast.error("No se pudo generar la sugerencia");
    } finally {
      setIsSuggestingReply(false);
    }
  }, [renderedConversation?.id, mediaConfig?.conversationId, audioConfig?.conversationId, isSuggestingReply, autoResizeComposer]);

  const contactPanelContent = renderedConversation ? (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div className="flex items-center gap-3">
        <ContactAvatar
          avatarUrl={renderedConversation.avatarUrl}
          label={renderedConversation.label}
          className="h-12 w-12 shrink-0 rounded-full border border-border bg-muted text-muted-foreground"
          fallbackClassName="rounded-full bg-muted text-muted-foreground"
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate text-sm font-semibold text-foreground">
            {renderedConversation.label}
          </p>
          {renderedConversation.secondaryLabel ? (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">{renderedConversation.secondaryLabel}</span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(renderedConversation.secondaryLabel);
                  toast.success("Copiado");
                }}
                aria-label="Copiar número"
                title="Copiar"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
          {contactCity ? (
            <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">{contactCity}</span>
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        {renderedConversation.contactId ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onEditContact}
            className="h-8 w-8"
            aria-label="Editar"
            title="Editar"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {/*
          Sumar este chat al mapa de caminos.

          Solo para dueño/admin: cada chat que entra cuesta una llamada a la IA, y esto se enciende
          para ver si sirve antes de dejarlo suelto para todo el equipo.
        */}
        {isManager && idDeLaConversacionParaElMapa ? (
          <BotonDeMapaDeCaminos conversationId={idDeLaConversacionParaElMapa} />
        ) : null}
      </div>

      <div className="mt-5 space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Etiquetas
        </h4>
        <ChatTagsControl
          contactId={renderedConversation.contactId}
          conversationId={renderedConversation.id}
          tags={contactPanelTags ?? renderedConversation.tags ?? []}
          canDelete={canDeleteTags}
        />
      </div>

      {contactPanelActions ? (
        <div className="mt-5 space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Agente asignado
          </h4>
          {contactPanelActions}
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <Card
      className={`${selectedConversationId ? "flex md:flex" : "!hidden md:!flex"} chat-inbox-panel relative min-h-0 flex-1 overflow-hidden rounded-none border border-border bg-transparent p-0 shadow-none md:h-full md:shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)]`}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={CHAT_MESSAGES_BACKGROUND_BASE_STYLE} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.08] dark:opacity-[0.14] dark:invert" style={CHAT_MESSAGES_BACKGROUND_OVERLAY_STYLE} />
      {renderedConversation ? (
        <div className="relative z-10 flex min-h-0 h-full w-full flex-1">
        <div className="flex min-h-0 h-full min-w-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-border bg-card px-3 pb-2 pt-[max(env(safe-area-inset-top),0.5rem)] min-h-[3.25rem] md:min-h-0 md:px-[10px] md:py-[10px]">
            <div className="@container/chathdr flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Link
                  href={backHref}
                  prefetch={false}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
                      return;
                    }

                    // Volver a la lista tampoco navega: alcanza con cerrar el chat en la fuente
                    // unica (es lo que decide que vista se ve en movil) y devolver la URL.
                    // Navegando se re-ejecutarian las consultas caras de la pagina solo para
                    // pintar la lista que ya esta en memoria.
                    event.preventDefault();
                    clearPendingConversationSelection();
                    window.history.pushState(null, "", backHref);
                  }}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-black transition hover:opacity-70 md:hidden"
                  aria-label="Volver a chats"
                >
                  <ArrowLeft className="h-6 w-6" />
                </Link>
                <div
                  className={`flex min-w-0 items-center gap-3 transition-opacity duration-200 ease-out ${
                    hasSettledConversation ? "opacity-100" : "opacity-80"
                  }`}
                >
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger
                        type="button"
                        onClick={() => setIsContactPanelOpen((open) => !open)}
                        className="group relative shrink-0 rounded-full transition focus:outline-none focus:ring-2 focus:ring-ring/50"
                        aria-label={isContactPanelOpen ? "Cerrar detalles del contacto" : "Abrir detalles del contacto"}
                        title="Contacto"
                      >
                        <span className="relative block">
                          <ContactAvatar
                            avatarUrl={renderedConversation.avatarUrl}
                            label={renderedConversation.label}
                            className="h-9 w-9 rounded-full border-0 bg-muted text-muted-foreground after:border-0 transition"
                            fallbackClassName="rounded-full bg-muted text-muted-foreground"
                          />
                        </span>
                      </TooltipTrigger>
                      {renderedConversation.secondaryLabel ? (
                        <TooltipContent side="right">
                          {renderedConversation.secondaryLabel}
                        </TooltipContent>
                      ) : null}
                    </Tooltip>
                  </TooltipProvider>
                  <div className="min-w-0 space-y-0.5">
                    {/*
                      Nombre y telefono en grande: es el dato que confirma A QUIEN le estas
                      escribiendo, y se mira de reojo mientras se escribe. Con 13px se leia como
                      un detalle secundario del encabezado.
                    */}
                    <h2 className="truncate text-[14px] font-semibold leading-tight text-foreground">
                      {renderedConversation.label}
                    </h2>
                    {/*
                      El telefono, a la vista. Antes solo aparecia al pasar el mouse por la foto:
                      en el celular eso no existe, asi que para saber a quien le estaban
                      escribiendo tocaba abrir el panel del contacto. Se omite cuando el nombre
                      YA es el numero (contacto sin nombre), para no escribirlo dos veces.
                    */}
                    {escribiendo ? (
                      /* Reemplaza al telefono, como hace WhatsApp: el dato de ahora importa mas. */
                      <p className="truncate text-[13px] font-medium leading-tight text-emerald-600 dark:text-emerald-400">
                        {escribiendo === "grabando" ? "grabando audio…" : "escribiendo…"}
                      </p>
                    ) : renderedConversation.secondaryLabel &&
                      renderedConversation.secondaryLabel !== renderedConversation.label ? (
                      <p className="truncate text-[13px] leading-tight text-muted-foreground">
                        {renderedConversation.secondaryLabel}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>

              {hasSettledConversation && (headerActions || headerBadge) ? (
                <div className="flex shrink-0 items-center justify-end gap-2">
                  {headerActions}
                  {headerBadge}
                </div>
              ) : null}
            </div>
          </div>

          {/*
            Pestañas del chat. "Cotizaciones" tiene la ficha de datos del cliente: la que hoy se
            llena releyendo la conversacion hacia arriba para copiar la cedula y la direccion.
          */}
          <div className="flex shrink-0 items-center gap-4 border-b border-border bg-card px-3 md:px-5">
            {(["mensajes", "cotizaciones"] as const).map((pestana) => {
              const activa = pestanaChat === pestana;
              return (
                <button
                  key={pestana}
                  type="button"
                  onClick={() => setPestanaChat(pestana)}
                  aria-current={activa ? "page" : undefined}
                  className={`-mb-px border-b-2 px-1 py-2 text-[13px] font-medium transition ${
                    activa
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {pestana === "mensajes" ? "Mensajes" : "Cotizaciones"}
                </button>
              );
            })}
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col bg-transparent">
            {pestanaChat === "cotizaciones" ? (
              <div className="absolute inset-0 z-30 flex flex-col bg-background">
                {renderedConversation?.contactId ? (
                  /*
                    Con `key` por contacto: al saltar de un chat a otro el componente arranca de
                    cero. Sin eso quedaban a la vista las sugerencias de un cliente sobre la ficha
                    del siguiente, que es la peor forma posible de equivocar una direccion.
                  */
                  <FichaDeCotizacion
                    key={renderedConversation.contactId}
                    contactId={renderedConversation.contactId}
                    conversationId={selectedConversationId ?? undefined}
                  />
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                    <FileText className="size-8 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">Cotizaciones</p>
                    <p className="max-w-xs text-xs text-muted-foreground">
                      Abrí un chat para ver los datos del cliente.
                    </p>
                  </div>
                )}
              </div>
            ) : null}
            {/*
              La pregunta del cierre, arriba de los mensajes.

              Va acá y no en el Kanban porque este es el momento y el lugar donde la asesora sabe
              si se cerró. Pedirle que se acuerde de ir a arrastrar la tarjeta despues es
              exactamente lo que no pasaba: 4 ventas registradas en toda la historia del CRM.
            */}
            {renderedConversation?.cierrePendiente && renderedConversation.contactId && !cierreRespondido ? (
              <AvisoDeCierre
                contactId={renderedConversation.contactId}
                alResponder={() => setCierreRespondido(true)}
              />
            ) : null}
            <div className="relative min-h-0 flex-1">
              <div
                ref={messagesScrollRef}
                className="chat-messages-scroll h-full overflow-y-auto overscroll-contain bg-transparent px-2.5 py-2.5 pb-3 [-webkit-overflow-scrolling:touch] md:px-5 md:py-5 md:pb-5"
              >
                <div className="flex min-h-full flex-col justify-end">
                  {renderedConversation?.isPreview ? (
                    <div
                      className="flex justify-center pb-2.5 pt-1"
                      role="status"
                      aria-label="Cargando conversación"
                    >
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-muted text-foreground shadow-sm">
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      </span>
                    </div>
                  ) : null}
                  {canLoadOlderMessages ? (
                    <div className="pb-2 pt-1">
                      <div ref={loadMoreSentinelRef} aria-hidden="true" className="h-px w-full" />
                      {/*
                        Mismo tratamiento que la pastilla de fecha, y por el mismo motivo: flota
                        sobre el fondo estampado del chat, asi que en tema oscuro un gris medio
                        sobre `bg-card` (casi negro) no se leia. Es el unico camino para ver lo
                        que se hablo antes.
                      */}
                      {renderedConversation.loadMoreHref ? (
                        <div className="flex justify-center">
                          <Link
                            href={renderedConversation.loadMoreHref}
                            scroll={false}
                            className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1.5 text-[11px] font-medium text-foreground shadow-sm transition hover:bg-accent"
                          >
                            Cargar mensajes anteriores
                          </Link>
                        </div>
                      ) : isLoadingOlderMessages ? (
                        <div className="flex justify-center px-3 py-1.5">
                          <span
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-muted text-foreground shadow-sm"
                            aria-label="Cargando historial"
                            role="status"
                          >
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                          </span>
                        </div>
                      ) : (
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={() => void onLoadOlderMessages()}
                            className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1.5 text-[11px] font-medium text-foreground shadow-sm transition hover:bg-accent"
                          >
                            Cargar mensajes anteriores
                          </button>
                        </div>
                      )}
                    </div>
                  ) : null}
                  <div className="space-y-2.5 md:space-y-3">
                    {displayedMessages.map((message, index) => (
                      <MessageBubble
                        key={message.id}
                        message={message}
                        previousMessage={displayedMessages[index - 1]}
                        onRetry={
                          message.outboundStatusLabel === "error" ? onRetryFailedMessage : undefined
                        }
                        onReply={onReplyToMessage}
                        onForward={setMensajeAReenviar}
                        onDelete={onDeleteMessage}
                      />
                    ))}
                    {/*
                      La burbujita de los tres puntos, al final de la conversacion.

                      Va DESPUES del ultimo mensaje y no en el encabezado porque es ahi donde uno
                      esta mirando mientras espera una respuesta. Es la misma senal que da WhatsApp
                      y significa lo mismo: no te vayas, esta contestando.
                    */}
                    {escribiendo ? (
                      <div className="flex justify-start px-1 pb-1 pt-0.5">
                        <div className="inline-flex items-center gap-1 rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-2 shadow-sm">
                          <span className="sr-only">
                            {escribiendo === "grabando" ? "Grabando audio" : "Escribiendo"}
                          </span>
                          {[0, 1, 2].map((punto) => (
                            <span
                              key={punto}
                              aria-hidden="true"
                              className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70"
                              // El desfase es lo que hace que "salten" en ola en vez de a la vez.
                              style={{ animationDelay: `${punto * 150}ms`, animationDuration: "1s" }}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {messageScrollBehavior === "preserve" ? (
                      <ChatScrollAnchor dependencyKey={selectedConversationScrollKey} behavior="preserve" />
                    ) : null}
                  </div>
                </div>
              </div>
              {/*
                Bajar al ultimo mensaje, como en WhatsApp. Aparece apenas se sube lo suficiente
                como para perder de vista el final —antes solo salia si habian llegado mensajes,
                asi que quien subia a buscar algo tenia que devolverse a mano— y si mientras tanto
                llega algo, lleva encima cuantos mensajes son.
              */}
              {showJumpToBottom || unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={onScrollToBottom}
                  aria-label={
                    unreadCount > 0
                      ? `Ir al ultimo mensaje (${unreadCount} sin leer)`
                      : "Ir al ultimo mensaje"
                  }
                  title="Ir al último mensaje"
                  className="absolute bottom-4 right-4 z-10 inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg transition hover:bg-muted"
                >
                  <ChevronDown className="h-5 w-5" />
                  {unreadCount > 0 ? (
                    <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[10px] font-semibold leading-none text-white">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  ) : null}
                </button>
              ) : null}
            </div>

            {/*
              El relleno de abajo sale del AREA SEGURA y no de un piso fijo.

              Un piso fijo levantaba el compositor en Android, donde no hay barra de gestos que
              esquivar. `env(safe-area-inset-bottom)` da justo lo que hace falta en cada aparato:
              en iPhone la altura de la barra, en Android 0. Para que iOS lo informe, el viewport
              se declara con `viewport-fit: cover` (ver generateViewport en app/layout).
            */}
            {composer && renderedConversation ? (
              <div className="chat-composer z-20 shrink-0 bg-transparent px-1.5 pb-[calc(env(safe-area-inset-bottom)+0.375rem)] pt-1.5 md:px-2 md:py-2">
                <form
                  className="mx-auto w-full max-w-5xl"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const formData = new FormData(form);
                    const message = String(formData.get("message") || "").trim();

                    if (!message || !renderedConversation) {
                      return;
                    }

                    // Respuesta rapida: va tal cual, sin la firma encima.
                    if (desdeRespuestaRapida) {
                      formData.set("skipSignature", "1");
                    }

                    // Firma apagada: el mensaje sale tal cual, sin encabezado.
                    if (!firmaActiva) {
                      formData.set("skipSignature", "1");
                    }

                    // El handler externo crea la burbuja optimista y envia sin
                    // navegacion (la accion valida internamente y devuelve resultado).
                    onComposerDraft(message, formData);
                    setComposerHasText(false);
                    setDesdeRespuestaRapida(false);
                    form.reset();
                    autoResizeComposer(composerTextAreaRef.current);
                  }}
                >
                  {composerHiddenFields.map((field) => (
                    <input key={`${field.name}-${field.value}`} type="hidden" name={field.name} value={field.value} />
                  ))}

                  {replyTarget ? (
                    <div className="mb-1.5 flex items-center gap-2 rounded-xl border-l-4 border-[var(--primary)] bg-muted/70 px-3 py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold text-[var(--primary)]">
                          {replyTarget.direction === "OUTBOUND" ? "Tú" : "Cliente"}
                        </p>
                        <p className="truncate text-[12px] text-muted-foreground">
                          {replyTarget.content || "Mensaje"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={onCancelReply}
                        aria-label="Cancelar respuesta"
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-background hover:text-foreground"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ) : null}

                  <div className="flex items-end gap-2 md:gap-3">
                    {isRecordingAudio ? (
                      <div className="flex min-h-[38px] flex-1 items-center gap-2 rounded-2xl border border-border bg-muted/80 px-4 text-sm text-foreground md:min-h-[40px]">
                        <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                        <span className="font-medium">Grabando</span>
                        <span className="tabular-nums text-muted-foreground">
                          {`${Math.floor(recordSeconds / 60)}:${String(recordSeconds % 60).padStart(2, "0")}`}
                        </span>
                        <div className="ml-auto flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={cancelAudioRecording}
                            aria-label="Cancelar grabacion"
                            title="Cancelar"
                            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-background hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 md:size-8"
                          >
                            <Trash2 className="size-5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={stopAndSendAudio}
                            aria-label="Enviar nota de voz"
                            title="Enviar"
                            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--primary)] transition hover:bg-background focus:outline-none focus:ring-2 focus:ring-ring/50 md:size-8"
                          >
                            <SendHorizonal className="size-6" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex min-h-[38px] min-w-0 flex-1 items-center gap-0.5 rounded-2xl border border-border bg-card px-1.5 shadow-[0_1px_6px_#0000001f] transition focus-within:border-[var(--primary)] focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/50 md:min-h-[40px]">
                        {mediaConfig ? (
                          <>
                            <input
                              ref={mediaFileInputRef}
                              type="file"
                              accept="image/*,video/*"
                              multiple
                              className="hidden"
                              onChange={(event) => {
                                const files = Array.from(event.currentTarget.files ?? []);
                                event.currentTarget.value = "";
                                if (files.length > 0) {
                                  setPendingMediaFiles(files);
                                }
                              }}
                            />
                            <input
                              ref={documentoFileInputRef}
                              type="file"
                              /*
                                Se listan los tipos en vez de aceptar cualquier cosa: WhatsApp
                                rechaza los ejecutables, y descubrirlo recien al enviar deja el
                                archivo subido y el mensaje en rojo.
                              */
                              accept="application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip,.rar"
                              multiple
                              className="hidden"
                              onChange={(event) => {
                                const files = Array.from(event.currentTarget.files ?? []);
                                event.currentTarget.value = "";
                                if (files.length > 0) {
                                  setPendingMediaFiles(files);
                                }
                              }}
                            />
                            <Popover open={isAttachMenuOpen} onOpenChange={setIsAttachMenuOpen}>
                              <PopoverTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  disabled={isSendingMedia}
                                  aria-label="Adjuntar"
                                  title="Adjuntar"
                                  className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-background hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 md:size-7"
                                >
                                  <Plus className="size-5" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent
                                align="start"
                                side="top"
                                sideOffset={12}
                                className="w-[min(80vw,16rem)] rounded-2xl border border-border bg-popover p-1.5 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.35)]"
                              >
                                {/* Prender o apagar la firma sin salir del compositor. Solo si la
                                    persona tiene una configurada: sin firma, el interruptor no
                                    controlaria nada. */}
                                {firma ? (
                                  <label className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm text-foreground transition hover:bg-muted">
                                    <span className="flex items-center gap-3">
                                      <PenLine className="size-5 shrink-0 text-[#8b5cf6]" />
                                      <span>
                                        Firmar mensajes
                                        <span className="block text-[11px] text-muted-foreground">
                                          {firmaActiva ? firma : "Salen sin tu nombre"}
                                        </span>
                                      </span>
                                    </span>
                                    <Switch
                                      checked={firmaActiva}
                                      onCheckedChange={(valor) => setFirmaActiva(Boolean(valor))}
                                    />
                                  </label>
                                ) : null}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    setIsQuickRepliesOpen(true);
                                  }}
                                  className="flex h-auto w-full items-center justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-normal text-foreground transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <MessageSquareText className="size-5 shrink-0 text-[#10b981]" />
                                  <span>Respuestas rápidas</span>
                                </Button>
                                {/* Guion del Playbook segun la etapa de ESTE cliente: la asesora no
                                    tiene que abrir el documento aparte ni acordarse de nada. */}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    setIsPlaybookOpen(true);
                                  }}
                                  className="flex h-auto w-full items-center justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-normal text-foreground transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <BookOpen className="size-5 shrink-0 text-[#f59e0b]" />
                                  <span>Qué decir ahora</span>
                                </Button>
                                {/* Mandar el catalogo completo con un toque, en vez de buscar el
                                    PDF en el celular y subirlo de nuevo en cada conversacion. */}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    setIsSendFlowOpen(true);
                                  }}
                                  className="flex h-auto w-full items-center justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-normal text-foreground transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <Workflow className="size-5 shrink-0 text-[#0ea5e9]" />
                                  <span>Enviar flujos</span>
                                </Button>
                                {/* Los catalogos de siempre, ya subidos. Mandarlos desde aca NO
                                    sube nada: con la señal de un celular en la calle, subir un
                                    catalogo de 15 MB tarda entre 8 y 18 minutos y se corta antes
                                    de terminar. Como son siempre los mismos archivos, se suben una
                                    vez y despues salen en un segundo. */}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    setIsLibraryOpen(true);
                                  }}
                                  className="flex h-auto w-full items-center justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-normal text-foreground transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <FolderOpen className="size-5 shrink-0 text-[#8b5cf6]" />
                                  <span>Biblioteca</span>
                                </Button>
                                {/* Lo que el equipo necesita saber del cliente y no se le manda
                                    a el. Antes se lo pasaban por WhatsApp entre ellas y se
                                    perdia. */}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    setIsNoteOpen(true);
                                  }}
                                  className="flex h-auto w-full items-center justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-normal text-foreground transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <StickyNote className="size-5 shrink-0 text-[#eab308]" />
                                  <span>Nota interna</span>
                                </Button>
                                {/* Agendar el proximo toque sin salir del chat: es donde la
                                    asesora se acuerda de que hay que volver a escribirle. */}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    setIsFollowUpOpen(true);
                                  }}
                                  className="flex h-auto w-full items-center justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-normal text-foreground transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <AlarmClock className="size-5 shrink-0 text-[#8b5cf6]" />
                                  <span>Agendar seguimiento</span>
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    mediaFileInputRef.current?.click();
                                  }}
                                  className="flex h-auto w-full items-center justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-normal text-foreground transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <ImageIcon className="size-5 shrink-0 text-[#2f9bff]" />
                                  <span>Fotos y videos</span>
                                </Button>
                                {/*
                                  Documentos, al lado de la Biblioteca y no en su lugar.

                                  Esto estuvo sacado un tiempo, y con razon: para mandar un catalogo
                                  obligaba a buscarlo en Drive, bajarlo al celular y volver a
                                  subirlo, 15 MB por cliente que con la señal de la calle no
                                  terminaban de subir. Para eso esta la Biblioteca, donde los ocho
                                  catalogos de siempre salen en un segundo.

                                  Pero un archivo suelto -la cotizacion de ESE cliente, una remision,
                                  la cedula que mandan por correo- no vive en la Biblioteca y no
                                  tiene por que ensuciarla. Ese es el caso que quedaba sin salida.
                                */}
                                <Button
                                  type="button"
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    documentoFileInputRef.current?.click();
                                  }}
                                  variant="ghost"
                                  className="flex h-auto w-full items-center justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-normal text-foreground transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <FileText className="size-5 shrink-0 text-[#ec4899]" />
                                  <span>Documento</span>
                                </Button>
                                {/* Ubicación del local con UN toque: las coordenadas salen de la
                                    configuración de Negocio, la asesora no tiene que buscar nada. */}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  disabled={isSendingLocation}
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    void handleSendLocation();
                                  }}
                                  className="flex h-auto w-full items-center justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-normal text-foreground transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <MapPin className="size-5 shrink-0 text-[#ef4444]" />
                                  <span>{isSendingLocation ? "Enviando ubicación…" : "Ubicación del local"}</span>
                                </Button>
                                {audioConfig ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    disabled={isSendingAudio}
                                    onClick={() => {
                                      setIsAttachMenuOpen(false);
                                      void startAudioRecording();
                                    }}
                                    className="flex h-auto w-full items-center justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-normal text-foreground transition hover:bg-muted focus:outline-none focus-visible:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    <Headphones className="size-5 shrink-0 text-[#ff7a59]" />
                                    <span>Audio</span>
                                  </Button>
                                ) : null}
                              </PopoverContent>
                            </Popover>
                          </>
                        ) : null}
                        <Popover
                          open={isEmojiPickerOpen}
                          onOpenChange={(open) => {
                            setIsEmojiPickerOpen(open);
                            if (!open) {
                              setEmojiSearchQuery("");
                            }
                          }}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={isSendingAudio}
                              className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-background hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 md:size-7"
                              aria-label="Abrir selector de emoticones"
                              title="Emoticones"
                            >
                              <Smile className="size-5" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            side="top"
                            sideOffset={12}
                            className="w-[min(90vw,26rem)] rounded-[26px] border border-border bg-popover p-3.5 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.35)]"
                          >
                            <ComposerEmojiPicker
                              query={emojiSearchQuery}
                              activeTab={emojiPickerTab}
                              recentEmojis={recentComposerEmojis}
                              onQueryChange={setEmojiSearchQuery}
                              onActiveTabChange={setEmojiPickerTab}
                              onSelectEmoji={insertComposerEmoji}
                            />
                          </PopoverContent>
                        </Popover>
                        <textarea
                          ref={composerTextAreaRef}
                          name="message"
                          rows={1}
                          placeholder={isSendingAudio ? "Enviando nota de voz..." : composer.placeholder || "Escribe un mensaje..."}
                          disabled={isSendingAudio}
                          onChange={(event) => {
                            setComposerHasText(event.currentTarget.value.trim().length > 0);
                            autoResizeComposer(event.currentTarget);
                          }}
                          onSelect={(event) => syncComposerSelection(event.currentTarget)}
                          onKeyUp={(event) => syncComposerSelection(event.currentTarget)}
                          onMouseUp={(event) => syncComposerSelection(event.currentTarget)}
                          onBlur={(event) => syncComposerSelection(event.currentTarget)}
                          onPaste={(event) => {
                            // Pegar (Ctrl+V) una imagen del portapapeles: se envía por el
                            // mismo flujo que "Fotos y videos" (previsualización + envío).
                            if (!mediaConfig || isSendingMedia) {
                              return;
                            }
                            const items = Array.from(event.clipboardData?.items ?? []);
                            const images = items
                              .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
                              .map((item) => item.getAsFile())
                              .filter((file): file is File => Boolean(file));
                            if (images.length > 0) {
                              event.preventDefault();
                              setPendingMediaFiles(images);
                            }
                          }}
                          /**
                           * 16px en el celular no es capricho: por debajo de eso el navegador
                           * del iPhone HACE ZOOM solo al tocar el campo y deja la pantalla
                           * corrida. Ademas se lee, que era la queja: con 14px las asesoras no
                           * veian bien lo que escribian.
                           */
                          className="min-h-[38px] min-w-0 flex-1 resize-none bg-transparent py-2 pr-2 text-[16px] leading-[1.35] text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-70 md:min-h-[46px] md:py-3 md:text-sm"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => void handleSuggestReply()}
                          disabled={isSuggestingReply || isSendingAudio}
                          aria-label="Respuesta sugerida con IA"
                          title="Respuesta sugerida con IA"
                          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-muted-foreground/20 hover:text-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 md:size-8"
                        >
                          {isSuggestingReply ? (
                            <LoaderCircle className="size-5 animate-spin" />
                          ) : (
                            <Sparkles className="size-5" />
                          )}
                        </Button>
                        {composerHasText || !audioConfig ? (
                          <ComposerSendButton />
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={startAudioRecording}
                            disabled={isSendingAudio}
                            aria-label="Grabar nota de voz"
                            title="Grabar nota de voz"
                            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-muted-foreground/20 focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 md:size-8"
                          >
                            <Mic className="size-5" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </form>
              </div>
            ) : null}
          </div>
        </div>
        <QuickRepliesDialog
          open={isQuickRepliesOpen}
          onClose={() => setIsQuickRepliesOpen(false)}
          onSelect={insertQuickReply}
        />
        {/* El guion se INSERTA en el compositor (mismo mecanismo que las respuestas rápidas):
            la asesora lo ajusta y envía cuando quiere, nunca se manda solo. */}
        <ForwardMessageDialog message={mensajeAReenviar} onClose={() => setMensajeAReenviar(null)} />
        {mediaConfig ? (
          <InternalNoteDialog
            open={isNoteOpen}
            onClose={() => setIsNoteOpen(false)}
            conversationId={mediaConfig.conversationId}
            source={mediaConfig.source === "official" ? "official" : "agent"}
          />
        ) : null}
        {mediaConfig ? (
          <SendFlowDialog
            open={isSendFlowOpen}
            onClose={() => setIsSendFlowOpen(false)}
            source={mediaConfig.source === "official" ? "official" : "agent"}
            conversationId={mediaConfig.conversationId}
            agentId={mediaConfig.agentId ?? undefined}
          />
        ) : null}
        {/* Montado solo mientras esta abierto: un modal que queda puesto y apagado puede dejar su
            fondo en el DOM tapando la pantalla y comiendose los clicks (paso el 13-ago-2026). */}
        {mediaConfig && isLibraryOpen ? (
          <MediaLibraryDialog
            open
            onClose={() => setIsLibraryOpen(false)}
            uploadPath={mediaConfig.uploadPath}
            onSend={async (item) => {
              const result = await mediaConfig.sendAction({
                source: mediaConfig.source,
                conversationId: mediaConfig.conversationId,
                agentId: mediaConfig.agentId,
                mediaUrl: item.url,
                mediaType: item.mediaType,
                fileName: item.fileName,
                mimeType: item.mimeType,
                returnTo: mediaConfig.returnTo,
              });
              if (result && "ok" in result && result.ok) {
                onScrollToBottom();
                return true;
              }
              toast.error((result && "error" in result && result.error) || `No se pudo enviar "${item.title}".`);
              return false;
            }}
          />
        ) : null}
        <PlaybookPanelDialog
          open={isPlaybookOpen}
          onClose={() => setIsPlaybookOpen(false)}
          onSelect={insertQuickReply}
          stage={renderedConversation?.crmStage ?? null}
        />
        <FollowUpDialog
          open={isFollowUpOpen}
          onClose={() => setIsFollowUpOpen(false)}
          contactId={renderedConversation?.contactId ?? null}
        />
        {pendingMediaFiles.length > 0 ? (
          <MediaPreviewDialog
            files={pendingMediaFiles}
            onCancel={() => setPendingMediaFiles([])}
            onSend={(caption) => {
              const files = pendingMediaFiles;
              setPendingMediaFiles([]);
              void uploadAndSendMediaFiles(files, caption);
            }}
          />
        ) : null}
        <Sheet open={isContactPanelOpen && isMobile} onOpenChange={setIsContactPanelOpen}>
          <SheetContent side="right" className="w-[min(92vw,24rem)] border-l border-border bg-card p-0 md:hidden" showCloseButton={false}>
            <SheetHeader className="border-b border-border px-4 py-3 text-left">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <SheetTitle>Contacto</SheetTitle>
                  {/* Queda solo para lectores de pantalla: ocupaba dos renglones para explicar
                      lo que ya se ve abajo (el nombre, el telefono, las etiquetas). */}
                  <SheetDescription className="sr-only">
                    Información del cliente y etiquetas.
                  </SheetDescription>
                </div>
                <div className="flex items-center gap-1">
                {contactPanelHeaderActions}
                <button
                  type="button"
                  onClick={() => setIsContactPanelOpen(false)}
                  aria-label="Cerrar panel"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
                </div>
              </div>
            </SheetHeader>
            {contactPanelContent}
          </SheetContent>
        </Sheet>
        {isContactPanelOpen ? (
          <aside className="hidden w-72 shrink-0 flex-col border-l border-border bg-card md:flex lg:w-80">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">Contacto</h3>
              <div className="flex items-center gap-1">
              {contactPanelHeaderActions}
              <button
                type="button"
                onClick={() => setIsContactPanelOpen(false)}
                aria-label="Cerrar panel"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="relative shrink-0">
                  <ContactAvatar
                    avatarUrl={renderedConversation.avatarUrl}
                    label={renderedConversation.label}
                    className="h-12 w-12 rounded-full border border-border bg-muted text-muted-foreground"
                    fallbackClassName="rounded-full bg-muted text-muted-foreground"
                  />
                  {renderedConversation.contactId ? (
                    <button
                      type="button"
                      onClick={handleRefreshAvatar}
                      disabled={isRefreshingAvatar}
                      aria-label="Traer foto de perfil"
                      title="Traer foto de perfil de WhatsApp"
                      className="absolute -bottom-1 -right-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-background bg-[var(--primary)] text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
                    >
                      {isRefreshingAvatar ? (
                        <LoaderCircle className="h-3 w-3 animate-spin" />
                      ) : (
                        <Camera className="h-3 w-3" />
                      )}
                    </button>
                  ) : null}
                </div>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {renderedConversation.label}
                    </p>
                    {renderedConversation.contactId ? (
                      <button
                        type="button"
                        onClick={onEditContact}
                        aria-label="Editar"
                        title="Editar"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                  {renderedConversation.secondaryLabel ? (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span className="min-w-0 flex-1 truncate">{renderedConversation.secondaryLabel}</span>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(renderedConversation.secondaryLabel);
                          toast.success("Copiado");
                        }}
                        aria-label="Copiar número"
                        title="Copiar"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                  {contactCity ? (
                    <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 truncate">{contactCity}</span>
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="mt-5 space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Etiquetas
                </h4>
                <ChatTagsControl
                  contactId={renderedConversation.contactId}
                  conversationId={renderedConversation.id}
                  tags={renderedConversation.tags ?? []}
                  canDelete={canDeleteTags}
                />
              </div>

              {contactPanelActions ? (
                <div className="mt-5 space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Agente asignado
                  </h4>
                  {contactPanelActions}
                </div>
              ) : null}
            </div>
          </aside>
        ) : null}
        </div>
      ) : (
        <div className="relative z-10 flex h-full w-full flex-1 items-center justify-center px-6 py-10 text-center">
          <div className="mx-auto flex max-w-sm flex-col items-center gap-4">
            <span className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
                <MessageSquareText className="h-7 w-7" />
              </span>
            </span>
            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold text-foreground">{emptySelectionTitle}</h3>
              <p className="text-sm leading-6 text-muted-foreground">
                {emptySelectionDescription}
              </p>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
});

