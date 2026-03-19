import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { buildProductPath } from "@/lib/product-slugs";
import { getSiteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        code: true,
        updatedAt: true,
      },
    }),
    prisma.category.findMany({
      where: { isActive: true },
      select: {
        id: true,
        slug: true,
        updatedAt: true,
      },
    }),
  ]);

  return [
    {
      url: getSiteUrl("/"),
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    ...products.map((product) => ({
      url: getSiteUrl(buildProductPath(product)),
      lastModified: product.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...categories.map((category) => ({
      url: getSiteUrl(`/${category.slug}`),
      lastModified: category.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
