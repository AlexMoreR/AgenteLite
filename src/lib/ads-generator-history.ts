import { prisma } from "@/lib/prisma";
import type { AdsGeneratorHistoryEntry } from "@/features/ads-generator/types/ad-history";

const ADS_GENERATOR_HISTORY_LIMIT = 12;

function getAdsGeneratorHistorySettingKey(workspaceId: string) {
  return `workspace:${workspaceId}:adsGeneratorHistory`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isImageShape(value: unknown) {
  if (value === null) {
    return true;
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.url === "string" &&
    (typeof candidate.alt === "string" || typeof candidate.alt === "undefined") &&
    (candidate.source === "creativos" || candidate.source === "upload" || candidate.source === "external") &&
    (typeof candidate.isPrimary === "boolean" || typeof candidate.isPrimary === "undefined")
  );
}

function isHistoryEntry(value: unknown): value is AdsGeneratorHistoryEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const input = candidate.input as Record<string, unknown> | undefined;
  const result = candidate.result as Record<string, unknown> | undefined;
  const strategy = result?.strategy as Record<string, unknown> | undefined;
  const meta = result?.meta as Record<string, unknown> | undefined;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.createdAt === "string" &&
    Boolean(input) &&
    typeof input?.productName === "string" &&
    typeof input?.productDescription === "string" &&
    isStringArray(input?.keyBenefits) &&
    (typeof input?.brandName === "string" || typeof input?.brandName === "undefined") &&
    (typeof input?.categoryName === "string" || typeof input?.categoryName === "undefined") &&
    (typeof input?.price === "number" || typeof input?.price === "undefined") &&
    (typeof input?.currency === "string" || typeof input?.currency === "undefined") &&
    (typeof input?.landingPageUrl === "string" || typeof input?.landingPageUrl === "undefined") &&
    (input?.objective === "traffic" ||
      input?.objective === "sales" ||
      input?.objective === "leads" ||
      input?.objective === "engagement" ||
      typeof input?.objective === "undefined") &&
    (typeof input?.audienceSummary === "string" || typeof input?.audienceSummary === "undefined") &&
    (input?.tone === "direct" ||
      input?.tone === "persuasive" ||
      input?.tone === "premium" ||
      input?.tone === "friendly" ||
      typeof input?.tone === "undefined") &&
    (isStringArray(input?.painPoints) || typeof input?.painPoints === "undefined") &&
    (typeof input?.callToAction === "string" || typeof input?.callToAction === "undefined") &&
    isImageShape(input?.image) &&
    typeof result?.summary === "string" &&
    Boolean(strategy) &&
    typeof strategy?.angle === "string" &&
    typeof strategy?.audience === "string" &&
    isStringArray(strategy?.hooks) &&
    typeof strategy?.callToAction === "string" &&
    Boolean(meta) &&
    typeof meta?.campaignObjective === "string" &&
    typeof meta?.strategicSummary === "string" &&
    typeof meta?.recommendedSalesAngle === "string" &&
    typeof meta?.campaignStructure === "string" &&
    isStringArray(meta?.basicSegmentation) &&
    typeof meta?.recommendedFormat === "string" &&
    typeof meta?.primaryText === "string" &&
    typeof meta?.headline === "string" &&
    typeof meta?.description === "string" &&
    typeof meta?.callToAction === "string" &&
    typeof meta?.creativeIdea === "string" &&
    typeof meta?.budgetRecommendation === "string" &&
    typeof meta?.primaryMetric === "string" &&
    isStringArray(meta?.creativeNotes) &&
    isStringArray(meta?.publicationChecklist) &&
    Array.isArray(meta?.copyVariants) &&
    typeof meta?.readyToCopyText === "string"
  );
}

export async function getAdsGeneratorHistory(workspaceId: string): Promise<AdsGeneratorHistoryEntry[]> {
  const setting = await prisma.appSetting.findUnique({
    where: {
      key: getAdsGeneratorHistorySettingKey(workspaceId),
    },
    select: {
      value: true,
    },
  });

  if (!setting?.value) {
    return [];
  }

  try {
    const parsed = JSON.parse(setting.value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isHistoryEntry).slice(0, ADS_GENERATOR_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export async function saveAdsGeneratorHistoryEntry(
  workspaceId: string,
  entry: AdsGeneratorHistoryEntry,
): Promise<AdsGeneratorHistoryEntry[]> {
  const current = await getAdsGeneratorHistory(workspaceId);
  const next = [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, ADS_GENERATOR_HISTORY_LIMIT);

  await prisma.appSetting.upsert({
    where: {
      key: getAdsGeneratorHistorySettingKey(workspaceId),
    },
    update: {
      value: JSON.stringify(next),
    },
    create: {
      key: getAdsGeneratorHistorySettingKey(workspaceId),
      value: JSON.stringify(next),
    },
  });

  return next;
}

export async function deleteAdsGeneratorHistoryEntry(
  workspaceId: string,
  entryId: string,
): Promise<AdsGeneratorHistoryEntry[]> {
  const current = await getAdsGeneratorHistory(workspaceId);
  const next = current.filter((item) => item.id !== entryId);

  await prisma.appSetting.upsert({
    where: {
      key: getAdsGeneratorHistorySettingKey(workspaceId),
    },
    update: {
      value: JSON.stringify(next),
    },
    create: {
      key: getAdsGeneratorHistorySettingKey(workspaceId),
      value: JSON.stringify(next),
    },
  });

  return next;
}
