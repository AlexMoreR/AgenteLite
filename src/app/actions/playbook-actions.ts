"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";

export type PlaybookScriptItem = {
  id: string;
  kind: "STAGE" | "OBJECTION";
  stage: string | null;
  title: string;
  content: string;
  keywords: string | null;
  sortOrder: number;
  isActive: boolean;
};

const CRM_STAGE_VALUES = ["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION", "GANADO", "PERDIDO"] as const;

const saveScriptSchema = z.object({
  id: z.string().trim().optional(),
  kind: z.enum(["STAGE", "OBJECTION"]),
  stage: z.enum(CRM_STAGE_VALUES).nullish(),
  title: z.string().trim().min(2).max(120),
  content: z.string().trim().min(2).max(4000),
  keywords: z.string().trim().max(200).nullish(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

export type SavePlaybookScriptInput = z.infer<typeof saveScriptSchema>;

async function resolveWorkspaceId() {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return null;
  }
  await requireClientWorkspaceAccess("crm");
  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  return membership?.workspace.id ?? null;
}

/** Guiones del workspace. `onlyActive` para lo que se muestra en el chat. */
export async function listPlaybookScriptsAction(options?: { onlyActive?: boolean }): Promise<{ items: PlaybookScriptItem[] }> {
  const workspaceId = await resolveWorkspaceId();
  if (!workspaceId) {
    return { items: [] };
  }

  const rows = await prisma.playbookScript.findMany({
    where: { workspaceId, ...(options?.onlyActive ? { isActive: true } : {}) },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      kind: true,
      stage: true,
      title: true,
      content: true,
      keywords: true,
      sortOrder: true,
      isActive: true,
    },
  });

  return {
    items: rows.map((row) => ({
      ...row,
      kind: row.kind === "OBJECTION" ? ("OBJECTION" as const) : ("STAGE" as const),
    })),
  };
}

/** Crea o actualiza un guion (segun venga `id`). */
export async function savePlaybookScriptAction(
  input: SavePlaybookScriptInput,
): Promise<{ ok: true } | { error: string }> {
  const parsed = saveScriptSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Revisá el título y el texto del guion." };
  }

  const workspaceId = await resolveWorkspaceId();
  if (!workspaceId) {
    return { error: "No autorizado" };
  }

  // La etapa solo aplica a los guiones de etapa; en una objecion se limpia para que no quede
  // colgada de un embudo y aparezca donde no corresponde.
  const stage = parsed.data.kind === "STAGE" ? parsed.data.stage ?? null : null;
  if (parsed.data.kind === "STAGE" && !stage) {
    return { error: "Elegí la etapa del guion." };
  }

  const data = {
    kind: parsed.data.kind,
    stage,
    title: parsed.data.title,
    content: parsed.data.content,
    keywords: parsed.data.keywords?.trim() || null,
    sortOrder: parsed.data.sortOrder ?? 0,
  };

  if (parsed.data.id) {
    const updated = await prisma.playbookScript.updateMany({
      where: { id: parsed.data.id, workspaceId },
      data,
    });
    if (updated.count === 0) {
      return { error: "Guion no encontrado" };
    }
  } else {
    await prisma.playbookScript.create({ data: { ...data, workspaceId } });
  }

  revalidatePath("/cliente/crm/guiones");
  return { ok: true };
}

export async function deletePlaybookScriptAction(id: string): Promise<{ ok: true } | { error: string }> {
  const workspaceId = await resolveWorkspaceId();
  if (!workspaceId) {
    return { error: "No autorizado" };
  }

  const deleted = await prisma.playbookScript.deleteMany({ where: { id: id.trim(), workspaceId } });
  if (deleted.count === 0) {
    return { error: "Guion no encontrado" };
  }

  revalidatePath("/cliente/crm/guiones");
  return { ok: true };
}

/** Activa/desactiva sin borrar (para sacarlo del chat sin perder el texto). */
export async function togglePlaybookScriptAction(
  id: string,
  isActive: boolean,
): Promise<{ ok: true } | { error: string }> {
  const workspaceId = await resolveWorkspaceId();
  if (!workspaceId) {
    return { error: "No autorizado" };
  }

  const updated = await prisma.playbookScript.updateMany({
    where: { id: id.trim(), workspaceId },
    data: { isActive },
  });
  if (updated.count === 0) {
    return { error: "Guion no encontrado" };
  }

  revalidatePath("/cliente/crm/guiones");
  return { ok: true };
}
