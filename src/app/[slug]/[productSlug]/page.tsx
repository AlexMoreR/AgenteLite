import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ProductDetailContent } from "@/components/store/product-detail-content";
import { prisma } from "@/lib/prisma";
import { buildProductPath } from "@/lib/product-slugs";
import { getSiteUrl, sanitizeDescription, siteConfig } from "@/lib/site";
import { getSystemCurrency } from "@/lib/system-settings";

type PageProps = {
  params: Promise<{ slug: string; productSlug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, productSlug } = await params;
  const product = await prisma.product.findUnique({
    where: { slug: productSlug },
    include: { category: true },
  });

  if (!product || product.category?.slug !== slug) {
    return {
      title: "Producto no encontrado",
      robots: { index: false, follow: false },
    };
  }

  const description = sanitizeDescription(
    product.description,
    `${product.name} ${product.category?.name ? `de ${product.category.name} ` : ""}disponible en ${siteConfig.name}, mobiliario profesional premium para salon y barberia.`,
  );
  const canonicalPath = buildProductPath(product);
  const canonical = getSiteUrl(canonicalPath);
  const imageUrl = product.thumbnailUrl.startsWith("http") ? product.thumbnailUrl : getSiteUrl(product.thumbnailUrl);

  return {
    title: product.name,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      type: "website",
      url: canonical,
      title: `${product.name} | ${siteConfig.name}`,
      description,
      images: [
        {
          url: imageUrl,
          alt: product.name,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${product.name} | ${siteConfig.name}`,
      description,
      images: [imageUrl],
    },
  };
}

export default async function CategoryProductPage({ params }: PageProps) {
  const { slug, productSlug } = await params;
  const [product, currency] = await Promise.all([
    prisma.product.findUnique({
      where: { slug: productSlug },
      include: {
        category: true,
        images: { orderBy: { order: "asc" } },
      },
    }),
    getSystemCurrency(),
  ]);

  if (!product) {
    notFound();
  }

  if (!product.category) {
    permanentRedirect(buildProductPath(product));
  }

  if (product.category.slug !== slug) {
    permanentRedirect(buildProductPath(product));
  }

  const relatedProducts = await prisma.product.findMany({
    where: {
      id: { not: product.id },
      ...(product.categoryId ? { categoryId: product.categoryId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 4,
    include: { category: true },
  });

  return <ProductDetailContent product={product} currency={currency} relatedProducts={relatedProducts} />;
}
