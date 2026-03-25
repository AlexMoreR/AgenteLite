import { cache } from "react";
import { DEFAULT_SYSTEM_CURRENCY, isSupportedCurrency, type SupportedCurrencyCode } from "@/lib/currency";
import { prisma } from "@/lib/prisma";
import { siteConfig } from "@/lib/site";

const CURRENCY_SETTING_KEY = "currency";
const PRIMARY_COLOR_SETTING_KEY = "primaryColor";
const BRAND_NAME_SETTING_KEY = "brandName";
const EVOLUTION_API_BASE_URL_SETTING_KEY = "evolutionApiBaseUrl";
const EVOLUTION_API_TOKEN_SETTING_KEY = "evolutionApiToken";
const EVOLUTION_INSTANCE_PREFIX_SETTING_KEY = "evolutionInstancePrefix";
const EVOLUTION_WEBHOOK_BASE_URL_SETTING_KEY = "evolutionWebhookBaseUrl";
const EVOLUTION_WEBHOOK_SECRET_SETTING_KEY = "evolutionWebhookSecret";
const DEFAULT_SYSTEM_PRIMARY_COLOR = "#6d28d9";
const DEFAULT_EVOLUTION_INSTANCE_PREFIX = "agente-lite";

function normalizeUrlSetting(value: string | null | undefined) {
  return value?.trim().replace(/\/+$/, "") ?? "";
}

function buildEvolutionWebhookUrl(baseUrl: string) {
  const normalizedBaseUrl = normalizeUrlSetting(baseUrl);
  if (!normalizedBaseUrl) {
    return "";
  }

  return `${normalizedBaseUrl}/api/webhooks/evolution`;
}

function getEvolutionWebhookBaseUrlFromEnv() {
  const directWebhookUrl = normalizeUrlSetting(process.env.EVOLUTION_WEBHOOK_BASE_URL);
  if (directWebhookUrl) {
    return directWebhookUrl;
  }

  const backendBaseUrl =
    normalizeUrlSetting(process.env.BACKEND_ENV) ||
    normalizeUrlSetting(process.env.BACKEND_URL) ||
    normalizeUrlSetting(process.env.AUTH_URL) ||
    normalizeUrlSetting(process.env.NEXTAUTH_URL);

  return buildEvolutionWebhookUrl(backendBaseUrl);
}

function getEvolutionWebhookSecretFromEnv() {
  return process.env.EVOLUTION_WEBHOOK_SECRET?.trim() ?? "";
}

async function ensureAppSettingTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AppSetting" (
      "key" TEXT NOT NULL PRIMARY KEY,
      "value" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function getSettingValue(key: string): Promise<string | null> {
  try {
    await ensureAppSettingTable();

    const rows = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT "value"
      FROM "AppSetting"
      WHERE "key" = ${key}
      LIMIT 1
    `;

    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

async function setSettingValue(key: string, value: string): Promise<void> {
  await ensureAppSettingTable();
  await prisma.$executeRaw`
    INSERT INTO "AppSetting" ("key", "value", "createdAt", "updatedAt")
    VALUES (${key}, ${value}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("key")
    DO UPDATE SET
      "value" = EXCLUDED."value",
      "updatedAt" = CURRENT_TIMESTAMP
  `;
}

export const getSystemCurrency = cache(async (): Promise<SupportedCurrencyCode> => {
  const value = await getSettingValue(CURRENCY_SETTING_KEY);
  if (value && isSupportedCurrency(value)) {
    return value;
  }

  return DEFAULT_SYSTEM_CURRENCY;
});

export async function setSystemCurrency(currency: SupportedCurrencyCode): Promise<void> {
  await setSettingValue(CURRENCY_SETTING_KEY, currency);
}

function normalizeHexColor(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(trimmed)) {
    return trimmed;
  }

  const shortHex = trimmed.match(/^#([0-9a-f]{3})$/);
  if (!shortHex) {
    return null;
  }

  const [r, g, b] = shortHex[1].split("");
  return `#${r}${r}${g}${g}${b}${b}`;
}

function darkenHexColor(hex: string, amount = 0.14): string {
  const value = normalizeHexColor(hex) ?? DEFAULT_SYSTEM_PRIMARY_COLOR;
  const r = parseInt(value.slice(1, 3), 16);
  const g = parseInt(value.slice(3, 5), 16);
  const b = parseInt(value.slice(5, 7), 16);
  const factor = Math.max(0, Math.min(1, 1 - amount));

  const nextR = Math.round(r * factor);
  const nextG = Math.round(g * factor);
  const nextB = Math.round(b * factor);

  return `#${nextR.toString(16).padStart(2, "0")}${nextG.toString(16).padStart(2, "0")}${nextB
    .toString(16)
    .padStart(2, "0")}`;
}

export const getSystemPrimaryColor = cache(async (): Promise<string> => {
  const value = await getSettingValue(PRIMARY_COLOR_SETTING_KEY);
  return normalizeHexColor(value) ?? DEFAULT_SYSTEM_PRIMARY_COLOR;
});

export const getSystemPrimaryStrongColor = cache(async (): Promise<string> => {
  const primary = await getSystemPrimaryColor();
  return darkenHexColor(primary);
});

export async function setSystemPrimaryColor(color: string): Promise<void> {
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    throw new Error("Color primario invalido");
  }

  await setSettingValue(PRIMARY_COLOR_SETTING_KEY, normalized);
}

export const getSystemBrandName = cache(async (): Promise<string> => {
  const value = (await getSettingValue(BRAND_NAME_SETTING_KEY))?.trim();
  return value || siteConfig.name;
});

export async function setSystemBrandName(brandName: string): Promise<void> {
  const normalized = brandName.trim();
  if (!normalized) {
    throw new Error("Nombre de marca invalido");
  }

  await setSettingValue(BRAND_NAME_SETTING_KEY, normalized);
}

export type EvolutionSettings = {
  apiBaseUrl: string;
  apiToken: string;
  instancePrefix: string;
  webhookBaseUrl: string;
  webhookSecret: string;
};

export const getEvolutionSettings = cache(async (): Promise<EvolutionSettings> => {
  const [apiBaseUrl, apiToken, instancePrefix, webhookBaseUrl, webhookSecret] = await Promise.all([
    getSettingValue(EVOLUTION_API_BASE_URL_SETTING_KEY),
    getSettingValue(EVOLUTION_API_TOKEN_SETTING_KEY),
    getSettingValue(EVOLUTION_INSTANCE_PREFIX_SETTING_KEY),
    getSettingValue(EVOLUTION_WEBHOOK_BASE_URL_SETTING_KEY),
    getSettingValue(EVOLUTION_WEBHOOK_SECRET_SETTING_KEY),
  ]);

  return {
    apiBaseUrl: apiBaseUrl?.trim() ?? "",
    apiToken: apiToken?.trim() ?? "",
    instancePrefix: instancePrefix?.trim() || DEFAULT_EVOLUTION_INSTANCE_PREFIX,
    webhookBaseUrl: getEvolutionWebhookBaseUrlFromEnv() || normalizeUrlSetting(webhookBaseUrl),
    webhookSecret: getEvolutionWebhookSecretFromEnv() || webhookSecret?.trim() || "",
  };
});

export async function setEvolutionSettings(settings: EvolutionSettings): Promise<void> {
  const normalized = {
    apiBaseUrl: normalizeUrlSetting(settings.apiBaseUrl),
    apiToken: settings.apiToken.trim(),
    instancePrefix: settings.instancePrefix.trim().toLowerCase(),
    webhookBaseUrl: normalizeUrlSetting(settings.webhookBaseUrl),
    webhookSecret: settings.webhookSecret.trim(),
  };

  await Promise.all([
    setSettingValue(EVOLUTION_API_BASE_URL_SETTING_KEY, normalized.apiBaseUrl),
    setSettingValue(EVOLUTION_API_TOKEN_SETTING_KEY, normalized.apiToken),
    setSettingValue(EVOLUTION_INSTANCE_PREFIX_SETTING_KEY, normalized.instancePrefix),
    setSettingValue(EVOLUTION_WEBHOOK_BASE_URL_SETTING_KEY, normalized.webhookBaseUrl),
    setSettingValue(EVOLUTION_WEBHOOK_SECRET_SETTING_KEY, normalized.webhookSecret),
  ]);
}
