import { cache } from "react";
import { DEFAULT_SYSTEM_CURRENCY, isSupportedCurrency, type SupportedCurrencyCode } from "@/lib/currency";
import { prisma } from "@/lib/prisma";
import { siteConfig } from "@/lib/site";

const CURRENCY_SETTING_KEY = "currency";
const PRIMARY_COLOR_SETTING_KEY = "primaryColor";
const BRAND_NAME_SETTING_KEY = "brandName";
const DEFAULT_SYSTEM_PRIMARY_COLOR = "#6d28d9";

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

export const getSystemCurrency = cache(async (): Promise<SupportedCurrencyCode> => {
  try {
    await ensureAppSettingTable();

    const rows = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT "value"
      FROM "AppSetting"
      WHERE "key" = ${CURRENCY_SETTING_KEY}
      LIMIT 1
    `;

    const value = rows[0]?.value;
    if (value && isSupportedCurrency(value)) {
      return value;
    }

    return DEFAULT_SYSTEM_CURRENCY;
  } catch {
    return DEFAULT_SYSTEM_CURRENCY;
  }
});

export async function setSystemCurrency(currency: SupportedCurrencyCode): Promise<void> {
  await ensureAppSettingTable();
  await prisma.$executeRaw`
    INSERT INTO "AppSetting" ("key", "value", "createdAt", "updatedAt")
    VALUES (${CURRENCY_SETTING_KEY}, ${currency}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("key")
    DO UPDATE SET
      "value" = EXCLUDED."value",
      "updatedAt" = CURRENT_TIMESTAMP
  `;
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
  try {
    await ensureAppSettingTable();

    const rows = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT "value"
      FROM "AppSetting"
      WHERE "key" = ${PRIMARY_COLOR_SETTING_KEY}
      LIMIT 1
    `;

    return normalizeHexColor(rows[0]?.value) ?? DEFAULT_SYSTEM_PRIMARY_COLOR;
  } catch {
    return DEFAULT_SYSTEM_PRIMARY_COLOR;
  }
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

  await ensureAppSettingTable();
  await prisma.$executeRaw`
    INSERT INTO "AppSetting" ("key", "value", "createdAt", "updatedAt")
    VALUES (${PRIMARY_COLOR_SETTING_KEY}, ${normalized}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("key")
    DO UPDATE SET
      "value" = EXCLUDED."value",
      "updatedAt" = CURRENT_TIMESTAMP
  `;
}

export const getSystemBrandName = cache(async (): Promise<string> => {
  try {
    await ensureAppSettingTable();

    const rows = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT "value"
      FROM "AppSetting"
      WHERE "key" = ${BRAND_NAME_SETTING_KEY}
      LIMIT 1
    `;

    const value = rows[0]?.value?.trim();
    return value || siteConfig.name;
  } catch {
    return siteConfig.name;
  }
});

export async function setSystemBrandName(brandName: string): Promise<void> {
  const normalized = brandName.trim();
  if (!normalized) {
    throw new Error("Nombre de marca invalido");
  }

  await ensureAppSettingTable();
  await prisma.$executeRaw`
    INSERT INTO "AppSetting" ("key", "value", "createdAt", "updatedAt")
    VALUES (${BRAND_NAME_SETTING_KEY}, ${normalized}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("key")
    DO UPDATE SET
      "value" = EXCLUDED."value",
      "updatedAt" = CURRENT_TIMESTAMP
  `;
}
