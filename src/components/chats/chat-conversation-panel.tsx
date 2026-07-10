"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronUp,
  Copy,
  FileText,
  Headphones,
  ImageIcon,
  LoaderCircle,
  MapPin,
  MessageSquareText,
  Mic,
  Pencil,
  Plus,
  SendHorizonal,
  Smile,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { ChatScrollAnchor } from "@/components/agents/chat-scroll-anchor";
import { ContactAvatar } from "@/components/chats/contact-avatar";
import { getContactDetailsAction, generateSuggestedReplyAction } from "@/app/actions/chats-actions";
import { ChatTagsControl } from "@/components/chats/chat-tags-control";
import { QuickRepliesDialog } from "@/components/chats/quick-replies-dialog";
import { MediaPreviewDialog } from "@/components/chats/media-preview-dialog";
import { Button } from "@/components/ui/button";
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
import { CHAT_COMPOSER_RECENT_KEY, type ComposerEmojiTab } from "./chat-inbox-emojis";
import { MessageBubble } from "./chat-message-bubble";
import { ComposerEmojiPicker, ComposerSendButton } from "./chat-composer";

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
  onScrollToBottom: () => void;
  onEditContact: () => void;
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
  onScrollToBottom,
  onEditContact,
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
  canDeleteTags,
}: ConversationPanelProps) {
  const canLoadOlderMessages = Boolean(renderedConversation?.loadMoreCursor && renderedConversation.hasMoreMessages);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const [isQuickRepliesOpen, setIsQuickRepliesOpen] = useState(false);
  // Archivos elegidos pendientes de confirmar en la vista previa (con caption) antes de enviar.
  const [pendingMediaFiles, setPendingMediaFiles] = useState<File[]>([]);
  const [isSuggestingReply, setIsSuggestingReply] = useState(false);
  const [emojiSearchQuery, setEmojiSearchQuery] = useState("");
  const [emojiPickerTab, setEmojiPickerTab] = useState<ComposerEmojiTab>("todos");
  const [recentComposerEmojis, setRecentComposerEmojis] = useState<string[]>([]);
  const [recentComposerEmojisReady, setRecentComposerEmojisReady] = useState(false);
  const composerTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerSelectionRef = useRef({ start: 0, end: 0 });
  const composerRouter = useRouter();
  const [composerHasText, setComposerHasText] = useState(false);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [isSendingAudio, setIsSendingAudio] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordCancelledRef = useRef(false);
  const audioConfig = composer?.audio;
  const mediaConfig = composer?.media;
  const mediaFileInputRef = useRef<HTMLInputElement | null>(null);
  const documentFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isSendingMedia, setIsSendingMedia] = useState(false);
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

  const panelContactId = renderedConversation?.contactId ?? null;
  useEffect(() => {
    if (!isContactPanelOpen || !panelContactId) {
      setContactCity("");
      return;
    }

    let cancelled = false;
    getContactDetailsAction(panelContactId).then((result) => {
      if (cancelled) return;
      if ("details" in result) {
        setContactCity(result.details.city);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isContactPanelOpen, panelContactId]);

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
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(mediaConfig.uploadPath, { method: "POST", body: formData });
        const data = (await response.json().catch(() => null)) as
          | { url?: string; fileName?: string; mimeType?: string; mediaType?: "IMAGE" | "VIDEO" | "DOCUMENT"; error?: string }
          | null;
        if (!response.ok || !data?.url || !data.mediaType) {
          toast.error(data?.error || `No se pudo subir "${file.name}".`);
          return false;
        }

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
    autoResizeComposer(textarea);

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }, [autoResizeComposer]);

  const handleSuggestReply = useCallback(async () => {
    const conversationId = mediaConfig?.conversationId ?? audioConfig?.conversationId;
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
  }, [mediaConfig?.conversationId, audioConfig?.conversationId, isSuggestingReply, autoResizeComposer]);

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
          <div className="shrink-0 border-b border-border bg-card px-3 pb-2.5 pt-[max(env(safe-area-inset-top),0.875rem)] min-h-[4.5rem] md:min-h-0 md:px-[10px] md:py-[10px]">
            <div className="@container/chathdr flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Link
                  href={backHref}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition hover:bg-muted md:hidden"
                  aria-label="Volver a chats"
                >
                  <ArrowLeft className="h-4 w-4" />
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
                        className="group relative shrink-0 rounded-[22px] transition focus:outline-none focus:ring-2 focus:ring-ring/50"
                        aria-label={isContactPanelOpen ? "Cerrar detalles del contacto" : "Abrir detalles del contacto"}
                        title="Contacto"
                      >
                        <span className="relative block">
                          <ContactAvatar
                            avatarUrl={renderedConversation.avatarUrl}
                            label={renderedConversation.label}
                            className="h-10 w-10 rounded-[18px] border-0 bg-muted text-muted-foreground after:border-0 transition"
                            fallbackClassName="rounded-[18px] bg-muted text-muted-foreground"
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
                    <h2 className="truncate text-[13px] font-semibold text-foreground md:text-sm">
                      {renderedConversation.label}
                    </h2>
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

          <div className="relative flex min-h-0 flex-1 flex-col bg-transparent">
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
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm">
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      </span>
                    </div>
                  ) : null}
                  {canLoadOlderMessages ? (
                    <div className="pb-2 pt-1">
                      <div ref={loadMoreSentinelRef} aria-hidden="true" className="h-px w-full" />
                      {renderedConversation.loadMoreHref ? (
                        <div className="flex justify-center">
                          <Link
                            href={renderedConversation.loadMoreHref}
                            scroll={false}
                            className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
                          >
                            Cargar mensajes anteriores
                          </Link>
                        </div>
                      ) : isLoadingOlderMessages ? (
                        <div className="flex justify-center px-3 py-1.5">
                          <span
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm"
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
                            className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
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
                        onDelete={onDeleteMessage}
                      />
                    ))}
                    {messageScrollBehavior === "preserve" ? (
                      <ChatScrollAnchor dependencyKey={selectedConversationScrollKey} behavior="preserve" />
                    ) : null}
                  </div>
                </div>
              </div>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={onScrollToBottom}
                  className="absolute bottom-4 right-4 z-10 flex cursor-pointer items-center gap-1.5 rounded-full bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur-sm transition hover:bg-slate-900"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                  {unreadCount}
                </button>
              ) : null}
            </div>

            {composer && renderedConversation ? (
              <div className="chat-composer z-20 shrink-0 bg-transparent px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 md:px-2 md:py-2">
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

                    // El handler externo crea la burbuja optimista y envia sin
                    // navegacion (la accion valida internamente y devuelve resultado).
                    onComposerDraft(message, formData);
                    setComposerHasText(false);
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
                      <div className="flex min-h-[44px] flex-1 items-center gap-2 rounded-2xl border border-border bg-muted/80 px-4 text-sm text-foreground md:min-h-[40px]">
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
                      <div className="flex min-h-[44px] min-w-0 flex-1 items-center gap-0.5 rounded-2xl border border-border bg-background px-1.5 shadow-[0_1px_6px_#0000001f] transition focus-within:border-[var(--primary)] focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/50 md:min-h-[40px]">
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
                              ref={documentFileInputRef}
                              type="file"
                              accept="application/pdf"
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
                                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-background hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 md:size-7"
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
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    documentFileInputRef.current?.click();
                                  }}
                                  className="flex h-auto w-full items-center justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-normal text-foreground transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <FileText className="size-5 shrink-0 text-[#7c5cff]" />
                                  <span>Documento</span>
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
                              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-background hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 md:size-7"
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
                          className="min-h-[52px] min-w-0 flex-1 resize-none bg-transparent py-3.5 pr-2 text-[14px] text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-70 md:min-h-[46px] md:py-3 md:text-sm"
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
                  <SheetDescription>Información del cliente y etiquetas.</SheetDescription>
                </div>
                <button
                  type="button"
                  onClick={() => setIsContactPanelOpen(false)}
                  aria-label="Cerrar panel"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </SheetHeader>
            {contactPanelContent}
          </SheetContent>
        </Sheet>
        {isContactPanelOpen ? (
          <aside className="hidden w-72 shrink-0 flex-col border-l border-border bg-card md:flex lg:w-80">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">Contacto</h3>
              <button
                type="button"
                onClick={() => setIsContactPanelOpen(false)}
                aria-label="Cerrar panel"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <div className="flex items-center gap-3">
                <ContactAvatar
                  avatarUrl={renderedConversation.avatarUrl}
                  label={renderedConversation.label}
                  className="h-12 w-12 shrink-0 rounded-full border border-border bg-muted text-muted-foreground"
                  fallbackClassName="rounded-full bg-muted text-muted-foreground"
                />
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

