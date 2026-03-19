import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { permanentRedirect } from "next/navigation";
import { StorefrontCatalog, generateStorefrontMetadata } from "@/components/store/storefront-catalog";
import { prisma } from "@/lib/prisma";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return generateStorefrontMetadata({ categorySlug: slug });
}

export default async function CategoryPage({ params }: PageProps) {
  const { slug } = await params;
  const category = await prisma.category.findUnique({
    where: { slug },
    select: { slug: true },
  });

  if (!category) {
    notFound();
  }

  permanentRedirect(`/${category.slug}`);
}
