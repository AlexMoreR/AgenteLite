import { cache } from "react";
import { prisma } from "@/lib/prisma";

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

export const getPrimaryWorkspaceForUser = cache(async (userId: string) => {
  return prisma.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
          isActive: true,
          createdAt: true,
          ownerId: true,
          _count: {
            select: {
              agents: true,
              channels: true,
              conversations: true,
            },
          },
        },
      },
    },
  });
});
