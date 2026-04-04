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

export type OfficialApiAdminSummary = {
  workspaceId: string | null;
  workspaceName: string | null;
  setupStatus: OfficialApiSetupStatus;
  hasWorkspace: boolean;
  hasCredentials: boolean;
  configuredFields: string[];
};
