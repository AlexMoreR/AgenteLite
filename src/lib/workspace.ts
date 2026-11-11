import { cache } from "react";
import { prisma } from "@/lib/prisma";

export type PrimaryWorkspaceMembership = {
  role: "OWNER" | "ADMIN" | "AGENT" | "VIEWER";
  workspace: {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
    planTier: "GRATIS" | "BASICO" | "AVANZADO" | null;
    planStartedAt: Date | null;
    planExpiresAt: Date | null;
    createdAt: Date;
    ownerId: string | null;
  };
};

export function slugifyWorkspaceSegment(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export async function generateUniqueWorkspaceSlug(name: string): Promise<string> {
  const baseSlug = slugifyWorkspaceSegment(name) || "negocio";

  const existing = await prisma.workspace.findMany({
    where: {
      slug: {
        startsWith: baseSlug,
      },
    },
    select: { slug: true },
  });

  const usedSlugs = new Set(existing.map((item) => item.slug));
  if (!usedSlugs.has(baseSlug)) {
    return baseSlug;
  }

  let suffix = 2;
  let candidate = `${baseSlug}-${suffix}`;

  while (usedSlugs.has(candidate)) {
    suffix += 1;
    candidate = `${baseSlug}-${suffix}`;
  }

  return candidate;
}

export const getPrimaryWorkspaceForUser = cache(async (userId: string): Promise<PrimaryWorkspaceMembership | null> => {
  return prisma.workspaceMember.findFirst({
    where: { userId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
          isActive: true,
          planTier: true,
          planStartedAt: true,
          planExpiresAt: true,
          createdAt: true,
          ownerId: true,
          /*
            Sin _count (velocidad del chat, 10-nov-2026): contaba TODAS las conversaciones, agentes y
            canales del negocio en cada llamada -y esta funcion se llama en unos 150 lugares, varias
            veces al abrir un chat- y nadie leia esos numeros. Quien los necesite los pide aparte.
          */
        },
      },
    },
  });
});
