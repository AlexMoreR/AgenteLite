import { cache } from "react";
import { getToneLabel, toneOptions } from "@/lib/agent-training";
import { getWorkspaceMarketingLogoUrl } from "@/lib/marketing-branding";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

type AgentTrainingConfigShape = {
  targetAudiences?: string[];
  salesTone?: string;
};

export type MarketingBusinessContext = {
  workspaceId: string;
  businessName: string;
  businessType: string | null;
  country: string | null;
  city: string | null;
  businessDescription: string | null;
  targetAudiences: string[];
  salesTone: string | null;
  logoUrl: string | null;
  valueProposition: string | null;
  idealCustomer: string | null;
  painPoints: string | null;
  mainOffer: string | null;
  primaryCallToAction: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  tiktokUrl: string | null;
  socialStatus: "pending" | "ready";
  websiteStatus: "pending" | "ready";
};

function getWorkspaceSettingKey(workspaceId: string, setting: string) {
  return `workspace:${workspaceId}:${setting}`;
}

const MARKETING_CONTEXT_SETTING_NAMES = [
  "businessType",
  "country",
  "city",
  "marketingBusinessNameOverride",
  "marketingValueProposition",
  "marketingIdealCustomer",
  "marketingPainPoints",
  "marketingMainOffer",
  "marketingPrimaryCta",
  "marketingWebsiteUrl",
  "marketingInstagramUrl",
  "marketingFacebookUrl",
  "marketingTiktokUrl",
] as const;

export function getMarketingContextSettingKey(
  workspaceId: string,
  setting: (typeof MARKETING_CONTEXT_SETTING_NAMES)[number],
) {
  return getWorkspaceSettingKey(workspaceId, setting);
}

export function getMarketingResetSettingKey(workspaceId: string) {
  return getWorkspaceSettingKey(workspaceId, "marketingResetState");
}

export function getMarketingContextCompletion(context: MarketingBusinessContext | null) {
  const checks = [
    Boolean(context?.businessName?.trim()),
    Boolean(context?.businessDescription?.trim()),
    Boolean(context?.targetAudiences?.length),
    Boolean(context?.valueProposition?.trim()),
    Boolean(context?.idealCustomer?.trim()),
    Boolean(context?.mainOffer?.trim()),
    Boolean(context?.primaryCallToAction?.trim()),
    context?.socialStatus === "ready",
    context?.websiteStatus === "ready",
  ];

  const completed = checks.filter(Boolean).length;
  return Math.round((completed / checks.length) * 100);
}

export function getMarketingRobotMood(completion: number) {
  if (completion >= 100) {
    return {
      lines: ["🤩"],
      tone: "ready" as const,
      label: "Listo",
    };
  }

  if (completion >= 80) {
    return {
      lines: ["😊"],
      tone: "ready" as const,
      label: "Casi listo",
    };
  }

  if (completion >= 45) {
    return {
      lines: ["🙂"],
      tone: "mid" as const,
      label: "En progreso",
    };
  }

  return {
    lines: ["😕"],
    tone: "pending" as const,
    label: "Incompleto",
  };
}

function asTrainingConfig(value: unknown): AgentTrainingConfigShape {
  if (!value || typeof value !== "object") {
    return {};
  }

  const candidate = value as AgentTrainingConfigShape;
  return {
    targetAudiences: Array.isArray(candidate.targetAudiences)
      ? candidate.targetAudiences.filter((item): item is string => typeof item === "string")
      : [],
    salesTone: typeof candidate.salesTone === "string" ? candidate.salesTone : undefined,
  };
}

function buildAudienceSignals(trainingAudiences: string[] | undefined, idealCustomer: string | null) {
  if (trainingAudiences && trainingAudiences.length > 0) {
    return trainingAudiences;
  }

  if (!idealCustomer?.trim()) {
    return [];
  }

  return idealCustomer
    .split(/,| y /i)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function resolveSalesToneLabel(value: string | null | undefined) {
  if (!value?.trim()) {
    return "Amigable y profesional";
  }

  if (toneOptions.some((item) => item.value === value)) {
    return getToneLabel(value as (typeof toneOptions)[number]["value"]);
  }

  return value;
}

export const getMarketingBusinessContextForUser = cache(
  async (userId: string): Promise<MarketingBusinessContext | null> => {
    const membership = await getPrimaryWorkspaceForUser(userId);
    if (!membership?.workspace.id) {
      return null;
    }

    const workspaceId = membership.workspace.id;

    const [settings, firstAgent, logoUrl] = await Promise.all([
      prisma.appSetting.findMany({
        where: {
          key: {
            in: [
              ...MARKETING_CONTEXT_SETTING_NAMES.map((setting) =>
                getMarketingContextSettingKey(workspaceId, setting),
              ),
              getMarketingResetSettingKey(workspaceId),
            ],
          },
        },
        select: {
          key: true,
          value: true,
        },
      }),
      prisma.agent.findFirst({
        where: {
          workspaceId,
        },
        orderBy: {
          createdAt: "asc",
        },
        select: {
          description: true,
          trainingConfig: true,
        },
      }),
      getWorkspaceMarketingLogoUrl(workspaceId),
    ]);

    const settingsMap = new Map(settings.map((item) => [item.key, item.value]));
    const training = asTrainingConfig(firstAgent?.trainingConfig);
    const isResetState = settingsMap.get(getMarketingResetSettingKey(workspaceId)) === "true";

    const mainOffer =
      settingsMap.get(getMarketingContextSettingKey(workspaceId, "marketingMainOffer")) ?? null;
    const businessNameOverride =
      settingsMap.get(getMarketingContextSettingKey(workspaceId, "marketingBusinessNameOverride")) ?? null;
    const idealCustomer =
      settingsMap.get(getMarketingContextSettingKey(workspaceId, "marketingIdealCustomer")) ?? null;
    const targetAudiences = isResetState
      ? []
      : buildAudienceSignals(training.targetAudiences ?? [], idealCustomer);

    return {
      workspaceId,
      businessName: businessNameOverride?.trim() || membership.workspace.name,
      businessType: settingsMap.get(getMarketingContextSettingKey(workspaceId, "businessType")) ?? null,
      country: settingsMap.get(getMarketingContextSettingKey(workspaceId, "country")) ?? null,
      city: settingsMap.get(getMarketingContextSettingKey(workspaceId, "city")) ?? null,
      businessDescription: isResetState ? mainOffer : firstAgent?.description?.trim() || mainOffer,
      targetAudiences,
      salesTone: isResetState ? null : resolveSalesToneLabel(training.salesTone),
      logoUrl,
      valueProposition:
        settingsMap.get(getMarketingContextSettingKey(workspaceId, "marketingValueProposition")) ?? null,
      idealCustomer,
      painPoints:
        settingsMap.get(getMarketingContextSettingKey(workspaceId, "marketingPainPoints")) ?? null,
      mainOffer,
      primaryCallToAction:
        settingsMap.get(getMarketingContextSettingKey(workspaceId, "marketingPrimaryCta")) ?? null,
      websiteUrl:
        settingsMap.get(getMarketingContextSettingKey(workspaceId, "marketingWebsiteUrl")) ?? null,
      instagramUrl:
        settingsMap.get(getMarketingContextSettingKey(workspaceId, "marketingInstagramUrl")) ?? null,
      facebookUrl:
        settingsMap.get(getMarketingContextSettingKey(workspaceId, "marketingFacebookUrl")) ?? null,
      tiktokUrl:
        settingsMap.get(getMarketingContextSettingKey(workspaceId, "marketingTiktokUrl")) ?? null,
      socialStatus:
        settingsMap.get(getMarketingContextSettingKey(workspaceId, "marketingInstagramUrl")) ||
        settingsMap.get(getMarketingContextSettingKey(workspaceId, "marketingFacebookUrl")) ||
        settingsMap.get(getMarketingContextSettingKey(workspaceId, "marketingTiktokUrl"))
          ? "ready"
          : "pending",
      websiteStatus: settingsMap.get(getMarketingContextSettingKey(workspaceId, "marketingWebsiteUrl"))
        ? "ready"
        : "pending",
    };
  },
);

