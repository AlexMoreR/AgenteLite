export type ContactosConversationSummary = {
  id: string;
  status: "OPEN" | "PENDING" | "CLOSED" | "ARCHIVED";
  automationPaused: boolean;
  lastMessageAt: string | null;
  startedAt: string;
  updatedAt: string;
  agent: {
    id: string;
    name: string;
  } | null;
  channel: {
    id: string;
    name: string;
    provider: "EVOLUTION" | "OFFICIAL_API";
  } | null;
  lastMessage: {
    content: string | null;
    createdAt: string;
    direction: "INBOUND" | "OUTBOUND";
    type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE";
  } | null;
};

export type ContactosContact = {
  id: string;
  name: string | null;
  phoneNumber: string;
  email: string | null;
  notes: string | null;
  avatarUrl: string | null;
  tags: Array<{
    label: string;
    color: string;
  }>;
  createdAt: string;
  updatedAt: string;
  totalConversations: number;
  totalMessages: number;
  lastActivityAt: string | null;
  recentConversations: ContactosConversationSummary[];
};

export type ContactosStats = {
  total: number;
  withConversations: number;
  withoutConversations: number;
  withEmail: number;
};

export type ContactosDailyCreationStat = {
  dayKey: string;
  label: string;
  count: number;
  firstCreatedAt: string;
  lastCreatedAt: string;
};

export type ContactosCreationHeatmapDay = {
  dayKey: string;
  dayLabel: string;
  dateLabel: string;
  total: number;
  hours: Array<{
    hour: number;
    count: number;
  }>;
};

export type ContactosCreationHeatmap = {
  maxCount: number;
  days: ContactosCreationHeatmapDay[];
};

export type ContactosData = {
  workspaceId: string;
  workspaceName: string;
  searchQuery: string;
  agentFilterId: string | null;
  agentFilterName: string | null;
  reportRangeDays: number;
  stats: ContactosStats;
  dailyCreationStats: ContactosDailyCreationStat[];
  creationHeatmap: ContactosCreationHeatmap;
  contacts: ContactosContact[];
  selectedContactId: string | null;
  selectedContact: ContactosContact | null;
};
