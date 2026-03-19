import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { generateStorefrontMetadata, StorefrontCatalog } from "@/components/store/storefront-catalog";
import { prisma } from "@/lib/prisma";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  return generateStorefrontMetadata({ query });
}

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const legacyCategoryId = typeof params.category === "string" ? params.category.trim() : "";

  if (legacyCategoryId) {
    const category = await prisma.category.findUnique({
      where: { id: legacyCategoryId },
      select: { slug: true },
    });

    if (category) {
      redirect(`/${category.slug}`);
    }
  }

  return <StorefrontCatalog query={query} />;
}
