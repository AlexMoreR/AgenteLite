"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { isPlaybookRuleKind, type PlaybookRuleKind } from "@/lib/product-playbook";

/**
 * Guardar el playbook de ventas de un producto.
 *
 * Cada regla se guarda por separado (y no como un texto largo) para poder saber CUANDO se agrego
 * y de donde salio. Eso es lo que despues permite mirar una venta perdida y dejar la leccion
 * escrita con fecha, en vez de contarla en una reunion y que se pierda.
 */

async function getAccess() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }
  await requireClientWorkspaceAccess("products_v2");
  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  return membership?.workspace.id ?? null;
}

async function ensurePlaybook(workspaceId: string, productId: string) {
  const existente = await prisma.productPlaybook.findUnique({
    where: { workspaceId_productId: { workspaceId, productId } },
    select: { id: true },
  });
  if (existente) {
    return existente.id;
  }
  const creado = await prisma.productPlaybook.create({
    data: { workspaceId, productId },
    select: { id: true },
  });
  return creado.id;
}

export async function saveProductPitchAction(input: {
  productId: string;
  pitch: string;
  idealCustomer?: string;
  customerPain?: string;
}): Promise<{ ok?: true; error?: string }> {
  const workspaceId = await getAccess();
  if (!workspaceId) {
    return { error: "No autorizado" };
  }

  const productId = input.productId?.trim();
  if (!productId) {
    return { error: "Datos invalidos" };
  }

  const producto = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!producto) {
    return { error: "Producto no encontrado" };
  }

  const playbookId = await ensurePlaybook(workspaceId, productId);
  await prisma.productPlaybook.update({
    where: { id: playbookId },
    data: {
      pitch: input.pitch.trim() || null,
      ...(input.idealCustomer === undefined
        ? {}
        : { idealCustomer: input.idealCustomer.trim() || null }),
      ...(input.customerPain === undefined
        ? {}
        : { customerPain: input.customerPain.trim() || null }),
    },
  });

  revalidatePath("/cliente/productos-v2");
  return { ok: true };
}

export async function addProductPlaybookRuleAction(input: {
  productId: string;
  kind: string;
  trigger?: string;
  text: string;
  source?: string;
  originConversationId?: string;
}): Promise<{ ok?: true; error?: string; ruleId?: string }> {
  const workspaceId = await getAccess();
  if (!workspaceId) {
    return { error: "No autorizado" };
  }

  const productId = input.productId?.trim();
  const text = input.text?.trim();
  if (!productId || !text) {
    return { error: "Escribe la regla" };
  }
  if (!isPlaybookRuleKind(input.kind)) {
    return { error: "Tipo de regla invalido" };
  }
  const kind: PlaybookRuleKind = input.kind;
  const trigger = input.trigger?.trim() || "";
  if (kind === "OBJECION" && !trigger) {
    return { error: "Escribe que dice el cliente" };
  }
  if (kind === "BENEFICIO" && !trigger) {
    return { error: "Escribe la caracteristica" };
  }

  const producto = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!producto) {
    return { error: "Producto no encontrado" };
  }

  const playbookId = await ensurePlaybook(workspaceId, productId);
  const ultimo = await prisma.productPlaybookRule.findFirst({
    where: { playbookId, kind },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const regla = await prisma.productPlaybookRule.create({
    data: {
      playbookId,
      kind,
      trigger: kind === "OBJECION" || kind === "BENEFICIO" ? trigger : null,
      text,
      sortOrder: (ultimo?.sortOrder ?? 0) + 1,
      source: input.source?.trim() || "manual",
      originConversationId: input.originConversationId?.trim() || null,
    },
    select: { id: true },
  });

  revalidatePath("/cliente/productos-v2");
  return { ok: true, ruleId: regla.id };
}

export async function deleteProductPlaybookRuleAction(input: {
  ruleId: string;
}): Promise<{ ok?: true; error?: string }> {
  const workspaceId = await getAccess();
  if (!workspaceId) {
    return { error: "No autorizado" };
  }

  const ruleId = input.ruleId?.trim();
  if (!ruleId) {
    return { error: "Datos invalidos" };
  }

  // La regla se busca POR SU WORKSPACE: sin esto, un id prestado borraria una regla de otro
  // negocio.
  const regla = await prisma.productPlaybookRule.findFirst({
    where: { id: ruleId, playbook: { workspaceId } },
    select: { id: true },
  });
  if (!regla) {
    return { error: "Regla no encontrada" };
  }

  await prisma.productPlaybookRule.delete({ where: { id: regla.id } });

  revalidatePath("/cliente/productos-v2");
  return { ok: true };
}
