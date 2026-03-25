"use server";

import { prisma } from "@/lib/prisma";
import { getWorkspacePlanState } from "@/lib/plans";

export async function enforceWorkspacePlanAccess(workspaceId: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      planExpiresAt: true,
    },
  });

  if (!workspace) {
    return {
      workspace: null,
      planState: getWorkspacePlanState(null),
      pausedAgents: 0,
    };
  }

  const planState = getWorkspacePlanState(workspace.planExpiresAt);
  let pausedAgents = 0;

  if (planState.blockClientArea) {
    const result = await prisma.agent.updateMany({
      where: {
        workspaceId,
        status: "ACTIVE",
      },
      data: {
        status: "PAUSED",
        isActive: false,
      },
    });

    pausedAgents = result.count;
  }

  return {
    workspace,
    planState,
    pausedAgents,
  };
}
