import { prisma } from "@/lib/prisma";

function getMarketingLogoSettingKey(workspaceId: string) {
  return `workspace:${workspaceId}:marketingLogoUrl`;
}

export async function getWorkspaceMarketingLogoUrl(workspaceId: string): Promise<string | null> {
  const setting = await prisma.appSetting.findUnique({
    where: {
      key: getMarketingLogoSettingKey(workspaceId),
    },
    select: {
      value: true,
    },
  });

  const value = setting?.value?.trim();
  return value || null;
}

export async function setWorkspaceMarketingLogoUrl(
  workspaceId: string,
  logoUrl: string,
): Promise<void> {
  await prisma.appSetting.upsert({
    where: {
      key: getMarketingLogoSettingKey(workspaceId),
    },
    update: {
      value: logoUrl,
    },
    create: {
      key: getMarketingLogoSettingKey(workspaceId),
      value: logoUrl,
    },
  });
}

export async function clearWorkspaceMarketingLogoUrl(workspaceId: string): Promise<void> {
  await prisma.appSetting.deleteMany({
    where: {
      key: getMarketingLogoSettingKey(workspaceId),
    },
  });
}
