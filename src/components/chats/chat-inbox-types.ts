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
  type?: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE";
  mediaUrl?: string | null;
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
  conversationListApiPath?: string;
  initialConversationBatchSize?: number;
  initialHasMoreConversations?: boolean;
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
