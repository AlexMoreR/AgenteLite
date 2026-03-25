export type WorkspacePlanTier = "GRATIS" | "BASICO" | "AVANZADO";

export const DEFAULT_TRIAL_DAYS = 3;
export const PLAN_WARNING_THRESHOLD_DAYS = 4;
export const CLIENT_PLAN_PAYMENT_HREF = "/#precios";

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

export function getDaysUntilPlanExpiry(planExpiresAt: Date | null | undefined, now = new Date()) {
  if (!planExpiresAt) return null;

  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  return Math.ceil((planExpiresAt.getTime() - now.getTime()) / millisecondsPerDay);
}

export function shouldShowWorkspacePlanWarning(planExpiresAt: Date | null | undefined, now = new Date()) {
  const daysRemaining = getDaysUntilPlanExpiry(planExpiresAt, now);
  if (daysRemaining === null) return false;
  return daysRemaining >= 0 && daysRemaining <= PLAN_WARNING_THRESHOLD_DAYS;
}

export function getWorkspacePlanState(planExpiresAt: Date | null | undefined, now = new Date()) {
  const daysRemaining = getDaysUntilPlanExpiry(planExpiresAt, now);
  const isExpired = isWorkspacePlanExpired(planExpiresAt);

  return {
    daysRemaining,
    isExpired,
    warning: !isExpired && shouldShowWorkspacePlanWarning(planExpiresAt, now),
    expired: isExpired,
    blockClientArea: isExpired,
  };
}
