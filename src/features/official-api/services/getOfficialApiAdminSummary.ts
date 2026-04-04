import { prisma } from "@/lib/prisma";
import { getOfficialApiConfigByWorkspaceId } from "@/lib/official-api-config";
import type { OfficialApiAdminSummary } from "@/features/official-api/types/official-api";

export async function getOfficialApiAdminSummary(userId: string): Promise<OfficialApiAdminSummary> {
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      workspace: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  const config = membership?.workspace.id
    ? await getOfficialApiConfigByWorkspaceId(membership.workspace.id)
    : null;

  const configuredFields = [
    config?.accessToken ? "access_token" : null,
    config?.phoneNumberId ? "phone_number_id" : null,
    config?.wabaId ? "waba_id" : null,
    config?.webhookVerifyToken ? "webhook_verify_token" : null,
    config?.appSecret ? "app_secret" : null,
  ].filter((value): value is string => Boolean(value));

  return {
    workspaceId: membership?.workspace.id ?? null,
    workspaceName: membership?.workspace.name ?? null,
    setupStatus: config?.status === "CONNECTED" ? "connected" : "pending",
    hasWorkspace: Boolean(membership?.workspace.id),
    hasCredentials: Boolean(config?.accessToken && config.phoneNumberId && config.wabaId),
    configuredFields,
  };
}
