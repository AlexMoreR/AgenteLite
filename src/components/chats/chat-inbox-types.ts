import type { ReactNode } from "react";

export type SharedInboxConversationItemLike = Partial<Omit<SharedInboxConversationItem, "lastMessageAt">> & {
  id?: string;
  key?: string;
  conversationId?: string;
  href?: string;
  lastMessageAt?: Date | string | null;
};

export type SharedInboxConversationItem = {
  id: string;
  source: "agent" | "official";
  agentId?: string | null;
  // Canal de la conversacion. Se usa para descartar los chats que llegan por realtime de
  // un canal distinto al que se esta viendo (se colaban en la lista filtrada).
  channelId?: string | null;
  contactId?: string | null;
  label: string;
  secondaryLabel: string;
  tags?: Array<{
    label: string;
    color: string;
  }>;
  channelType?: "whatsapp" | "whatsapp_official" | "instagram" | "facebook";
  incomingCount?: number | null;
  avatarUrl?: string | null;
  assignedToName?: string | null;
  // Etapa del CRM del contacto, para mostrar el badge de etapa en la fila de la lista.
  crmStage?: string | null;
  // Abierta o resuelta: el menu de la fila necesita saberlo para ofrecer "Resolver" o "Reabrir".
  status?: "OPEN" | "PENDING" | "CLOSED" | "ARCHIVED" | null;
  lastMessage: string | null;
  lastMessageType?: SharedInboxMessageItem["type"] | null;
  lastMessageDirection?: "INBOUND" | "OUTBOUND" | null;
  lastMessageAt?: Date | null;
  href: string;
};

export type SharedInboxMessageItem = {
  id: string;
  content: string | null;
  direction: "INBOUND" | "OUTBOUND";
  createdAt: Date;
  editedAt?: Date | null;
  deletedAt?: Date | null;
  authorType?: "user" | "bot";
  outboundStatusLabel?: string | null;
  // Motivo del rechazo cuando el envio fallo: la burbuja lo muestra en vez de un icono mudo.
  errorDetail?: string | null;
  type?: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "CONTACTS" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE";
  mediaUrl?: string | null;
  // Reaccion del cliente sobre este mensaje (👍 ❤️ …). Se dibuja pegada a la burbuja, abajo a la
  // derecha, como en WhatsApp; NO es un mensaje aparte.
  reactionEmoji?: string | null;
  rawPayload?: unknown;
};

export type SharedInboxSelectedConversation = {
  id: string;
  label: string;
  secondaryLabel: string;
  tags?: Array<{
    label: string;
    color: string;
  }>;
  avatarUrl?: string | null;
  contactId?: string | null;
  contactName?: string | null;
  messages: SharedInboxMessageItem[];
  automationPaused?: boolean;
  // Datos de los controles de la cabecera (etapa, resolver, asignar, importar historial). Los
  // trae /api/cliente/chats/live para poder dibujar esos botones en el CLIENTE: antes los armaba
  // el servidor por chat y, al abrir un chat sin navegar, quedaban congelados o desaparecian.
  crmStage?: string | null;
  // Canal al que pertenece el chat: define por QUE numero sale una llamada hecha desde aca.
  channelId?: string | null;
  status?: "OPEN" | "PENDING" | "CLOSED" | "ARCHIVED" | null;
  assignedTo?: { id: string; name: string | null; email: string | null } | null;
  canImportHistory?: boolean;
  loadMoreHref?: string | null;
  loadMoreCursor?: string | null;
  hasMoreMessages?: boolean;
  cacheKey?: string | null;
  isPreview?: boolean;
};

export type OptimisticDraftMessage = SharedInboxMessageItem & {
  conversationId: string;
  isOptimistic: true;
};

export type ComposerReplyTarget = {
  id: string;
  content: string;
  type: SharedInboxMessageItem["type"];
  direction: "INBOUND" | "OUTBOUND";
};

export type LiveConversationSnapshot = SharedInboxSelectedConversation & {
  messages: Array<SharedInboxMessageItem & { createdAt: Date }>;
};

export type LiveConversationListSnapshot = SharedInboxConversationItem & {
  lastMessageAt: Date | null;
};

export type ConversationContactUpdateDetail = {
  contactId: string;
  name: string;
};

export type ConversationTagsUpdateDetail = {
  contactId: string;
  tags: Array<{
    label: string;
    color: string;
  }>;
};

export type SharedInboxSidebarItem = {
  id: string;
  label: string;
  helper?: string;
  href: string;
  isActive?: boolean;
  channelType?: SharedInboxConversationItem["channelType"];
};

export type AssignedFilter = "all" | "mine" | "unassigned";
export type StatusFilter = "all" | "open" | "resolved";

export type SharedInboxProps = {
  searchAction: string;
  selectedConversationId: string;
  mobileConversationActive?: boolean;
  searchQuery: string;
  selectedConnectionKey?: string;
  assignedFilter?: AssignedFilter;
  statusFilter?: StatusFilter;
  isManager?: boolean;
  /** La firma de quien escribe, para dejarla visible en el compositor. */
  chatSignature?: string;
  conversationListApiPath?: string;
  initialConversationBatchSize?: number;
  initialHasMoreConversations?: boolean;
  /**
   * Desde que fila de la BASE sigue la proxima pagina.
   *
   * No es lo mismo que la cantidad de chats que se ven: el servidor descarta los leads pospuestos
   * despues de leer, asi que muestra menos filas de las que consumio. Contando los mostrados el
   * offset se corre hacia atras y la pagina siguiente devuelve chats repetidos.
   */
  initialConversationOffset?: number;
  sidebarItems?: SharedInboxSidebarItem[];
  conversations: SharedInboxConversationItem[];
  selectedConversation: SharedInboxSelectedConversation | null;
  selectedConversationTags?: Array<{
    label: string;
    color: string;
  }>;
  backHref: string;
  headerBadge?: ReactNode;
  headerActions?: ReactNode;
  contactPanelActions?: ReactNode;
  // Acciones de la cabecera del panel de contacto (al lado del titulo "Contacto").
  contactPanelHeaderActions?: ReactNode;
  composer?: {
    action: (formData: FormData) => void | Promise<{ ok: boolean; error?: string; suppressOptimistic?: boolean } | void>;
    hiddenFields: Array<{ name: string; value: string }>;
    placeholder?: string;
    audio?: {
      uploadPath: string;
      conversationId: string;
      source: string;
      agentId: string;
      returnTo: string;
      sendAction: (input: {
        source: string;
        conversationId: string;
        agentId: string;
        audioUrl: string;
        returnTo: string;
      }) => Promise<{ ok: true } | { error: string }>;
    };
    media?: {
      uploadPath: string;
      conversationId: string;
      source: string;
      agentId: string;
      returnTo: string;
      sendAction: (input: {
        source: string;
        conversationId: string;
        agentId: string;
        mediaUrl: string;
        mediaType: "IMAGE" | "VIDEO" | "DOCUMENT";
        fileName: string;
        mimeType: string;
        caption?: string;
        returnTo: string;
      }) => Promise<{ ok: true } | { error: string }>;
    };
  };
  emptyListTitle: string;
  emptyListDescription: string;
  emptySelectionTitle: string;
  emptySelectionDescription: string;
  messageScrollBehavior?: "bottom" | "preserve";
};

/**
 * Aviso de que un chat se resolvio (o se reabrio) desde el panel.
 *
 * La lista de la bandeja solo hace upsert —nunca quita— asi que un chat resuelto seguia a la
 * vista hasta recargar la pagina: la asesora le daba a "Resolver" y ahi seguia. El boton avisa
 * por este evento y la bandeja lo saca si ya no corresponde al filtro que se esta viendo.
 */
export const CHAT_STATUS_CHANGED_EVENT = "chat:status-changed";

export type ChatStatusChangedDetail = {
  conversationId: string;
  source: "agent" | "official";
  resolved: boolean;
};

/**
 * Se pospuso un chat: sale de la bandeja EN EL ACTO.
 *
 * Va aparte de "chat:status-changed" porque posponer NO es resolver: la conversacion sigue
 * abierta. Y tiene que salir con cualquier filtro puesto (Abiertas, Resueltas o Todas), cosa que
 * el evento de estado no hace — mira si el chat "ya no corresponde" al filtro, y un pospuesto
 * sigue correspondiendo.
 */
export const CHAT_SNOOZED_EVENT = "chat:snoozed";

export type ChatSnoozedDetail = {
  conversationId: string;
  source: "agent" | "official";
};
