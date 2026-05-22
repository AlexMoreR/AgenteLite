"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import type { CrmStage } from "@/features/crm/types";

const updateCrmStageSchema = z.object({
  contactId: z.string().trim().min(1),
  status: z.enum(["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION", "GANADO", "PERDIDO"]),
});

const updateCrmCollapsedSchema = z.object({
  contactId: z.string().trim().min(1),
  collapsed: z.boolean(),
});

export async function updateCrmStageAction(input: { contactId: string; status: CrmStage }) {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }

  const parsed = updateCrmStageSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Datos invalidos" };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { error: "Workspace no encontrado" };
  }

  const contact = await prisma.contact.findFirst({
    where: {
      id: parsed.data.contactId,
      workspaceId: membership.workspace.id,
    },
    select: {
      id: true,
    },
  });

  if (!contact) {
    return { error: "Contacto no encontrado" };
  }

  await prisma.$executeRaw`
    UPDATE "Contact"
    SET "crmStage" = ${parsed.data.status},
        "updatedAt" = NOW()
    WHERE "id" = ${contact.id}
  `;

  revalidatePath("/cliente/crm");
  revalidatePath("/cliente/contactos");
  revalidatePath("/cliente/chats");

  return { success: true, contactId: contact.id, status: parsed.data.status };
}

export async function updateCrmCollapsedAction(input: { contactId: string; collapsed: boolean }) {
  const session = await auth();

  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE"].includes(session.user.role)) {
    return { error: "No autorizado" };
  }

  const parsed = updateCrmCollapsedSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Datos invalidos" };
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return { error: "Workspace no encontrado" };
  }

  const contact = await prisma.contact.findFirst({
    where: {
      id: parsed.data.contactId,
      workspaceId: membership.workspace.id,
    },
    select: {
      id: true,
    },
  });

  if (!contact) {
    return { error: "Contacto no encontrado" };
  }

  await prisma.$executeRaw`
    UPDATE "Contact"
    SET "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object('crmKanbanCollapsed', CAST(${parsed.data.collapsed} AS boolean)),
        "updatedAt" = NOW()
    WHERE "id" = ${contact.id}
  `;

  revalidatePath("/cliente/crm");
  revalidatePath("/cliente/contactos");
  revalidatePath("/cliente/chats");

  return { success: true, contactId: contact.id, collapsed: parsed.data.collapsed };
}
