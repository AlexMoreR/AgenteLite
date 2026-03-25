export type WorkspacePlanTier = "GRATIS" | "BASICO" | "AVANZADO";

export const DEFAULT_TRIAL_DAYS = 3;

export const workspacePlanLabels: Record<WorkspacePlanTier, string> = {
  GRATIS: "Gratis",
  BASICO: "Basico",
  AVANZADO: "Avanzado",
};

export function buildDefaultWorkspacePlan(startedAt = new Date()) {
  const planExpiresAt = new Date(startedAt);
  planExpiresAt.setDate(planExpiresAt.getDate() + DEFAULT_TRIAL_DAYS);

  return {
    planTier: "GRATIS" as WorkspacePlanTier,
    planStartedAt: startedAt,
    planExpiresAt,
  };
}

export function getWorkspacePlanLabel(planTier: WorkspacePlanTier | null | undefined) {
  if (!planTier) return "Sin plan";
  return workspacePlanLabels[planTier];
}

export function isWorkspacePlanExpired(planExpiresAt: Date | null | undefined) {
  if (!planExpiresAt) return false;
  return planExpiresAt.getTime() < Date.now();
}
