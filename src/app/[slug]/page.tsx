import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StorefrontCatalog, generateStorefrontMetadata } from "@/components/store/storefront-catalog";
import { prisma } from "@/lib/prisma";

type PageProps = {
  params: Promise<{ slug: string }>;
};

const reservedSlugs = new Set(["favicon.ico", "robots.txt", "sitemap.xml"]);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  if (reservedSlugs.has(slug)) {
    return {};
  }
  return generateStorefrontMetadata({ categorySlug: slug });
}

export default async function CategorySlugPage({ params }: PageProps) {
  const { slug } = await params;
  if (reservedSlugs.has(slug)) {
    notFound();
  }
  const category = await prisma.category.findUnique({
    where: { slug },
    select: { id: true },
  });

  if (!category) {
    notFound();
  }

  return <StorefrontCatalog categorySlug={slug} />;
}
