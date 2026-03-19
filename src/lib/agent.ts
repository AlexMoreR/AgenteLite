import { prisma } from "@/lib/prisma";
import { slugifyWorkspaceSegment } from "@/lib/workspace";

export async function generateUniqueAgentSlug(workspaceId: string, name: string): Promise<string> {
  const baseSlug = slugifyWorkspaceSegment(name) || "agente";

  const existing = await prisma.agent.findMany({
    where: {
      workspaceId,
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
