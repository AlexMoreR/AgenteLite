export type OfficialApiSetupStatus = "connected" | "pending";

export type OfficialApiFeatureStatus = "phase-1" | "next-phase";

export type OfficialApiRouteDefinition = {
  id: string;
  title: string;
  href: string;
  description: string;
  status: OfficialApiFeatureStatus;
};

export type OfficialApiDataModelDefinition = {
  model: string;
  description: string;
};

export type OfficialApiOverview = {
  workspaceId: string;
  workspaceName: string;
  setupStatus: OfficialApiSetupStatus;
  connectedLabel: string;
  configuredFields: string[];
  plannedRoutes: OfficialApiRouteDefinition[];
  dataModel: OfficialApiDataModelDefinition[];
  nextBuildSteps: string[];
};

export type OfficialApiChatConversationSummary = {
  id: string;
  contact: {
    id: string;
    name: string | null;
    phoneNumber: string | null;
    waId: string;
  };
  lastMessage: {
    id: string;
    content: string | null;
    direction: "INBOUND" | "OUTBOUND";
    createdAt: Date;
    status: "RECEIVED" | "SENT" | "DELIVERED" | "READ" | "FAILED";
  } | null;
};

export type OfficialApiChatMessage = {
  id: string;
  content: string | null;
  direction: "INBOUND" | "OUTBOUND";
  createdAt: Date;
  status: "RECEIVED" | "SENT" | "DELIVERED" | "READ" | "FAILED";
  rawPayload: unknown;
};

export type OfficialApiChatConversationDetail = {
  id: string;
  contact: {
    id: string;
    name: string | null;
    phoneNumber: string | null;
    waId: string;
  };
  messages: OfficialApiChatMessage[];
};

export type OfficialApiChatsData = {
  configId: string | null;
  isConnected: boolean;
  conversations: OfficialApiChatConversationSummary[];
  selectedConversation: OfficialApiChatConversationDetail | null;
  selectedConversationId: string;
  searchQuery: string;
};

export type OfficialApiAdminSummary = {
  workspaceId: string | null;
  workspaceName: string | null;
  setupStatus: OfficialApiSetupStatus;
  hasWorkspace: boolean;
  hasCredentials: boolean;
  configuredFields: string[];
};
