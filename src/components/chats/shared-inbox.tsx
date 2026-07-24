"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgeCheck, ChevronRight, MessageCircle, MessageSquareText } from "lucide-react";
import {
  mergeConversationSnapshots,
  readConversationFromCache,
  saveConversationToCache,
} from "@/components/chats/chat-history-cache";
import { EditContactModal } from "@/components/chats/edit-contact-modal";
import {
  clearPendingConversationSelection,
  resetConversationSelection,
  useOpenChatKey,
  usePendingConversationSelection,
  type PendingChatSelection,
} from "./chat-selection-store";
import { deleteChatMessageAction, toggleConversationAutomationAction } from "@/app/actions/chats-actions";
import { AppSidebar } from "./appsidebar";
import type {
  SharedInboxConversationItem,
  SharedInboxMessageItem,
  SharedInboxSelectedConversation,
  OptimisticDraftMessage,
  ComposerReplyTarget,
  ConversationContactUpdateDetail,
  ConversationTagsUpdateDetail,
  SharedInboxProps,
} from "./chat-inbox-types";

export type {
  SharedInboxConversationItem,
  SharedInboxMessageItem,
  SharedInboxSelectedConversation,
  SharedInboxSidebarItem,
  AssignedFilter,
  StatusFilter,
} from "./chat-inbox-types";
import { normalizeChatSearchText, getMediaPreviewLabel } from "./chat-inbox-format";
import {
  normalizeLiveConversationSnapshot,
  normalizeLiveConversationListSnapshot,
  normalizeConversationItems,
  buildConversationItemHrefFromParams,
  extractConversationIdFromKey,
  conversationIdMatchesKey,
  findConversationItemBySnapshotId,
  buildConversationItemFromSnapshot,
  buildConversationItemFromListSnapshot,
  sortConversationItems,
  updateConversationItemInSortedList,
  mergeConversationListItem,
  areTagListsEqual,
  areConversationListItemsEqual,
  mergeConversationSnapshotIfChanged,
  updateConversationItemByContact,
} from "./chat-inbox-conversation-utils";
import { ConversationPanel } from "./chat-conversation-panel";
import { ChatHeaderActions } from "./chat-header-actions";
import type { CrmStage } from "@/features/crm/types";

const CONVERSATION_LIST_LOAD_BATCH_SIZE = 10;
// Logs de depuración de la lista desactivados (ensuciaban la consola en desarrollo).
const CHAT_LIST_DEBUG = false;

function debugConversationList(...args: unknown[]) {
  if (!CHAT_LIST_DEBUG) {
    return;
  }

  console.log("[SharedInbox][list]", ...args);
}

function buildPendingConversationPreview(
  pendingConversation: PendingChatSelection,
): SharedInboxSelectedConversation {
  const lastMessage =
    pendingConversation.lastMessage?.trim() ||
    getMediaPreviewLabel(pendingConversation.lastMessageType) ||
    "";
  const direction = pendingConversation.lastMessageDirection || "INBOUND";
  const createdAt = pendingConversation.lastMessageAt ? new Date(pendingConversation.lastMessageAt) : new Date();
  const previewMessages = lastMessage
    ? [
        {
          id: `${pendingConversation.cacheKey ?? pendingConversation.id}:preview`,
          content: lastMessage,
          direction,
          createdAt,
          authorType: direction === "OUTBOUND" ? "bot" : "user",
          type: pendingConversation.lastMessageType ?? "TEXT",
        } satisfies SharedInboxMessageItem,
      ]
    : [];

  return {
    id: pendingConversation.id,
    label: pendingConversation.label,
    secondaryLabel: pendingConversation.secondaryLabel,
    avatarUrl: pendingConversation.avatarUrl ?? null,
    tags: pendingConversation.tags ?? [],
    contactId: null,
    contactName: null,
    messages: previewMessages,
    cacheKey: pendingConversation.cacheKey ?? pendingConversation.id,
    isPreview: true,
  };
}

/**
 * Campos ocultos del formulario de envio, apuntados al chat abierto.
 *
 * OJO con `conversationId`: va el id PELADO ("cmxxx"), NO la clave del chat ("agent:cmxxx"). La
 * accion de envio hace `WHERE c."id" = conversationId` (chats-actions.ts:732), asi que con la
 * clave no encuentra la conversacion y el mensaje falla con "No se envió".
 *
 * Esta funcion recibia la seleccion pendiente y escribia su `.id`, que es la CLAVE: estaba mal
 * desde siempre, pero nunca se noto porque una comparacion rota mas abajo hacia que jamas se
 * ejecutara. Al arreglar esa comparacion se activo este camino y rompio el envio en produccion.
 * Por eso ahora recibe el id ya resuelto del chat cargado en vez de derivarlo de la clave.
 */
function buildComposerHiddenFields(
  baseFields: Array<{ name: string; value: string }>,
  selectedConversation: { conversationId: string; source: "agent" | "official"; agentId: string | null } | null,
) {
  if (!selectedConversation) {
    return baseFields;
  }

  const nextFields = [...baseFields];
  const upsertField = (name: string, value: string) => {
    const index = nextFields.findIndex((field) => field.name === name);
    if (index >= 0) {
      nextFields[index] = { name, value };
      return;
    }

    nextFields.push({ name, value });
  };

  upsertField("source", selectedConversation.source || "agent");
  upsertField("conversationId", selectedConversation.conversationId);
  upsertField("agentId", selectedConversation.source === "agent" ? (selectedConversation.agentId ?? "") : "");

  return nextFields;
}

export function SharedInbox({
  searchAction,
  selectedConversationId: selectedConversationIdFromUrl,
  // mobileConversationActive del servidor ya no se usa: se deriva abajo del chat abierto, porque
  // el valor del servidor se congela al no navegar (era la causa de que en movil el chat no se
  // abriera al hacer click y si al recargar).
  searchQuery,
  selectedConnectionKey = "",
  assignedFilter = "all",
  statusFilter = "open",
  isManager = false,
  conversationListApiPath = "/api/cliente/chats/list",
  initialConversationBatchSize = 20,
  initialHasMoreConversations,
  sidebarItems = [],
  conversations,
  selectedConversation,
  selectedConversationTags = [],
  backHref,
  headerBadge,
  headerActions,
  contactPanelActions,
  composer,
  emptyListTitle,
  emptyListDescription,
  emptySelectionTitle,
  emptySelectionDescription,
  messageScrollBehavior = "bottom",
}: SharedInboxProps) {
  const [conversationItems, setConversationItems] = useState<SharedInboxConversationItem[]>(() =>
    normalizeConversationItems(conversations, (item) =>
      buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item, assignedFilter, statusFilter),
    ),
  );
  const [hasMoreConversationItems, setHasMoreConversationItems] = useState(
    initialHasMoreConversations ?? conversations.length >= initialConversationBatchSize,
  );
  const [isLoadingMoreConversationItems, setIsLoadingMoreConversationItems] = useState(false);
  const [assignedCounts, setAssignedCounts] = useState<{ mine: number; unassigned: number; all: number } | null>(null);
  const [optimisticConversation, setOptimisticConversation] = useState<SharedInboxSelectedConversation | null>(null);
  const [liveConversation, setLiveConversation] = useState<SharedInboxSelectedConversation | null>(null);
  const [optimisticOutgoingMessage, setOptimisticOutgoingMessage] = useState<OptimisticDraftMessage | null>(null);
  const [replyTarget, setReplyTarget] = useState<ComposerReplyTarget | null>(null);
  const [deletedMessageIds, setDeletedMessageIds] = useState<ReadonlySet<string>>(() => new Set());
  const [editContactOpen, setEditContactOpen] = useState(false);
  const handleCloseEditContact = useCallback(() => setEditContactOpen(false), []);
  const handleOpenEditContact = useCallback(() => setEditContactOpen(true), []);
  const [, startSelectionTransition] = useTransition();
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const prevScrollKeyRef = useRef("");
  const lastScrollTopRef = useRef(0);
  const historyLoadArmedRef = useRef(false);
  const historyLoadConsumedRef = useRef(false);
  const loadMoreHistoryInFlightRef = useRef(false);
  const loadMoreHistoryRestoreRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null);
  // Mientras un chat recién se abre, los ajustes programáticos de scroll (pin al fondo)
  // disparan el listener de scroll y podrían "armar"/lanzar la carga de mensajes anteriores,
  // que ancla la vista arriba. Suprimimos esa carga hasta este timestamp tras abrir.
  const suppressHistoryLoadUntilRef = useRef(0);
  const selectedConversationDetailFollowUpTimerRef = useRef<number | null>(null);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasHydrated, setHasHydrated] = useState(false);
  const selectedConversationDetailInFlightRef = useRef<string | null>(null);
  // Ref sincronizada en cada render: permite leer el valor actual dentro de event
  // listeners sin declararlos como dependencia (evita re-registro en cada mensaje).
  const selectedConversationRef = useRef(selectedConversation);
  const router = useRouter();
  const [searchInputValue, setSearchInputValue] = useState(searchQuery);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ids de chats que coinciden con la búsqueda por CONTENIDO de mensaje (no por nombre/
  // teléfono/último mensaje visible). Vienen del fetch aumentativo al API de lista; sirven
  // para que esos chats aparezcan aunque el texto buscado no esté en los campos visibles.
  const [searchMatchIds, setSearchMatchIds] = useState<ReadonlySet<string> | null>(null);
  const searchAugmentAbortRef = useRef<AbortController | null>(null);
  const listQueryKeyRef = useRef(`${searchQuery.trim()}::${selectedConnectionKey.trim()}::${assignedFilter}`);

  useEffect(() => {
    if (searchInputRef.current && document.activeElement === searchInputRef.current) {
      return;
    }

    setSearchInputValue(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  // Conteos por filtro (Mías / Sin asignar / Todas) para mostrarlos junto a cada pestaña.
  useEffect(() => {
    const countsApiPath = conversationListApiPath.replace(/\/list$/, "/counts");
    if (countsApiPath === conversationListApiPath) {
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const fetchCounts = async () => {
      try {
        const params = new URLSearchParams();
        if (searchQuery.trim()) params.set("q", searchQuery.trim());
        if (selectedConnectionKey.trim()) params.set("connection", selectedConnectionKey.trim());
        const qs = params.toString();

        const response = await fetch(`${countsApiPath}${qs ? `?${qs}` : ""}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; counts?: { mine: number; unassigned: number; all: number } }
          | null;
        if (!cancelled && payload?.ok && payload.counts) {
          setAssignedCounts(payload.counts);
        }
      } catch {
        // Ignoramos errores de red: se reintenta en el siguiente intervalo.
      } finally {
        if (!cancelled) {
          timeoutId = setTimeout(fetchCounts, 15000);
        }
      }
    };

    fetchCounts();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [conversationListApiPath, searchQuery, selectedConnectionKey]);

  // Al montar / cambiar de conexión o filtros, refresca la lista base desde el servidor
  // (fetch directo, cache: no-store) y hace upsert. Evita depender del RSC cacheado en
  // navegación: una conversación nueva que llegó mientras no estabas en esta vista aparece
  // de una, sin recargar la página. Es un fetch único por cambio de deps (no un polling).
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const params = new URLSearchParams();
        if (searchQuery.trim()) params.set("q", searchQuery.trim());
        if (selectedConnectionKey.trim()) params.set("connection", selectedConnectionKey.trim());
        if (assignedFilter !== "all") params.set("assigned", assignedFilter);
        if (statusFilter !== "open") params.set("status", statusFilter);

        const response = await fetch(`${conversationListApiPath}?${params.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; conversations?: SharedInboxConversationItem[] }
          | null;
        if (cancelled || !payload?.ok || !Array.isArray(payload.conversations)) {
          return;
        }

        const fresh = normalizeConversationItems(payload.conversations, (item) =>
          buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item, assignedFilter, statusFilter),
        );

        setConversationItems((current) => {
          let next = current;
          for (const item of fresh) {
            if (!item.id) continue;
            next = updateConversationItemInSortedList(next, item.id, item);
          }
          return next;
        });
      } catch {
        // Ignoramos errores de red.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationListApiPath, searchAction, searchQuery, selectedConnectionKey, assignedFilter, statusFilter]);

  // Búsqueda aumentativa: trae del servidor los chats que coinciden por contenido de
  // mensaje o que están más allá de lo ya cargado, y los AGREGA (nunca quita) a la lista.
  // No navega ni reemplaza la lista: así borrar el buscador siempre restaura todos los
  // chats al instante (la lista base nunca se encoge por la búsqueda).
  const runSearchAugmentation = useCallback(
    async (rawQuery: string) => {
      const q = rawQuery.trim();
      searchAugmentAbortRef.current?.abort();

      if (!q) {
        searchAugmentAbortRef.current = null;
        setSearchMatchIds(null);
        return;
      }

      const controller = new AbortController();
      searchAugmentAbortRef.current = controller;

      try {
        const params = new URLSearchParams();
        params.set("q", q);
        params.set("limit", "40");
        if (selectedConnectionKey.trim()) params.set("connection", selectedConnectionKey.trim());
        if (assignedFilter !== "all") params.set("assigned", assignedFilter);
        if (statusFilter !== "open") params.set("status", statusFilter);

        const response = await fetch(`${conversationListApiPath}?${params.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; conversations?: SharedInboxConversationItem[] }
          | null;

        if (!payload?.ok || !Array.isArray(payload.conversations)) {
          return;
        }

        const normalized = normalizeConversationItems(payload.conversations, (item) =>
          buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, q, item, assignedFilter, statusFilter),
        );

        setConversationItems((current) => {
          const currentIds = new Set(current.map((item) => item.id));
          const additions = normalized.filter((item) => item.id && !currentIds.has(item.id));
          return additions.length === 0 ? current : sortConversationItems([...current, ...additions]);
        });
        setSearchMatchIds(new Set(normalized.map((item) => item.id)));
      } catch {
        // Abort o fallo de red: la búsqueda local sobre lo ya cargado sigue funcionando.
      } finally {
        if (searchAugmentAbortRef.current === controller) {
          searchAugmentAbortRef.current = null;
        }
      }
    },
    [conversationListApiPath, searchAction, selectedConnectionKey, assignedFilter, statusFilter],
  );

  // Si la URL tiene `q` (p.ej. se buscó y luego se abrió un chat: el href del chat arrastra el `q`),
  // la lista base viene FILTRADA del servidor. Al borrar el buscador hay que quitar `q` de la URL
  // para que el servidor devuelva la lista COMPLETA otra vez; si no, el input queda vacío pero la
  // lista sigue mostrando solo los resultados de la búsqueda anterior (y "Todas" no coincide).
  const clearSearchUrlParam = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("q")) return;
    url.searchParams.delete("q");
    router.replace(`${url.pathname}${url.search}${url.hash}`);
  }, [router]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInputValue(value);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      // Se vació el buscador (borrando a mano): restaurar la lista completa quitando `q` de la URL.
      if (!value.trim()) {
        clearSearchUrlParam();
      }
      searchDebounceRef.current = setTimeout(() => {
        void runSearchAugmentation(value);
      }, 250);
    },
    [runSearchAugmentation, clearSearchUrlParam],
  );

  const handleSearchClear = useCallback(() => {
    setSearchInputValue("");
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchAugmentAbortRef.current?.abort();
    searchAugmentAbortRef.current = null;
    setSearchMatchIds(null);
    clearSearchUrlParam();
    searchInputRef.current?.focus();
  }, [clearSearchUrlParam]);

  // Lista que se muestra: filtrado LOCAL e instantáneo de los chats ya cargados por nombre,
  // teléfono o último mensaje (sin tildes/mayúsculas), más los que el servidor marcó como
  // coincidencia por contenido de mensaje. Sin texto → se muestran todos. Esto hace que
  // escribir filtre al instante y que borrar restaure la lista completa de inmediato.
  const displayedConversationItems = useMemo(() => {
    const normalizedQuery = normalizeChatSearchText(searchInputValue.trim());
    if (!normalizedQuery) {
      return conversationItems;
    }

    return conversationItems.filter((item) => {
      if (searchMatchIds?.has(item.id)) {
        return true;
      }

      return (
        normalizeChatSearchText(item.label).includes(normalizedQuery) ||
        normalizeChatSearchText(item.secondaryLabel).includes(normalizedQuery) ||
        normalizeChatSearchText(item.lastMessage ?? "").includes(normalizedQuery)
      );
    });
  }, [conversationItems, searchInputValue, searchMatchIds]);

  const loadMoreConversationItems = useCallback(async () => {
    if (isLoadingMoreConversationItems || !hasMoreConversationItems) {
      return;
    }

    const offset = conversationItems.length;
    if (offset <= 0) {
      return;
    }

    debugConversationList("loadMore start", {
      offset,
      currentCount: conversationItems.length,
      hasMoreConversationItems,
      searchQuery: searchQuery.trim(),
      selectedConnectionKey: selectedConnectionKey.trim(),
    });

    setIsLoadingMoreConversationItems(true);

    try {
      const params = new URLSearchParams();
      params.set("offset", String(offset));
      params.set("limit", String(CONVERSATION_LIST_LOAD_BATCH_SIZE));

      if (searchQuery.trim()) {
        params.set("q", searchQuery.trim());
      }

      if (selectedConnectionKey.trim()) {
        params.set("connection", selectedConnectionKey.trim());
      }

      if (assignedFilter !== "all") {
        params.set("assigned", assignedFilter);
      }

      if (statusFilter !== "open") {
        params.set("status", statusFilter);
      }

      const response = await fetch(`${conversationListApiPath}?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });

      if (!response.ok) {
        debugConversationList("loadMore response not ok", {
          status: response.status,
          offset,
        });
        return;
      }

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; conversations?: SharedInboxConversationItem[]; hasMore?: boolean }
        | null;

      if (!payload?.ok || !Array.isArray(payload.conversations)) {
        debugConversationList("loadMore invalid payload", {
          offset,
          payloadKeys: payload ? Object.keys(payload) : null,
        });
        return;
      }

      const normalizedPayloadConversations = normalizeConversationItems(payload.conversations, (item) =>
        buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item, assignedFilter, statusFilter),
      );
      debugConversationList("loadMore payload", {
        offset,
        received: normalizedPayloadConversations.length,
        hasMore: payload.hasMore,
      });

      setConversationItems((current) => {
        const currentById = new Map(current.map((item) => [item.id, item]));
        const merged = [
          ...current,
          ...normalizedPayloadConversations.map((conversation) =>
            mergeConversationListItem(conversation, currentById.get(conversation.id) ?? null),
          ),
        ];
        const deduped = Array.from(new Map(merged.map((item) => [item.id, item])).values());
        const sorted = sortConversationItems(deduped);

        if (
          current.length === sorted.length &&
          current.every((item, index) => areConversationListItemsEqual(item, sorted[index]))
        ) {
          return current;
        }

        return sorted;
      });

      setHasMoreConversationItems(Boolean(payload.hasMore));
      debugConversationList("loadMore applied", {
        offset,
        nextHasMore: Boolean(payload.hasMore),
      });
    } catch {
      // Background pagination is opportunistic; failures should not block the UI.
      debugConversationList("loadMore failed", { offset });
    } finally {
      setIsLoadingMoreConversationItems(false);
    }
  }, [
    conversationItems.length,
    conversationListApiPath,
    hasMoreConversationItems,
    isLoadingMoreConversationItems,
    searchAction,
    searchQuery,
    selectedConnectionKey,
    assignedFilter,
  ]);

  const pendingConversation = usePendingConversationSelection();

  // Chat abierto: UNICA fuente de verdad para todo el componente (ver useOpenChatKey). Todo lo
  // que necesite saber "que chat esta abierto" lee de aca. Va ANTES de cualquier uso: hay
  // efectos mas abajo que dependen de esto.
  //
  // `selectedConversationId` SOMBREA al prop de la URL a proposito: abrir un chat ya no navega,
  // asi que el prop se congela en el chat con el que cargo la pagina. Los ~15 usos que quedaban
  // leyendolo crudo apuntarian al chat viejo; sombreandolo pasan todos a la fuente unica.
  const selectedConversationKey = useOpenChatKey(selectedConversationIdFromUrl);
  const selectedConversationId = selectedConversationKey;
  // En movil la lista y el chat son dos vistas y esta bandera decide cual se ve. Sale del chat
  // abierto (misma fuente unica), no del servidor: hay chat abierto => se ve el chat.
  const mobileConversationActive = Boolean(selectedConversationKey);

  useEffect(() => {
    if (selectedConversation && !selectedConversation.isPreview) {
      saveConversationToCache(selectedConversation);
    }
  }, [selectedConversation]);

  useEffect(() => {
    const nextListQueryKey = `${searchQuery.trim()}::${selectedConnectionKey.trim()}::${assignedFilter}::${statusFilter}`;
    const queryChanged = listQueryKeyRef.current !== nextListQueryKey;
    listQueryKeyRef.current = nextListQueryKey;

    if (queryChanged) {
      setHasMoreConversationItems(initialHasMoreConversations ?? conversations.length >= initialConversationBatchSize);
      setConversationItems(
        normalizeConversationItems(conversations, (item) =>
          buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item, assignedFilter, statusFilter),
        ),
      );
      return;
    }

    setConversationItems((current) => {
      if (current.length === 0) {
        return sortConversationItems(
          normalizeConversationItems(conversations, (item) =>
            buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item, assignedFilter, statusFilter),
          ),
        );
      }

      const currentById = new Map(current.map((item) => [item.id, item]));
      const merged = normalizeConversationItems(conversations, (item) =>
        buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item, assignedFilter, statusFilter),
      ).map((conversation) =>
        mergeConversationListItem(conversation, currentById.get(conversation.id) ?? null),
      );
      const sorted = sortConversationItems(merged);

      if (
        current.length === sorted.length &&
        current.every((item, index) => areConversationListItemsEqual(item, sorted[index]))
      ) {
        return current;
      }

      return sorted;
    });
  }, [conversations, initialConversationBatchSize, initialHasMoreConversations, searchAction, searchQuery, selectedConnectionKey, assignedFilter, statusFilter]);

  useEffect(() => {
    selectedConversationRef.current = selectedConversation;
  }, [selectedConversation]);

  useEffect(() => {
    if (liveConversation && !conversationIdMatchesKey(selectedConversationId, liveConversation.id)) {
      setLiveConversation(null);
    }
  }, [liveConversation, pendingConversation?.id, selectedConversationId]);

  // Al salir de la bandeja se RESETEA (no se "cierra"): el store es de modulo y sobrevive al
  // desmontaje. Marcarlo como cerrado haria que al volver por un link con ?chatKey= ese chat
  // se ignore.
  useEffect(() => {
    return () => {
      resetConversationSelection();
    };
  }, []);

  // Clave efectiva del chat activo. Sirve para sincronizar el panel y para
  // evitar que el listado se reordene cuando el evento pertenece al chat abierto.
  const selectedConversationCache = useMemo(
    () =>
      hasHydrated && selectedConversationKey
        ? readConversationFromCache(selectedConversationKey, { ignoreFreshness: true })
        : null,
    [hasHydrated, selectedConversationKey],
  );
  const selectedConversationMatchesCurrentKey =
    Boolean(selectedConversation && conversationIdMatchesKey(selectedConversationKey, selectedConversation.id));
  const currentSelectedConversation = selectedConversationMatchesCurrentKey ? selectedConversation : null;
  const currentSelectedConversationHasContent = Boolean(currentSelectedConversation?.messages.length && !currentSelectedConversation?.isPreview);
  const currentSelectedConversationHasContentRef = useRef(currentSelectedConversationHasContent);
  currentSelectedConversationHasContentRef.current = currentSelectedConversationHasContent;
  const cachedConversationForCurrentSelection =
    selectedConversationCache && conversationIdMatchesKey(selectedConversationKey, selectedConversationCache.id)
      ? selectedConversationCache
      : null;
  useEffect(() => {
    if (!pendingConversation?.id) {
      return;
    }

    const cacheKey = pendingConversation.cacheKey || pendingConversation.id;
    const rawCachedConversation = readConversationFromCache(cacheKey, { ignoreFreshness: true });

    // La caché se consulta con varias formas de la clave (con y sin prefijo "agent:"), asi
    // que puede devolver una conversacion que NO es la que se esta abriendo. Sin esta
    // comprobacion se pintaba el historial de OTRO contacto por un instante, hasta que
    // llegaba el real (se veia al recargar o al abrir un chat desde el buscador).
    // La otra lectura de cache, la del chat ya seleccionado, si valida asi.
    const cachedConversation =
      rawCachedConversation && conversationIdMatchesKey(cacheKey, rawCachedConversation.id)
        ? rawCachedConversation
        : null;

    startSelectionTransition(() => {
      setLiveConversation(null);
      setOptimisticConversation(
        cachedConversation
          ? {
              ...cachedConversation,
              tags: cachedConversation.tags?.length ? cachedConversation.tags : pendingConversation.tags ?? [],
            }
          : buildPendingConversationPreview(pendingConversation),
      );
    });
  }, [pendingConversation, startSelectionTransition]);

  // Los snapshots de realtime (chat-live-update / chat-list-update) llegan con el id crudo
  // de la conversación (sin prefijo "agent:"/"official:") y sin href. Si la conversación es
  // nueva (no estaba en el SSR), el item insertado quedaría con id sin prefijo y href "".
  // Al hacer click, router.push("") navega a la URL ACTUAL (no abre el chat nuevo: parece
  // que "entra y vuelve al chat anterior") y además el efecto que carga el historial se
  // salta el item por no empezar con "agent:". Normalizamos id (a chatKey) y href aquí para
  // que un chat recién llegado sea clickeable al primer intento.
  const normalizeRealtimeConversationItem = useCallback(
    (item: SharedInboxConversationItem): SharedInboxConversationItem => {
      if (item.href.trim() && item.id.includes(":")) {
        return item;
      }

      const chatKey = item.id.includes(":")
        ? item.id
        : `${item.source === "official" ? "official" : "agent"}:${item.id}`;
      const withKey = chatKey === item.id ? item : { ...item, id: chatKey };
      const href = buildConversationItemHrefFromParams(
        searchAction,
        selectedConnectionKey,
        searchQuery,
        withKey,
        assignedFilter,
        statusFilter,
      );

      return href === withKey.href ? withKey : { ...withKey, href };
    },
    [searchAction, selectedConnectionKey, searchQuery, assignedFilter, statusFilter],
  );

  const refreshSelectedConversationFromServer = useCallback(async () => {
    const chatKey = selectedConversationKey;
    if (!chatKey.startsWith("agent:")) {
      return;
    }

    try {
      const [liveResponse, summaryResponse] = await Promise.all([
        fetch(`/api/cliente/chats/live?chatKey=${encodeURIComponent(chatKey)}`, {
          credentials: "same-origin",
          cache: "no-store",
        }),
        fetch(`/api/cliente/chats/summary?chatKey=${encodeURIComponent(chatKey)}`, {
          credentials: "same-origin",
          cache: "no-store",
        }),
      ]);

      if (liveResponse.ok) {
        const livePayload = (await liveResponse.json().catch(() => null)) as
          | { ok?: boolean; conversation?: unknown }
          | null;
        const liveConversationSnapshot = normalizeLiveConversationSnapshot(livePayload?.conversation);
        if (livePayload?.ok && liveConversationSnapshot) {
          window.dispatchEvent(
            new CustomEvent("chat-live-update", {
              detail: {
                conversation: liveConversationSnapshot,
                chatKey,
              },
            }),
          );
        }
      }

      if (summaryResponse.ok) {
        const summaryPayload = (await summaryResponse.json().catch(() => null)) as
          | { ok?: boolean; conversation?: unknown }
          | null;
        const summaryConversationSnapshot = normalizeLiveConversationListSnapshot(summaryPayload?.conversation);
        if (summaryPayload?.ok && summaryConversationSnapshot) {
          window.dispatchEvent(
            new CustomEvent("chat-list-update", {
              detail: {
                conversation: summaryConversationSnapshot,
              },
            }),
          );
        }
      }
    } catch {
      // Si falla este respaldo, el polling/realtime siguiente vuelve a intentar.
    }
  }, [selectedConversationKey]);

  const scheduleConversationRefreshAfterSend = useCallback(() => {
    const retryDelays = [700, 1800, 3600];
    for (const delay of retryDelays) {
      window.setTimeout(() => {
        void refreshSelectedConversationFromServer();
      }, delay);
    }
  }, [refreshSelectedConversationFromServer]);

  // Mientras hay busqueda activa, los resultados se CONGELAN: el realtime no debe mutar la
  // lista. El filtro de busqueda incluye por ULTIMO MENSAJE, asi que un mensaje nuevo
  // cambiaba el preview/orden del resultado "como fantasma". El detalle del chat abierto SI
  // se sigue actualizando. Al limpiar la busqueda, el servidor devuelve la lista fresca.
  const isSearchActiveRef = useRef(false);
  useEffect(() => {
    isSearchActiveRef.current = Boolean(searchInputValue.trim());
  }, [searchInputValue]);

  useEffect(() => {
    function handleLiveUpdate(event: Event) {
      const customEvent = event as CustomEvent<{ conversation?: unknown }>;
      const snapshot = normalizeLiveConversationSnapshot(customEvent.detail?.conversation);
      const effectiveSelectedKey = selectedConversationKey;

      if (!snapshot || !conversationIdMatchesKey(effectiveSelectedKey, snapshot.id)) {
        return;
      }

      setLiveConversation((current) => {
        // Si current pertenece a una conversación diferente (liveConversation nunca se
        // resetea al navegar), usarlo como base haría que mergeCachedMessages concatene
        // mensajes de dos chats distintos. Solo se usa current si es del mismo chat.
        const base = (current && current.id === snapshot.id)
          ? current
          : (selectedConversationRef.current ?? null);
        return mergeConversationSnapshotIfChanged(base, snapshot);
      });
      // El detalle (setLiveConversation, arriba) SI se actualiza aunque haya busqueda; solo
      // la LISTA se congela para que el resultado no cambie de preview/orden en vivo.
      if (!isSearchActiveRef.current) {
        setConversationItems((current) => {
          const currentItem = findConversationItemBySnapshotId(current, snapshot.id) ?? undefined;
          const updatedItem = normalizeRealtimeConversationItem(buildConversationItemFromSnapshot(snapshot, currentItem));
          return updateConversationItemInSortedList(current, snapshot.id, updatedItem);
        });
      }
    }

    window.addEventListener("chat-live-update", handleLiveUpdate as EventListener);
    return () => window.removeEventListener("chat-live-update", handleLiveUpdate as EventListener);
  }, [normalizeRealtimeConversationItem, selectedConversationKey]);

  // Canal que se esta viendo (filtro "connection"). Vacio = bandeja unificada.
  const selectedChannelIdFilter = selectedConnectionKey.trim().startsWith("channel:")
    ? selectedConnectionKey.trim().slice("channel:".length)
    : "";

  useEffect(() => {
    function handleListUpdate(event: Event) {
      // Busqueda activa: resultados congelados (el filtro mira el ultimo mensaje y un
      // mensaje nuevo cambiaba el preview/orden "como fantasma").
      if (isSearchActiveRef.current) {
        return;
      }

      const customEvent = event as CustomEvent<{ conversation?: unknown }>;
      const snapshot = normalizeLiveConversationListSnapshot(customEvent.detail?.conversation);
      if (!snapshot) {
        return;
      }

      // El realtime escucha TODAS las instancias del workspace, asi que aqui pueden caer
      // chats de otro canal. Si estamos filtrando por una conexion, no deben entrar en la
      // lista (si no, viendo un canal aparecen chats del otro).
      if (selectedChannelIdFilter && snapshot.channelId && snapshot.channelId !== selectedChannelIdFilter) {
        return;
      }

      setConversationItems((current) => {
        const currentItem = findConversationItemBySnapshotId(current, snapshot.id) ?? undefined;
        const baseItem = buildConversationItemFromListSnapshot(snapshot, currentItem);
        const mergedItem = mergeConversationListItem(baseItem, currentItem);
        const effectiveSelectedKey = selectedConversationKey;
        const updatedItem = normalizeRealtimeConversationItem(
          conversationIdMatchesKey(effectiveSelectedKey, snapshot.id)
            ? { ...mergedItem, incomingCount: 0 }
            : mergedItem,
        );
        return updateConversationItemInSortedList(current, snapshot.id, updatedItem);
      });
    }

    window.addEventListener("chat-list-update", handleListUpdate as EventListener);
    return () => window.removeEventListener("chat-list-update", handleListUpdate as EventListener);
  }, [normalizeRealtimeConversationItem, selectedConversationKey, selectedChannelIdFilter]);

  useEffect(() => {
    function handleContactUpdate(event: Event) {
      const customEvent = event as CustomEvent<ConversationContactUpdateDetail>;
      const detail = customEvent.detail;

      if (!detail?.contactId || !detail.name?.trim()) {
        return;
      }

      setConversationItems((current) =>
        updateConversationItemByContact(current, detail.contactId, (item) => {
          const nextLabel = detail.name.trim();
          if (item.label === nextLabel) {
            return item;
          }

          return {
            ...item,
            label: nextLabel,
          };
        }),
      );

      setLiveConversation((current) => {
        const baseConversation = current ?? selectedConversationRef.current ?? null;
        if (!baseConversation || baseConversation.contactId !== detail.contactId) {
          return current;
        }

        return {
          ...baseConversation,
          label: detail.name.trim(),
          contactName: detail.name.trim(),
        };
      });

      setOptimisticConversation((current) => {
        if (!current || current.contactId !== detail.contactId) {
          return current;
        }

        return {
          ...current,
          label: detail.name.trim(),
          contactName: detail.name.trim(),
        };
      });
    }

    window.addEventListener("chat-contact-updated", handleContactUpdate as EventListener);
    return () => window.removeEventListener("chat-contact-updated", handleContactUpdate as EventListener);
  }, []);

  useEffect(() => {
    function handleTagsUpdate(event: Event) {
      const customEvent = event as CustomEvent<ConversationTagsUpdateDetail>;
      const detail = customEvent.detail;

      if (!detail?.contactId) {
        return;
      }

      setConversationItems((current) =>
        updateConversationItemByContact(current, detail.contactId, (item) => {
          if (areTagListsEqual(item.tags ?? [], detail.tags)) {
            return item;
          }

          return {
            ...item,
            tags: detail.tags,
          };
        }),
      );

      setLiveConversation((current) => {
        const baseConversation = current ?? selectedConversationRef.current ?? null;
        if (!baseConversation || baseConversation.contactId !== detail.contactId) {
          return current;
        }

        return {
          ...baseConversation,
          tags: detail.tags,
        };
      });

      setOptimisticConversation((current) => {
        if (!current || current.contactId !== detail.contactId) {
          return current;
        }

        return {
          ...current,
          tags: detail.tags,
        };
      });
    }

    window.addEventListener("chat-tags-updated", handleTagsUpdate as EventListener);
    return () => window.removeEventListener("chat-tags-updated", handleTagsUpdate as EventListener);
  }, []);

  useEffect(() => {
    const normalizedSelectedConversationId = selectedConversationKey;

    if (!normalizedSelectedConversationId.startsWith("agent:")) {
      return;
    }

    if (currentSelectedConversationHasContentRef.current) {
      return;
    }

    if (selectedConversationDetailInFlightRef.current === normalizedSelectedConversationId) {
      return;
    }

    selectedConversationDetailInFlightRef.current = normalizedSelectedConversationId;

    const controller = new AbortController();
    let cancelled = false;

    async function loadSelectedConversationDetail() {
      try {
        const response = await fetch(`/api/cliente/chats/live?chatKey=${encodeURIComponent(normalizedSelectedConversationId)}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok || cancelled) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; conversation?: unknown }
          | null;

        if (!payload?.ok || !payload.conversation || cancelled) {
          return;
        }

        const snapshot = normalizeLiveConversationSnapshot(payload.conversation);
        if (!snapshot || cancelled) {
          return;
        }

        setLiveConversation((current) => {
          const base = current && conversationIdMatchesKey(current.id, snapshot.id)
            ? current
            : (selectedConversationRef.current && conversationIdMatchesKey(selectedConversationRef.current.id, snapshot.id)
                ? selectedConversationRef.current
                : selectedConversationRef.current ?? null);
          return mergeConversationSnapshotIfChanged(base, snapshot);
        });
      } catch {
        // Intentional no-op: si falla, la vista cacheada/preview sigue siendo usable.
      } finally {
        if (selectedConversationDetailInFlightRef.current === normalizedSelectedConversationId) {
          selectedConversationDetailInFlightRef.current = null;
        }
      }
    }

    void loadSelectedConversationDetail();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // Dependemos solo de la clave efectiva (selectedConversationKey), no de
    // pendingConversation.chatKey y selectedConversationId por separado. Si dependiera de
    // ambos, cuando router.push actualiza selectedConversationId para "alcanzar" la
    // selección pendiente, el efecto se re-ejecutaría con la MISMA clave efectiva: el
    // cleanup abortaría el fetch en curso y la nueva corrida saldría por el guard de
    // in-flight, dejando el historial sin cargar hasta un segundo click.
  }, [selectedConversationKey]);

  useEffect(() => {
    const normalizedSelectedConversationId = selectedConversationKey;

    if (!normalizedSelectedConversationId.startsWith("agent:")) {
      return;
    }

    if (selectedConversationDetailFollowUpTimerRef.current !== null) {
      window.clearTimeout(selectedConversationDetailFollowUpTimerRef.current);
    }

    selectedConversationDetailFollowUpTimerRef.current = window.setTimeout(() => {
      selectedConversationDetailFollowUpTimerRef.current = null;
      void fetch(`/api/cliente/chats/live?chatKey=${encodeURIComponent(normalizedSelectedConversationId)}`, {
        credentials: "same-origin",
        cache: "no-store",
      })
        .then((response) => (response.ok ? response.json().catch(() => null) : null))
        .then((payload) => {
          const snapshot = normalizeLiveConversationSnapshot((payload as { conversation?: unknown } | null)?.conversation);
          if (!snapshot) {
            return;
          }

          setLiveConversation((current) => {
            const base = current && conversationIdMatchesKey(current.id, snapshot.id)
              ? current
              : (selectedConversationRef.current && conversationIdMatchesKey(selectedConversationRef.current.id, snapshot.id)
                  ? selectedConversationRef.current
                  : selectedConversationRef.current ?? null);
            return mergeConversationSnapshotIfChanged(base, snapshot);
          });
        })
        .catch(() => null);
    }, 2500);

    return () => {
      if (selectedConversationDetailFollowUpTimerRef.current !== null) {
        window.clearTimeout(selectedConversationDetailFollowUpTimerRef.current);
        selectedConversationDetailFollowUpTimerRef.current = null;
      }
    };
  }, [selectedConversationKey]);

  const effectiveLiveConversation =
    liveConversation && conversationIdMatchesKey(selectedConversationId, liveConversation.id) ? liveConversation : null;
  const liveOrCachedConversation = useMemo(
    () =>
      mergeConversationSnapshots(
        currentSelectedConversation ?? null,
        // OJO: se usa `cachedConversationForCurrentSelection` (el cache VALIDADO por id), NO
        // `selectedConversationCache` a secas. El `readConversationFromCache(selectedKey)` hace un
        // lookup laxo (con y sin prefijo "agent:") y PUEDE devolver otra conversación; usarlo sin
        // validar acá era el cruce real: al cambiar de chat con clic, el cuerpo quedaba con los
        // mensajes del chat anterior (mis-amores bajo Karen/Vanessa). La versión validada es null
        // cuando el cache no corresponde al chat seleccionado.
        effectiveLiveConversation ?? cachedConversationForCurrentSelection,
      ),
    [cachedConversationForCurrentSelection, currentSelectedConversation, effectiveLiveConversation],
  );
  const hasLoadedSelectedConversationContent = Boolean(
    liveOrCachedConversation &&
      conversationIdMatchesKey(selectedConversationId, liveOrCachedConversation.id) &&
      liveOrCachedConversation.messages.length > 0,
  );
  const pendingConversationPreview = useMemo(
    () => {
      if (!pendingConversation) {
        return null;
      }

      if (optimisticConversation && conversationIdMatchesKey(pendingConversation.id, optimisticConversation.id)) {
        return optimisticConversation;
      }

      return buildPendingConversationPreview(pendingConversation);
    },
    [optimisticConversation, pendingConversation],
  );

  const computedRenderedConversation = useMemo(() => {
    // Si hay contenido en vivo o en caché para este chat (con mensajes), es la fuente
    // completa: mostrarlo de inmediato. La caché hace que reabrir un chat sea instantáneo.
    if (
      liveOrCachedConversation &&
      liveOrCachedConversation.messages.length > 0 &&
      // Comparar con conversationIdMatchesKey y NO con ===: los dos ids tienen formato distinto.
      // El del preview es la CLAVE del chat ("agent:cmxxx") y el del contenido real es el id
      // pelado ("cmxxx"), asi que === nunca daba verdadero. Antes no se notaba porque la
      // seleccion pendiente se borraba al completarse la navegacion y entonces mandaba el
      // "!pendingConversationPreview". Al pasar la seleccion a ser la fuente de verdad (ya no se
      // borra), esta comparacion rota quedaba siempre en falso: el chat se quedaba en preview
      // con el spinner "Cargando conversacion" para siempre, aunque /live ya hubiera respondido.
      (!pendingConversationPreview ||
        conversationIdMatchesKey(pendingConversationPreview.id, liveOrCachedConversation.id))
    ) {
      return liveOrCachedConversation;
    }

    // Sin caché todavía: mostramos el preview (último mensaje) mientras llega el historial.
    return pendingConversationPreview ?? liveOrCachedConversation;
  }, [liveOrCachedConversation, pendingConversationPreview]);

  // Anti-parpadeo: al cambiar de chat, el contenido pasa por estados intermedios
  // (preview → live/cache que momentáneamente llega sin mensajes → completo). Para no
  // mostrar un frame "vacío", si la versión calculada queda sin mensajes mantenemos la
  // última versión CON mensajes de la MISMA conversación (incluido el preview).
  const stickyRenderedConversationRef = useRef<SharedInboxSelectedConversation | null>(null);
  const renderedConversation = useMemo(() => {
    const computed = computedRenderedConversation;
    // INVARIANTE: solo se muestra contenido del chat SELECCIONADO. Sin esto, al cambiar de chat con
    // clic (sin recargar) quedaban pegados los mensajes del chat anterior: el `computed` seguía
    // siendo la conversación previa (con mensajes) y se devolvía tal cual, mientras el encabezado ya
    // mostraba el chat nuevo. Reproducido: mis-amores → clic Karen mostraba los mensajes de mis-amores.
    const matchesSelection = (conversation: SharedInboxSelectedConversation | null) =>
      Boolean(conversation && conversationIdMatchesKey(selectedConversationKey, conversation.id));

    if (computed && matchesSelection(computed) && computed.messages.length > 0) {
      stickyRenderedConversationRef.current = computed;
      return computed;
    }

    // Anti-parpadeo, pero SOLO dentro de la MISMA conversación seleccionada.
    const sticky = stickyRenderedConversationRef.current;
    if (sticky && conversationIdMatchesKey(selectedConversationKey, sticky.id)) {
      return sticky;
    }

    // Si el `computed` es de OTRA conversación (contenido pegado del chat anterior), no se muestra:
    // se deja vacío/cargando hasta que llegue el contenido del chat correcto.
    return matchesSelection(computed) ? computed : null;
  }, [computedRenderedConversation, selectedConversationKey]);

  // Cuando el chat abierto ya tiene su contenido real, reiniciamos el estado de scroll/historial
  // y soltamos el preview optimista.
  //
  // Antes esto se disparaba con `pendingConversation.id === selectedConversationId`, o sea
  // "la navegacion alcanzo a la seleccion", y ahi ADEMAS borraba la seleccion para pasarle la
  // posta a la URL. Ese relevo ya no existe: abrir un chat no navega, asi que la seleccion ES
  // el chat abierto y borrarla lo cerraria. Peor: con el id sombreado la comparacion daria
  // siempre verdadera y lo cerraria apenas se abre. Ahora depende de que el contenido cargo,
  // que es lo que de verdad importaba, y NO toca la seleccion.
  useEffect(() => {
    if (!selectedConversationKey) {
      return;
    }

    historyLoadArmedRef.current = false;
    lastScrollTopRef.current = 0;
    setIsLoadingOlderMessages(false);

    if (hasLoadedSelectedConversationContent) {
      setOptimisticConversation(null);
    }
  }, [hasLoadedSelectedConversationContent, selectedConversationKey]);

  // Red de seguridad: si una seleccion pendiente nunca llega a resolverse (p. ej. el
  // servidor no devuelve el chat porque ya no esta asignado a este usuario), el overlay
  // "Historial" quedaria girando indefinidamente y confunde al empleado. Tras un tiempo
  // prudente sin resolver, limpiamos la seleccion para volver al estado vacio en vez de
  // dejar el spinner colgado.
  useEffect(() => {
    if (!pendingConversation?.id) {
      return;
    }

    // Se quita el `pendingConversation.id === selectedConversationId` (significaba "la navegacion
    // alcanzo, ya esta"): sin navegacion daria siempre verdadero y la red nunca actuaria. Lo que
    // de verdad indica que la seleccion se resolvio es que el contenido cargo.
    if (hasLoadedSelectedConversationContent) {
      return;
    }

    if (pendingConversation.hasCache || cachedConversationForCurrentSelection) {
      return;
    }

    const timer = window.setTimeout(() => {
      clearPendingConversationSelection();
      setOptimisticConversation(null);
    }, 10000);

    return () => window.clearTimeout(timer);
  }, [
    cachedConversationForCurrentSelection,
    hasLoadedSelectedConversationContent,
    pendingConversation?.hasCache,
    pendingConversation?.id,
    selectedConversationId,
  ]);

  useEffect(() => {
    if (!renderedConversation || renderedConversation.isPreview) {
      return;
    }

    saveConversationToCache(renderedConversation);
  }, [renderedConversation]);

  const loadOlderMessages = useCallback(async () => {
    const conversation = renderedConversation;
    const loadMoreCursor = conversation?.loadMoreCursor?.trim() || "";
    const chatKey = conversation?.cacheKey?.trim() || selectedConversationId.trim();
    let shouldRestoreScroll = false;

    if (
      !conversation ||
      !chatKey ||
      !loadMoreCursor ||
      !conversation.hasMoreMessages ||
      loadMoreHistoryInFlightRef.current
    ) {
      return;
    }

    const container = messagesScrollRef.current;
    if (!container) {
      return;
    }

    loadMoreHistoryInFlightRef.current = true;
    setIsLoadingOlderMessages(true);
    loadMoreHistoryRestoreRef.current = {
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
    };

    try {
      const response = await fetch(
        `/api/cliente/chats/live?chatKey=${encodeURIComponent(chatKey)}&beforeMessageId=${encodeURIComponent(loadMoreCursor)}&batchSize=10`,
        {
          credentials: "same-origin",
          cache: "no-store",
        },
      );

      if (!response.ok) {
        return;
      }

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; conversation?: unknown }
        | null;

      if (!payload?.ok || !payload.conversation) {
        return;
      }

      const snapshot = normalizeLiveConversationSnapshot(payload.conversation);
      if (!snapshot) {
        return;
      }

      shouldRestoreScroll = true;
      setLiveConversation((current) => {
        const base = current && conversationIdMatchesKey(current.id, snapshot.id)
          ? current
          : (selectedConversationRef.current && conversationIdMatchesKey(selectedConversationRef.current.id, snapshot.id)
              ? selectedConversationRef.current
              : selectedConversation ?? null);
        return mergeConversationSnapshotIfChanged(base, snapshot);
      });
    } catch {
      // Ignore loading failures so scroll never gets blocked.
    } finally {
      if (!shouldRestoreScroll) {
        loadMoreHistoryRestoreRef.current = null;
      }
      loadMoreHistoryInFlightRef.current = false;
      setIsLoadingOlderMessages(false);
    }
  }, [renderedConversation, selectedConversation, selectedConversationId]);

  // El mensaje optimista lleva el texto que la persona escribio; el persistido puede tener la
  // firma del usuario agregada ARRIBA en el servidor (prependUserChatSignature). Por eso no se
  // comparan por igualdad exacta —quedarian como dos mensajes distintos y se veria duplicado
  // hasta recargar— sino aceptando que el real TERMINE con el texto optimista.
  // Normaliza para comparar: colapsa saltos de linea/espacios a uno solo. La firma se une
  // con "\n" en el servidor y el texto optimista puede tener otros espacios, asi que sin
  // esto el endsWith fallaba por un salto de linea y el mensaje se veia DUPLICADO hasta
  // recargar (la burbuja optimista no se reemplazaba por la real).
  const normalizeForOutgoingMatch = (value: string) => value.replace(/\s+/g, " ").trim();
  const optimisticOutgoingContent = normalizeForOutgoingMatch(optimisticOutgoingMessage?.content ?? "");
  const persistedMatchesOptimisticContent = (persisted: string | null | undefined) => {
    if (!optimisticOutgoingContent) {
      return false;
    }
    const value = normalizeForOutgoingMatch(persisted ?? "");
    return value === optimisticOutgoingContent || value.endsWith(optimisticOutgoingContent);
  };
  const optimisticDraftMatchesLatestMessage =
    Boolean(
      optimisticOutgoingMessage &&
        renderedConversation &&
        renderedConversation.id === optimisticOutgoingMessage.conversationId &&
        renderedConversation.messages.at(-1)?.direction === "OUTBOUND" &&
        persistedMatchesOptimisticContent(renderedConversation.messages.at(-1)?.content),
    );
  const optimisticDraftHasPersistedMatch =
    Boolean(
      optimisticOutgoingMessage &&
        renderedConversation &&
        renderedConversation.id === optimisticOutgoingMessage.conversationId &&
        renderedConversation.messages.some((message) =>
          message.direction === "OUTBOUND" &&
          message.type === optimisticOutgoingMessage.type &&
          persistedMatchesOptimisticContent(message.content) &&
          Math.abs(message.createdAt.getTime() - optimisticOutgoingMessage.createdAt.getTime()) < 120_000,
        ),
    );
  const baseRenderedMessages = useMemo(
    () =>
      renderedConversation &&
      optimisticOutgoingMessage &&
      renderedConversation.id === optimisticOutgoingMessage.conversationId &&
      !optimisticDraftMatchesLatestMessage &&
      !optimisticDraftHasPersistedMatch
        ? [...renderedConversation.messages, optimisticOutgoingMessage]
        : renderedConversation?.messages ?? [],
    [optimisticDraftHasPersistedMatch, optimisticDraftMatchesLatestMessage, optimisticOutgoingMessage, renderedConversation],
  );
  // Aplica borrados optimistas: marca como eliminado al instante mientras el
  // servidor confirma (si falla, se revierte el id en deletedMessageIds).
  const renderedMessages = useMemo(
    () =>
      deletedMessageIds.size === 0
        ? baseRenderedMessages
        : baseRenderedMessages.map((message) =>
            deletedMessageIds.has(message.id) && !message.deletedAt
              ? { ...message, deletedAt: new Date() }
              : message,
          ),
    [baseRenderedMessages, deletedMessageIds],
  );
  // Ref para leer el último mensaje dentro de efectos sin meter el array en deps
  // (un array en deps cambia de tamaño y React lanza error).
  const renderedMessagesRef = useRef(renderedMessages);
  renderedMessagesRef.current = renderedMessages;

  useEffect(() => {
    if (!optimisticOutgoingMessage || !renderedConversation) {
      return;
    }

    if (renderedConversation.id !== optimisticOutgoingMessage.conversationId) {
      return;
    }

    if (!optimisticDraftHasPersistedMatch) {
      return;
    }

    setOptimisticOutgoingMessage(null);
  }, [optimisticDraftHasPersistedMatch, optimisticOutgoingMessage, renderedConversation]);

  // Resuelve la burbuja optimista segun el resultado de la accion de envio:
  // - result null  -> la accion lanzo excepcion -> marcar "error" (+ Reintentar)
  // - result.ok === false -> error de validacion interna -> marcar "error"
  // - result.suppressOptimistic -> se disparo un flujo -> quitar la burbuja del texto
  // - ok (o void) -> dejar la burbuja; el sync en tiempo real la reemplaza por el real
  const finalizeOptimisticSend = useCallback(
    (optimisticId: string, result: { ok?: boolean; suppressOptimistic?: boolean; error?: string } | null) => {
      setOptimisticOutgoingMessage((current) => {
        if (!current || current.id !== optimisticId) {
          return current;
        }
        if (!result || result.ok === false) {
          const errorMessage = result?.error?.trim() || "No se pudo enviar el mensaje";
          console.error("[SharedInbox] send failed", { optimisticId, error: errorMessage });
          toast.error(errorMessage);
          return { ...current, outboundStatusLabel: "error" };
        }
        if (result.suppressOptimistic) {
          return null;
        }
        return current;
      });

      if (result?.ok && !result.suppressOptimistic) {
        scheduleConversationRefreshAfterSend();
      }
    },
    [scheduleConversationRefreshAfterSend],
  );

  const handleComposerDraft = useCallback(
    (message: string, formData: FormData) => {
      if (!renderedConversation || !composer) {
        return;
      }

      const now = new Date();
      const optimisticId = `optimistic:${renderedConversation.id}:${Date.now()}`;
      const optimisticListSnapshot = {
        id: renderedConversation.id,
        label: renderedConversation.label,
        secondaryLabel: renderedConversation.secondaryLabel,
        tags: renderedConversation.tags ?? [],
        avatarUrl: renderedConversation.avatarUrl ?? null,
        incomingCount: 0,
        lastMessage: message,
        lastMessageType: "TEXT" as const,
        lastMessageDirection: "OUTBOUND" as const,
        lastMessageAt: now,
        channelType: selectedConversationId.startsWith("official:") ? "whatsapp_official" : "whatsapp",
      };

      // La burbuja aparece al instante y se ve como un mensaje ya enviado
      // (sin etiqueta "enviando" ni atenuado). Si falla, se marca "error" despues.
      setOptimisticOutgoingMessage({
        id: optimisticId,
        conversationId: renderedConversation.id,
        content: message,
        direction: "OUTBOUND",
        createdAt: now,
        authorType: "user",
        outboundStatusLabel: null,
        type: "TEXT",
        mediaUrl: null,
        rawPayload: replyTarget
          ? {
              optimistic: true,
              replyTo: {
                content: replyTarget.content,
                direction: replyTarget.direction,
                type: replyTarget.type,
              },
            }
          : { optimistic: true },
        isOptimistic: true,
      });
      window.requestAnimationFrame(() => {
        const container = messagesScrollRef.current;
        if (!container) {
          return;
        }

        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
        isNearBottomRef.current = true;
        setUnreadCount(0);
      });

      window.dispatchEvent(
        new CustomEvent("chat-list-update", {
          detail: {
            conversation: optimisticListSnapshot,
          },
        }),
      );

      // Cita (Responder): mandamos el id (para citar en WhatsApp) y el preview
      // (texto + dirección) para que la cita se guarde y se vea siempre.
      if (replyTarget) {
        formData.set("quotedMessageId", replyTarget.id);
        formData.set("quotedContent", replyTarget.content);
        formData.set("quotedDirection", replyTarget.direction);
        setReplyTarget(null);
      }

      // Envio sin navegacion: la accion valida internamente y devuelve un resultado.
      void Promise.resolve(composer.action(formData))
        .then((result) => finalizeOptimisticSend(optimisticId, result ?? { ok: true }))
        .catch(() => finalizeOptimisticSend(optimisticId, null));
    },
    [renderedConversation, selectedConversationId, composer, finalizeOptimisticSend, replyTarget],
  );

  const handleReplyToMessage = useCallback((target: SharedInboxMessageItem) => {
    if (!target.id || target.id.startsWith("optimistic:")) {
      return;
    }
    const typeLabels: Record<string, string> = {
      IMAGE: "Imagen",
      AUDIO: "Audio",
      VIDEO: "Video",
      STICKER: "Sticker",
      DOCUMENT: "Documento",
    };
    const previewText = (target.content ?? "").trim() || typeLabels[target.type ?? "TEXT"] || "Mensaje";
    setReplyTarget({
      id: target.id,
      content: previewText,
      type: target.type ?? "TEXT",
      direction: target.direction,
    });
  }, []);

  const handleCancelReply = useCallback(() => setReplyTarget(null), []);

  const handleDeleteMessage = useCallback((target: SharedInboxMessageItem) => {
    if (!target.id || target.id.startsWith("optimistic:")) {
      return;
    }
    const isOutbound = target.direction === "OUTBOUND";
    const confirmText = isOutbound
      ? "¿Eliminar este mensaje? Se borrará también en el WhatsApp del cliente."
      : "¿Eliminar este mensaje de la bandeja? (Seguirá en el WhatsApp del cliente.)";
    if (typeof window !== "undefined" && !window.confirm(confirmText)) {
      return;
    }

    // Borrado optimista: se marca "eliminado" al instante. Si falla, se revierte.
    setDeletedMessageIds((current) => {
      const next = new Set(current);
      next.add(target.id);
      return next;
    });

    const formData = new FormData();
    formData.set("messageId", target.id);
    void Promise.resolve(deleteChatMessageAction(formData))
      .then((result) => {
        if (!result?.ok) {
          setDeletedMessageIds((current) => {
            const next = new Set(current);
            next.delete(target.id);
            return next;
          });
          toast.error(result?.error || "No se pudo eliminar el mensaje");
        }
      })
      .catch(() => {
        setDeletedMessageIds((current) => {
          const next = new Set(current);
          next.delete(target.id);
          return next;
        });
        toast.error("No se pudo eliminar el mensaje");
      });
  }, []);

  useEffect(() => {
    setReplyTarget(null);
  }, [selectedConversationId]);
  // El envio de AUDIO y de ARCHIVOS no usa los campos ocultos del formulario: lleva su propio
  // conversationId dentro de composer.audio / composer.media, que arma el servidor para el chat
  // que venia en la URL. Sin navegacion ese id queda congelado, asi que mandar una nota de voz o
  // una foto desde un chat abierto con click se la enviaria AL CLIENTE EQUIVOCADO. Se reapunta al
  // chat cargado, igual que los campos ocultos.
  const effectiveComposer = useMemo(() => {
    const targetId = renderedConversation && !renderedConversation.isPreview ? renderedConversation.id : null;
    if (!composer || !targetId) {
      return composer;
    }

    return {
      ...composer,
      audio: composer.audio ? { ...composer.audio, conversationId: targetId } : undefined,
      media: composer.media ? { ...composer.media, conversationId: targetId } : undefined,
    };
  }, [composer, renderedConversation]);

  // Controles de la cabecera (etapa del CRM, pausar la IA, resolver, importar historial) armados
  // en el CLIENTE con los datos que trae /live.
  //
  // El servidor tambien los manda (prop headerActions), pero los arma para el chat que venia en
  // la URL al cargar la pagina. Como abrir un chat ya no navega, ese elemento queda congelado en
  // el chat viejo —o es null si se entro por la lista—, y la vendedora se quedaba sin los botones
  // que mas usa. Se prefiere la version del cliente cuando hay datos frescos y se cae al prop del
  // servidor mientras no los haya (primer render por deep link).
  const clientHeaderActions = useMemo(() => {
    const conversation = renderedConversation;
    if (
      !conversation ||
      conversation.isPreview ||
      !selectedConversationKey.startsWith("agent:") ||
      !conversation.contactId ||
      !conversation.crmStage
    ) {
      return null;
    }

    return (
      <ChatHeaderActions
        key={`header-actions:${conversation.id}:${conversation.status ?? "OPEN"}`}
        contactId={conversation.contactId}
        stage={conversation.crmStage as CrmStage}
        conversationId={conversation.id}
        automationPaused={Boolean(conversation.automationPaused)}
        status={conversation.status ?? "OPEN"}
        returnTo={typeof window === "undefined" ? "" : window.location.pathname + window.location.search}
        toggleAutomationAction={toggleConversationAutomationAction}
        canImportHistory={Boolean(conversation.canImportHistory)}
      />
    );
  }, [renderedConversation, selectedConversationKey]);

  // "El chat ya esta asentado" = tenemos el contenido real del chat abierto, no el preview.
  // Antes se comprobaba contra currentSelectedConversation, que sale del prop del SERVIDOR: al
  // no navegar ese prop se congela en el chat con el que cargo la pagina y esto quedaba siempre
  // en falso, escondiendo los botones del encabezado (etapa del CRM, etiquetas, acciones).
  const hasSettledConversation = Boolean(
    renderedConversation &&
      !renderedConversation.isPreview &&
      conversationIdMatchesKey(selectedConversationKey, renderedConversation.id),
  );
  const canLoadOlderMessages = Boolean(renderedConversation?.loadMoreCursor && renderedConversation.hasMoreMessages);
  const loadOlderMessagesRef = useRef(loadOlderMessages);
  loadOlderMessagesRef.current = loadOlderMessages;
  const canLoadOlderMessagesRef = useRef(canLoadOlderMessages);
  canLoadOlderMessagesRef.current = canLoadOlderMessages;
  const loadMoreHrefRef = useRef(renderedConversation?.loadMoreHref ?? null);
  loadMoreHrefRef.current = renderedConversation?.loadMoreHref ?? null;
  const messageScrollBehaviorRef = useRef(messageScrollBehavior);
  messageScrollBehaviorRef.current = messageScrollBehavior;
  // OJO: comparar con conversationIdMatchesKey y no con ===. pendingConversation.id es la CLAVE
  // ("agent:cmxxx") y renderedConversation.id es el id pelado ("cmxxx"), asi que === siempre da
  // falso. Y esto no es cosmetico: buildComposerHiddenFields es lo que reescribe el
  // conversationId del formulario de envio. Si no entra, el formulario se queda con los campos
  // del servidor —congelados en el chat con el que cargo la pagina— y el mensaje se le manda AL
  // CLIENTE EQUIVOCADO. Antes quedaba tapado porque la seleccion pendiente se borraba al
  // completarse la navegacion y ahi el chat renderizado ya era el del servidor.
  // Se apunta al chat REALMENTE cargado (renderedConversation.id ya es el id pelado que espera la
  // accion de envio) y no a la clave de la seleccion. Si todavia no hay chat cargado se pasa null
  // y mandan los campos del servidor: es preferible el comportamiento viejo a inventar un id.
  const composerHiddenFields = composer
    ? buildComposerHiddenFields(
        composer.hiddenFields,
        pendingConversation &&
          renderedConversation &&
          !renderedConversation.isPreview &&
          conversationIdMatchesKey(pendingConversation.id, renderedConversation.id)
          ? {
              conversationId: renderedConversation.id,
              source: pendingConversation.source ?? "agent",
              agentId: pendingConversation.agentId ?? null,
            }
          : null,
      )
    : [];
  // Refs para mantener estable handleRetryFailedMessage (asi MessageBubble no
  // re-renderiza toda la lista en cada render por un callback nuevo).
  const composerRef = useRef(composer);
  composerRef.current = composer;
  const composerHiddenFieldsRef = useRef(composerHiddenFields);
  composerHiddenFieldsRef.current = composerHiddenFields;
  const optimisticOutgoingMessageRef = useRef(optimisticOutgoingMessage);
  optimisticOutgoingMessageRef.current = optimisticOutgoingMessage;

  const handleRetryFailedMessage = useCallback(() => {
    const composerValue = composerRef.current;
    const failed = optimisticOutgoingMessageRef.current;
    const text = failed?.content?.trim();
    if (!composerValue || !failed || !text) {
      return;
    }

    const formData = new FormData();
    formData.set("message", text);
    for (const field of composerHiddenFieldsRef.current) {
      formData.set(field.name, field.value);
    }

    // Reintento: vuelve a verse como mensaje enviado (sin etiqueta de error) y se
    // valida internamente; si vuelve a fallar, se marca "error" de nuevo.
    const optimisticId = `optimistic:${failed.conversationId}:${Date.now()}`;
    setOptimisticOutgoingMessage({
      ...failed,
      id: optimisticId,
      outboundStatusLabel: null,
      createdAt: new Date(),
    });

    void Promise.resolve(composerValue.action(formData))
      .then((result) => finalizeOptimisticSend(optimisticId, result ?? { ok: true }))
      .catch(() => finalizeOptimisticSend(optimisticId, null));
  }, [finalizeOptimisticSend]);
  // Identidad estable de la conversación: normalizamos el id (el preview viene como
  // "agent:<id>" y el cargado como "<id>"), si no, split(":")[0] daría "agent" para todos
  // los chats y no detectaría el cambio de conversación → el scroll no bajaría al fondo.
  // Usamos "|" como separador porque el id puede contener ":".
  const selectedConversationScrollKey = renderedConversation
    ? `${extractConversationIdFromKey(renderedConversation.id)}|${renderedMessages.length}|${renderedMessages.at(-1)?.id ?? ""}`
    : "empty";
  const hasSidebar = sidebarItems.length > 0;

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  // Reset scroll state when the user opens a different conversation.
  useEffect(() => {
    isNearBottomRef.current = true;
    setUnreadCount(0);
    prevScrollKeyRef.current = "";
    lastScrollTopRef.current = 0;
    historyLoadArmedRef.current = false;
    historyLoadConsumedRef.current = false;
  }, [selectedConversationId]);

  // Track whether the user is near the bottom of the message list and only arm
  // older-history loading after the user actually scrolls upward.
  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    const BOTTOM_SCROLL_THRESHOLD_PX = 24;
    const TOP_SCROLL_THRESHOLD_PX = 96;

    function handleScroll() {
      const el = container!;
      const nextScrollTop = el.scrollTop;
      const previousScrollTop = lastScrollTopRef.current;
      // Ventana tras abrir el chat: ignoramos los scrolls programáticos (pin al fondo) para
      // no armar ni lanzar la carga de mensajes anteriores, que anclaría la vista arriba.
      const historyLoadSuppressed = suppressHistoryLoadUntilRef.current > Date.now();

      if (!historyLoadSuppressed && nextScrollTop < previousScrollTop) {
        historyLoadArmedRef.current = true;
      }

      if (nextScrollTop > TOP_SCROLL_THRESHOLD_PX) {
        historyLoadConsumedRef.current = false;
      }

      lastScrollTopRef.current = nextScrollTop;

      const distFromBottom = el.scrollHeight - nextScrollTop - el.clientHeight;
      isNearBottomRef.current = distFromBottom <= BOTTOM_SCROLL_THRESHOLD_PX;
      if (isNearBottomRef.current) setUnreadCount(0);

      if (
        historyLoadSuppressed ||
        !historyLoadArmedRef.current ||
        historyLoadConsumedRef.current ||
        nextScrollTop > TOP_SCROLL_THRESHOLD_PX ||
        loadMoreHistoryInFlightRef.current
      ) {
        return;
      }

      historyLoadArmedRef.current = false;
      historyLoadConsumedRef.current = true;

      const loadMoreHref = loadMoreHrefRef.current;
      if (loadMoreHref && messageScrollBehaviorRef.current === "preserve") {
        router.replace(loadMoreHref, { scroll: false });
        return;
      }

      if (canLoadOlderMessagesRef.current) {
        void loadOlderMessagesRef.current();
      }
    }

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [router]);

  // Smart scroll: auto-scroll only when near bottom; count new messages when scrolled up.
  useLayoutEffect(() => {
    if (messageScrollBehavior !== "bottom") return;

    const container = messagesScrollRef.current;
    const currentKey = selectedConversationScrollKey;
    const prevKey = prevScrollKeyRef.current;
    prevScrollKeyRef.current = currentKey;

    if (currentKey === "empty" || !container) return;

    if (loadMoreHistoryRestoreRef.current) {
      const restore = loadMoreHistoryRestoreRef.current;
      // Al cargar mensajes antiguos arriba, el contenido inferior no cambia, así que
      // mantener (scrollHeight - scrollTop) constante conserva la vista exacta. Como ya
      // no hay virtualización, la altura es real: basta fijar antes del paint (este
      // useLayoutEffect) + un par de frames por si algún media termina de cargar.
      const distanceFromBottom = Math.max(0, restore.scrollHeight - restore.scrollTop);
      const pinScroll = () => {
        const el = messagesScrollRef.current;
        if (!el) return;
        el.scrollTop = Math.max(0, el.scrollHeight - distanceFromBottom);
      };
      pinScroll();
      window.requestAnimationFrame(pinScroll);
      loadMoreHistoryRestoreRef.current = null;
      return;
    }

    const jumpToBottom = (smooth: boolean) => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }

      // En salto inmediato (no-smooth) fijamos el scroll YA, dentro de este useLayoutEffect
      // (antes del paint), para que no se vea un frame "arriba" antes del rAF. El rAF queda
      // como re-anclaje por si la altura cambia (media que termina de cargar, etc.).
      if (!smooth) {
        container.scrollTop = container.scrollHeight;
      }

      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = window.requestAnimationFrame(() => {
          if (smooth) {
            container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
          } else {
            container.scrollTop = container.scrollHeight;
          }

          isNearBottomRef.current = true;
          setUnreadCount(0);
          scrollFrameRef.current = null;
        });
      });
    };

    if (!prevKey || prevKey === "empty") {
      // Initial load — jump to bottom without animation.
      jumpToBottom(false);
      return;
    }

    const prevConvId = prevKey.split("|")[0];
    const curConvId = currentKey.split("|")[0];

    if (prevConvId !== curConvId) {
      // Different conversation opened — always jump to bottom.
      jumpToBottom(false);
      return;
    }

    // Same conversation: check for appended messages.
    const prevCount = Number(prevKey.split("|")[1]) || 0;
    const curCount = Number(currentKey.split("|")[1]) || 0;
    const added = curCount - prevCount;
    if (added <= 0) {
      // Mismo número de mensajes pero el contenido/altura pudo cambiar (p. ej. al pasar
      // de la caché al detalle del servidor). Si el usuario está al fondo, lo mantenemos
      // pegado abajo para que no parezca que "se subió".
      if (isNearBottomRef.current) {
        jumpToBottom(false);
      }
      return;
    }

    // First messages arriving (0 → N): always jump to bottom regardless of scroll position.
    if (prevCount === 0) {
      jumpToBottom(false);
      return;
    }

    // Transition from a lightweight preview (usually 1 message) to the real chat:
    // use a hard jump so the final hydration doesn't leave the viewport slightly above.
    if (prevCount <= 1) {
      jumpToBottom(false);
      return;
    }

    // Comportamiento estilo WhatsApp:
    // - Tu propio envío (burbuja optimista) → baja para verlo.
    // - Estás cerca del fondo (leyendo lo último) → baja natural al mensaje nuevo.
    // - Estás arriba en el historial → NO mueve el scroll; si es entrante, muestra
    //   el contador "↓ N" de no leídos.
    const lastMessage = renderedMessagesRef.current.at(-1);
    const lastMessageIsOwnDraft =
      typeof lastMessage?.id === "string" && lastMessage.id.startsWith("optimistic:");

    if (lastMessageIsOwnDraft || isNearBottomRef.current) {
      jumpToBottom(true);
      return;
    }

    // Scrolleado arriba: anclamos a la posición previa para que el re-render no la
    // mueva, y contamos el no leído si el mensaje es entrante.
    container.scrollTop = lastScrollTopRef.current;
    if (lastMessage?.direction === "INBOUND") {
      setUnreadCount((prev) => prev + added);
    }
  }, [selectedConversationScrollKey, messageScrollBehavior]);

  // Al ABRIR una conversación (cambia el id normalizado), fijamos el scroll al fondo de
  // forma agresiva en varios frames/timeouts. Así, aunque el contenido pase por las
  // transiciones caché → SSR → /live (que cambian la altura), el chat siempre queda en el
  // último mensaje y no se ve "subido". No interfiere con la llegada de mensajes nuevos
  // (eso lo maneja el efecto de arriba), porque solo corre cuando cambia la conversación.
  const openedConversationIdRef = useRef("");
  useLayoutEffect(() => {
    if (messageScrollBehavior !== "bottom") return;
    const convId = renderedConversation ? extractConversationIdFromKey(renderedConversation.id) : "";
    if (!convId || convId === openedConversationIdRef.current) return;
    openedConversationIdRef.current = convId;
    // Bloquea la carga automática de historial durante la apertura (los pines de scroll
    // disparan el listener y, si no, anclarían la vista arriba).
    suppressHistoryLoadUntilRef.current = Date.now() + 700;

    const pinToBottom = () => {
      const el = messagesScrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      lastScrollTopRef.current = el.scrollTop;
      isNearBottomRef.current = true;
    };

    pinToBottom();
    const raf1 = window.requestAnimationFrame(() => {
      pinToBottom();
      window.requestAnimationFrame(pinToBottom);
    });
    const t1 = window.setTimeout(pinToBottom, 80);
    const t2 = window.setTimeout(pinToBottom, 250);

    return () => {
      window.cancelAnimationFrame(raf1);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [renderedConversation, messageScrollBehavior]);

  // Cuando el contenido CRECE después del render (típicamente una imagen/media que termina
  // de cargar), si el usuario está al fondo o el chat se acaba de abrir, volvemos a pegar
  // la vista abajo. Sin esto, los chats con foto/video quedan a media altura al abrir.
  useEffect(() => {
    if (messageScrollBehavior !== "bottom") return;
    const container = messagesScrollRef.current;
    const content = container?.firstElementChild;
    if (!container || !content) return;

    let lastScrollHeight = container.scrollHeight;
    const observer = new ResizeObserver(() => {
      const el = messagesScrollRef.current;
      if (!el) return;
      const grew = el.scrollHeight > lastScrollHeight + 1;
      lastScrollHeight = el.scrollHeight;
      if (!grew) return;

      const justOpened = suppressHistoryLoadUntilRef.current > Date.now();
      if (isNearBottomRef.current || justOpened) {
        el.scrollTop = el.scrollHeight;
        lastScrollTopRef.current = el.scrollTop;
        isNearBottomRef.current = true;
      }
    });

    observer.observe(content);
    return () => observer.disconnect();
  }, [messageScrollBehavior, selectedConversationId]);

  const scrollToBottom = useCallback(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    isNearBottomRef.current = true;
    setUnreadCount(0);
  }, []);

  return (
    <>
    <div
      className={`chat-inbox-grid flex h-full min-h-0 flex-1 flex-col gap-0 overflow-hidden md:grid ${
        hasSidebar ? "md:grid-cols-[250px_360px_minmax(0,1fr)]" : "md:grid-cols-[380px_minmax(0,1fr)]"
      }`}
    >
      {hasSidebar ? (
        <div className="hidden chat-inbox-sidebar min-h-0 overflow-hidden rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#171717] p-0 text-white shadow-[0_28px_70px_-42px_rgba(15,23,42,0.42)] md:flex md:h-full">
          <div className="flex min-h-0 w-full flex-col">
            <div className="border-b border-white/8 px-4 py-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/90">
                  <MessageSquareText className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold tracking-[-0.03em] text-white">Chats</p>
                  <p className="text-[11px] text-white/45">Conexiones creadas</p>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
              <nav className="space-y-1">
                {sidebarItems.map((item) => {
                  const isActive = item.isActive || selectedConnectionKey === item.id;
                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      className={`group flex items-center gap-3 rounded-2xl px-3 py-2.5 transition ${
                        isActive ? "bg-white/8 text-white" : "text-white/72 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <span
                        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
                          isActive ? "border-white/16 bg-white/8" : "border-white/8 bg-white/4"
                        }`}
                      >
                        {item.channelType === "whatsapp_official" ? (
                          <BadgeCheck className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <MessageCircle className="h-4 w-4 text-emerald-400" />
                        )}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.label}</p>
                        {item.helper ? <p className="truncate text-[11px] text-white/42">{item.helper}</p> : null}
                      </div>

                      <ChevronRight
                        className={`h-4 w-4 shrink-0 transition ${
                          isActive ? "translate-x-0 text-white/75" : "text-white/28 group-hover:text-white/55"
                        }`}
                      />
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>
      ) : null}

      <AppSidebar
        conversationItems={displayedConversationItems}
        selectedConversationId={selectedConversationId}
        searchAction={searchAction}
        selectedConnectionKey={selectedConnectionKey}
        searchQuery={searchQuery}
        assignedFilter={assignedFilter}
        statusFilter={statusFilter}
        assignedCounts={assignedCounts}
        isManager={isManager}
        searchInputValue={searchInputValue}
        searchInputRef={searchInputRef}
        onSearchChange={handleSearchChange}
        onSearchClear={handleSearchClear}
        onSearchSubmit={() => {
          if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
          void runSearchAugmentation(searchInputValue);
        }}
        hasMoreConversationItems={hasMoreConversationItems}
        isLoadingMoreConversationItems={isLoadingMoreConversationItems}
        onLoadMoreConversationItems={loadMoreConversationItems}
        mobileConversationActive={mobileConversationActive}
        emptyListTitle={emptyListTitle}
        emptyListDescription={emptyListDescription}
      />

      <ConversationPanel
        // Clave del panel = clave EFECTIVA del chat (pendiente o de la URL). Antes usaba
        // selectedConversationId (solo la URL), que cambia al confirmarse la navegación
        // DESPUÉS de mostrar el chat optimista → el panel se re-montaba a mitad de la
        // apertura, el contenedor de scroll nacía arriba y se veía un "sube y baja" antes
        // de re-anclar al fondo. selectedConversationKey es idéntica en el estado pendiente
        // y tras el commit (misma "agent:<id>"), así que el panel se monta UNA sola vez al
        // hacer click y el pin al fondo queda estable.
        key={mobileConversationActive ? (selectedConversationKey || "selected") : "empty"}
        canDeleteTags={isManager}
        backHref={backHref}
        composer={effectiveComposer}
        composerHiddenFields={composerHiddenFields}
        hasSettledConversation={hasSettledConversation}
        isLoadingOlderMessages={isLoadingOlderMessages}
        loadMoreSentinelRef={loadMoreSentinelRef}
        messageScrollBehavior={messageScrollBehavior}
        messagesScrollRef={messagesScrollRef}
        unreadCount={unreadCount}
        onScrollToBottom={scrollToBottom}
        onEditContact={handleOpenEditContact}
        onComposerDraft={handleComposerDraft}
        onRetryFailedMessage={handleRetryFailedMessage}
        onReplyToMessage={handleReplyToMessage}
        onDeleteMessage={handleDeleteMessage}
        replyTarget={replyTarget}
        onCancelReply={handleCancelReply}
        onLoadOlderMessages={loadOlderMessages}
        renderedConversation={renderedConversation}
        renderedMessages={renderedMessages}
        selectedConversationId={selectedConversationId}
        selectedConversationScrollKey={selectedConversationScrollKey}
        selectedConversationTags={selectedConversationTags}
        emptySelectionTitle={emptySelectionTitle}
        emptySelectionDescription={emptySelectionDescription}
        headerActions={clientHeaderActions ?? headerActions}
        headerBadge={headerBadge}
        contactPanelActions={contactPanelActions}
      />
    </div>

    {renderedConversation?.contactId ? (
      <EditContactModal
        open={editContactOpen}
        onClose={handleCloseEditContact}
        contactId={renderedConversation.contactId}
        contactName={renderedConversation.contactName ?? renderedConversation.label}
      />
    ) : null}
    </>
  );
}



