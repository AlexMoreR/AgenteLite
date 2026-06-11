"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export type AgentV2BusinessInput = {
  name: string;
  sector: string;
  location: string;
  website: string;
  phone: string;
  email: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  youtube: string;
};

export async function saveAgentV2BusinessConfigAction(
  input: AgentV2BusinessInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("agents_v2");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { ok: false, error: "Debes configurar tu negocio primero" };
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: membership.workspace.id },
    select: { name: true, businessConfig: true },
  });

  const currentConfig =
    workspace?.businessConfig && typeof workspace.businessConfig === "object"
      ? (workspace.businessConfig as Record<string, unknown>)
      : {};
  const businessDescription =
    typeof currentConfig.businessDescription === "string" ? currentConfig.businessDescription : "";

  const nextName = input.name.trim() || workspace?.name || membership.workspace.name;

  await prisma.workspace.update({
    where: { id: membership.workspace.id },
    data: {
      name: nextName,
      businessConfig: {
        businessDescription,
        sectorRubro: input.sector,
        location: input.location,
        website: input.website,
        contactPhone: input.phone,
        contactEmail: input.email,
        instagram: input.instagram,
        facebook: input.facebook,
        tiktok: input.tiktok,
        youtube: input.youtube,
      },
    },
  });

  revalidatePath("/cliente/agente-v2");
  revalidatePath("/cliente");

  return { ok: true };
}
