import { prisma } from "@/lib/prisma";
import { getOfficialApiConfigByWorkspaceId, hasOfficialApiBaseCredentials } from "@/lib/official-api-config";
import { officialApiInitialDataModel, officialApiNextBuildSteps, officialApiPlannedRoutes } from "@/features/official-api/domain/official-api-structure";
import type { OfficialApiOverview } from "@/features/official-api/types/official-api";

export async function getOfficialApiOverview(workspaceId: string): Promise<OfficialApiOverview> {
  const [workspace, config] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        name: true,
      },
    }),
    getOfficialApiConfigByWorkspaceId(workspaceId),
  ]);

  const configuredFields = [
    config?.accessToken ? "access_token" : null,
    config?.phoneNumberId ? "phone_number_id" : null,
    config?.wabaId ? "waba_id" : null,
    config?.webhookVerifyToken ? "webhook_verify_token" : null,
    config?.appSecret ? "app_secret" : null,
  ].filter((value): value is string => Boolean(value));
  const hasBaseCredentials = hasOfficialApiBaseCredentials(config);

  return {
    workspaceId,
    workspaceName: workspace?.name ?? "Workspace",
    setupStatus: hasBaseCredentials ? "connected" : "pending",
    connectedLabel:
      hasBaseCredentials
        ? config?.status === "ERROR"
          ? "La API oficial tiene credenciales cargadas, pero el ultimo chequeo tecnico reporto incidencia. Puedes seguir gestionando el modulo mientras revisas la conexion."
          : "Cliente listo para trabajar con la configuracion oficial guardada"
        : "Base estructural lista. Falta completar o validar credenciales de WhatsApp Cloud API",
    configuredFields,
    plannedRoutes: officialApiPlannedRoutes,
    dataModel: officialApiInitialDataModel,
    nextBuildSteps: officialApiNextBuildSteps,
  };
}
