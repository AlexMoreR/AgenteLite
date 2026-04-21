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
  type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "TEMPLATE" | "INTERACTIVE" | "SYSTEM";
  mediaUrl: string | null;
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

export type OfficialApiChatbotMetric = {
  id: string;
  label: string;
  value: string;
  helper: string;
};

export type OfficialApiChatbotCapability = {
  id: string;
  title: string;
  description: string;
  status: "ready" | "recommended";
};

export type OfficialApiChatbotRule = {
  id: string;
  title: string;
  description: string;
  triggerLabel: string;
  outcomeLabel: string;
  isEnabled: boolean;
};

export type OfficialApiChatbotTemplate = {
  id: string;
  title: string;
  category: string;
  message: string;
};

export type OfficialApiChatbotScenarioMessage = {
  id: string;
  direction: "inbound" | "bot";
  content: string;
};

export type OfficialApiChatbotScenario = {
  id: string;
  title: string;
  summary: string;
  messages: OfficialApiChatbotScenarioMessage[];
};

export type OfficialApiChatbotChecklistItem = {
  id: string;
  title: string;
  description: string;
  done: boolean;
};

export type OfficialApiChatbotBuilderNode = {
  id: string;
  kind: "trigger" | "message" | "image" | "audio" | "video" | "document" | "input" | "condition" | "action";
  title: string;
  body: string;
  meta: string;
};

export type OfficialApiChatbotNodesByScenarioId = Record<string, OfficialApiChatbotBuilderNode[]>;
export type OfficialApiChatbotNodePosition = { x: number; y: number };
export type OfficialApiChatbotNodePositionsByScenarioId = Record<string, Record<string, OfficialApiChatbotNodePosition>>;
export type OfficialApiChatbotBuilderEdge = {
  id: string;
  source: string;
  target: string;
};
export type OfficialApiChatbotEdgesByScenarioId = Record<string, OfficialApiChatbotBuilderEdge[]>;

export type OfficialApiChatbotData = {
  configId: string | null;
  isConnected: boolean;
  workspaceName: string;
  phoneNumberIdLabel: string;
  wabaIdLabel: string;
  metrics: OfficialApiChatbotMetric[];
  capabilities: OfficialApiChatbotCapability[];
  rules: OfficialApiChatbotRule[];
  templates: OfficialApiChatbotTemplate[];
  scenarios: OfficialApiChatbotScenario[];
  checklist: OfficialApiChatbotChecklistItem[];
  defaults: {
    isBotEnabled: boolean;
    welcomeMessage: string;
    fallbackMessage: string;
    businessHours: string;
    captureLeadEnabled: boolean;
    handoffEnabled: boolean;
    fallbackEnabled: boolean;
    replyEveryMessageEnabled: boolean;
    selectedScenarioId: string;
    scenarios: OfficialApiChatbotScenario[];
    nodesByScenarioId: OfficialApiChatbotNodesByScenarioId;
    nodePositionsByScenarioId: OfficialApiChatbotNodePositionsByScenarioId;
    edgesByScenarioId: OfficialApiChatbotEdgesByScenarioId;
  };
};

export type OfficialApiAdminSummary = {
  workspaceId: string | null;
  workspaceName: string | null;
  setupStatus: OfficialApiSetupStatus;
  hasWorkspace: boolean;
  hasCredentials: boolean;
  configuredFields: string[];
};
