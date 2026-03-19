import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { buildProductPath, getProductIdFromRouteParam } from "@/lib/product-slugs";
import { getSiteUrl } from "@/lib/site";

type PageProps = {
  params: Promise<{ productId: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { productId } = await params;
  const resolvedProductId = getProductIdFromRouteParam(productId);
  const product =
    (await prisma.product.findUnique({
      where: { slug: productId },
      select: { id: true, slug: true, name: true, code: true, category: { select: { slug: true } } },
    })) ??
    (await prisma.product.findUnique({
      where: { id: resolvedProductId },
      select: { id: true, slug: true, name: true, code: true, category: { select: { slug: true } } },
    }));

  if (!product) {
    return {
      title: "Producto no encontrado",
      robots: { index: false, follow: false },
    };
  }

  return {
    alternates: {
      canonical: getSiteUrl(buildProductPath(product)),
    },
    robots: {
      index: false,
      follow: true,
    },
  };
}

export default async function LegacyProductRedirectPage({ params }: PageProps) {
  const { productId } = await params;
  const resolvedProductId = getProductIdFromRouteParam(productId);
  const product =
    (await prisma.product.findUnique({
      where: { slug: productId },
      select: { id: true, slug: true, name: true, code: true, category: { select: { slug: true } } },
    })) ??
    (await prisma.product.findUnique({
      where: { id: resolvedProductId },
      select: { id: true, slug: true, name: true, code: true, category: { select: { slug: true } } },
    }));

  if (!product) {
    notFound();
  }

  permanentRedirect(buildProductPath(product));
}
