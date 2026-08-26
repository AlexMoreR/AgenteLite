"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

import { auth } from "@/auth";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

/**
 * Diagramas: mapas mentales para pensar el negocio.
 *
 * Son PRIVADOS de quien los creó. Todas las consultas filtran por autor además de por negocio: un
 * mapa mental a medio pensar no es un documento del equipo, y encontrarse el borrador de otro en
 * la lista es la forma más rápida de que nadie vuelva a escribir nada honesto ahí.
 */

async function contexto() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }
  await requireClientWorkspaceAccess("diagramas");
  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership) {
    return null;
  }
  return { userId: session.user.id, workspaceId: membership.workspace.id };
}

export async function crearDiagramaAction(
  titulo?: string,
): Promise<{ id?: string; error?: string }> {
  const ctx = await contexto();
  if (!ctx) {
    return { error: "No autorizado" };
  }

  const creado = await prisma.diagram.create({
    data: {
      workspaceId: ctx.workspaceId,
      createdById: ctx.userId,
      title: titulo?.trim().slice(0, 120) || "Sin título",
    },
    select: { id: true },
  });

  revalidatePath("/cliente/diagramas");
  return { id: creado.id };
}

/**
 * Guardar el lienzo.
 *
 * Se guarda ENTERO en cada pasada, no por diferencias: un mapa mental es chico (decenas de cajas)
 * y calcular qué cambió costaría más que reescribirlo. El límite de tamaño evita que un pegado
 * accidental de algo enorme quede atascado intentando guardarse para siempre.
 */
export async function guardarDiagramaAction(input: {
  id: string;
  titulo?: string;
  data?: unknown;
}): Promise<{ ok?: true; error?: string }> {
  const ctx = await contexto();
  if (!ctx) {
    return { error: "No autorizado" };
  }

  const propio = await prisma.diagram.findFirst({
    where: { id: input.id?.trim(), workspaceId: ctx.workspaceId, createdById: ctx.userId },
    select: { id: true },
  });
  if (!propio) {
    return { error: "Diagrama no encontrado" };
  }

  if (input.data !== undefined) {
    const peso = JSON.stringify(input.data ?? null).length;
    if (peso > 2_000_000) {
      return { error: "El diagrama es demasiado grande para guardarse." };
    }
  }

  await prisma.diagram.update({
    where: { id: propio.id },
    data: {
      ...(input.titulo === undefined ? {} : { title: input.titulo.trim().slice(0, 120) || "Sin título" }),
      ...(input.data === undefined ? {} : { data: input.data as Prisma.InputJsonValue }),
    },
  });

  revalidatePath("/cliente/diagramas");
  return { ok: true };
}

export async function borrarDiagramaAction(id: string): Promise<{ ok?: true; error?: string }> {
  const ctx = await contexto();
  if (!ctx) {
    return { error: "No autorizado" };
  }

  // Se borra buscando por AUTOR, no solo por id: un id prestado no puede borrar el mapa de otro.
  const propio = await prisma.diagram.findFirst({
    where: { id: id?.trim(), workspaceId: ctx.workspaceId, createdById: ctx.userId },
    select: { id: true },
  });
  if (!propio) {
    return { error: "Diagrama no encontrado" };
  }

  await prisma.diagram.delete({ where: { id: propio.id } });
  revalidatePath("/cliente/diagramas");
  return { ok: true };
}
