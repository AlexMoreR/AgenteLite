import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle, Shield, ShoppingCart, Star, Truck } from "lucide-react";
import { FeaturedProductsCarousel } from "@/components/store/featured-products-carousel";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/currency";
import { prisma } from "@/lib/prisma";
import { buildProductPath } from "@/lib/product-slugs";
import { buildWhatsAppProductHref, getSiteUrl, sanitizeDescription, siteConfig } from "@/lib/site";
import { getSystemBrandName, getSystemCurrency } from "@/lib/system-settings";

type StorefrontCatalogProps = {
  query?: string;
  categorySlug?: string;
};

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M19.05 4.94A9.9 9.9 0 0 0 12.02 2C6.53 2 2.05 6.47 2.05 11.96c0 1.76.46 3.49 1.34 5.01L2 22l5.17-1.36a9.93 9.93 0 0 0 4.84 1.24h.01c5.49 0 9.96-4.47 9.96-9.96a9.9 9.9 0 0 0-2.93-6.98Zm-7.03 15.25h-.01a8.3 8.3 0 0 1-4.23-1.16l-.3-.18-3.07.81.82-2.99-.2-.31a8.25 8.25 0 0 1-1.28-4.4c0-4.55 3.71-8.26 8.27-8.26 2.2 0 4.27.86 5.83 2.42a8.2 8.2 0 0 1 2.42 5.84c0 4.55-3.71 8.26-8.25 8.26Zm4.53-6.18c-.25-.12-1.48-.73-1.71-.81-.23-.09-.39-.12-.56.12-.17.24-.64.81-.79.98-.15.17-.29.19-.54.06-.25-.12-1.05-.39-2-1.24-.74-.66-1.24-1.47-1.39-1.72-.15-.24-.02-.37.11-.49.11-.11.25-.29.37-.43.12-.15.17-.25.25-.42.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.76-1.85-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.23.24-.87.85-.87 2.07s.89 2.41 1.02 2.57c.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.53.59.19 1.12.16 1.54.1.47-.07 1.48-.6 1.69-1.18.21-.58.21-1.08.15-1.18-.06-.1-.23-.16-.48-.29Z" />
    </svg>
  );
}

const naturalCodeCollator = new Intl.Collator("es", {
  numeric: true,
  sensitivity: "base",
});

function compareProductsByNaturalCode(
  a: { code: string | null; name: string },
  b: { code: string | null; name: string },
) {
  const leftCode = a.code?.trim() ?? "";
  const rightCode = b.code?.trim() ?? "";

  if (leftCode && rightCode) {
    const codeComparison = naturalCodeCollator.compare(leftCode, rightCode);
    if (codeComparison !== 0) {
      return codeComparison;
    }
  }

  if (leftCode && !rightCode) {
    return -1;
  }

  if (!leftCode && rightCode) {
    return 1;
  }

  return naturalCodeCollator.compare(a.name, b.name);
}

function formatCatalogPrice(value: number | string, currency: Parameters<typeof formatMoney>[1]) {
  return formatMoney(value, currency).replace(/([.,]00)(?!\d)/, "");
}

export async function generateStorefrontMetadata({
  query = "",
  categorySlug,
}: StorefrontCatalogProps): Promise<Metadata> {
  const brandName = await getSystemBrandName();
  const normalizedQuery = query.trim();
  const normalizedCategorySlug = categorySlug?.trim() ?? "";
  const category = normalizedCategorySlug
    ? await prisma.category.findUnique({
        where: { slug: normalizedCategorySlug },
        select: {
          name: true,
          slug: true,
          logoUrl: true,
          products: {
            take: 1,
            orderBy: { createdAt: "desc" },
            select: {
              thumbnailUrl: true,
            },
          },
        },
      })
    : null;

  const title = normalizedQuery
    ? `Resultados para ${normalizedQuery}`
    : category
      ? category.name
      : {
          absolute: `${brandName} | Mobiliario profesional para peluqueria, barberia y salon de belleza`,
        };
  const description = normalizedQuery
    ? `Explora en ${brandName} resultados para ${normalizedQuery} en sillas, estaciones y mobiliario profesional para salon y barberia.`
    : category
      ? `Explora ${category.name.toLowerCase()} en ${brandName}, mobiliario profesional para peluqueria, salon de belleza y barberia.`
      : `${brandName} ofrece sillas barberas e hidraulicas, camillas, tocadores, salas de espera y mobiliario profesional para peluqueria, barberia y salon de belleza, con envio a toda Colombia.`;
  const canonical = normalizedQuery
    ? getSiteUrl(
        `/?${new URLSearchParams({
          q: normalizedQuery,
        }).toString()}`,
      )
    : category
      ? getSiteUrl(`/${category.slug}`)
      : getSiteUrl("/");
  const socialTitle =
    normalizedQuery || category
      ? `${typeof title === "string" ? title : brandName} | ${brandName}`
      : `${brandName} | Mobiliario profesional para peluqueria, barberia y salon de belleza`;
  const socialImagePath =
    category?.logoUrl?.trim() || category?.products[0]?.thumbnailUrl?.trim() || siteConfig.ogImagePath;
  const socialImage = socialImagePath.startsWith("http") ? socialImagePath : getSiteUrl(socialImagePath);
  const socialImageAlt = category ? `${category.name} | ${brandName}` : brandName;

  return {
    title,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title: socialTitle,
      description,
      url: canonical,
      images: [
        {
          url: socialImage,
          alt: socialImageAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [socialImage],
    },
  };
}

export async function StorefrontCatalog({ query = "", categorySlug }: StorefrontCatalogProps) {
  const normalizedQuery = query.trim();
  const normalizedCategorySlug = categorySlug?.trim() ?? "";
  const [category, categoryNavItems, systemCurrency, totalProducts, totalCategories, brandName] = await Promise.all([
    normalizedCategorySlug
      ? prisma.category.findUnique({
          where: { slug: normalizedCategorySlug },
          select: {
            id: true,
            name: true,
            slug: true,
          },
        })
      : Promise.resolve(null),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        products: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: {
            thumbnailUrl: true,
          },
        },
      },
    }),
    getSystemCurrency(),
    prisma.product.count(),
    prisma.category.count({ where: { isActive: true } }),
    getSystemBrandName(),
  ]);

  const productsResult = await prisma.product.findMany({
    where: {
      ...(normalizedQuery
        ? {
            OR: [
              { name: { contains: normalizedQuery, mode: "insensitive" as const } },
              { code: { contains: normalizedQuery, mode: "insensitive" as const } },
              { description: { contains: normalizedQuery, mode: "insensitive" as const } },
              { category: { is: { name: { contains: normalizedQuery, mode: "insensitive" as const } } } },
            ],
          }
        : {}),
      ...(category ? { categoryId: category.id } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      category: true,
      images: {
        orderBy: { order: "asc" },
      },
    },
  });

  const products =
    category && !normalizedQuery
      ? [...productsResult].sort((left, right) => compareProductsByNaturalCode(left, right))
      : productsResult;

  const featuredProducts = products.slice(0, 5).map((product) => ({
    id: product.id,
    href: buildProductPath(product),
    name: product.name,
    thumbnailUrl: product.thumbnailUrl,
    priceLabel: formatCatalogPrice(String(product.price), systemCurrency),
  }));

  const promoItems = [
    "Combos especiales de temporada",
    "Envio gratis en productos seleccionados",
    "Te ayudamos por WhatsApp a elegir tu mobiliario",
    "Descuentos por compras al por mayor",
    "Instalacion y asesoria para tu salon",
  ];

  const categoriesCarousel = categoryNavItems.map((item) => ({
    id: item.id,
    name: item.name,
    slug: item.slug,
    cover: item.logoUrl || item.products[0]?.thumbnailUrl || "/file.svg",
  }));

  const pageHeading = category
    ? category.name
    : "Equipa tu peluqueria, barberia o salon de belleza";
  const pageIntro = category
    ? `Explora ${category.name.toLowerCase()} en ${brandName}, con referencias para peluqueria, salon de belleza y barberia.`
    : "Sillas, camillas, tocadores y mobiliario profesional con garantia y envio a toda Colombia.";
  const collectionDescription = category
    ? `${category.name} para negocios que buscan imagen, funcionalidad y experiencia premium en cada servicio.`
    : "Catalogo de sillas, estaciones y mobiliario profesional premium para salon de belleza, barberia y espacios de alto nivel.";
  const baseUrl = category ? `/${category.slug}` : "/";

  const storefrontSchema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${getSiteUrl("/")}#organization`,
        name: brandName,
        legalName: brandName,
        url: getSiteUrl("/"),
        logo: getSiteUrl(siteConfig.logoPath),
        description: `${brandName} ofrece mobiliario profesional para peluqueria, barberia y salon de belleza.`,
        telephone: siteConfig.phoneDisplay,
      },
      {
        "@type": "CollectionPage",
        "@id": `${getSiteUrl(baseUrl)}#catalog`,
        url: getSiteUrl(baseUrl),
        name: category ? `${category.name} | ${brandName}` : `Catalogo de ${brandName}`,
        description: collectionDescription,
      },
    ],
  };

  return (
    <section className="app-page space-y-4">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(storefrontSchema) }}
      />

      {!normalizedQuery ? (
        <div className="relative left-1/2 right-1/2 -mx-[50vw] w-screen">
          <Card className="relative overflow-hidden rounded-none border-0 p-0 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.65)]">
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, var(--primary-strong) 0%, var(--primary) 55%, var(--primary-strong) 100%)",
              }}
            />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.2),transparent_30%),radial-gradient(circle_at_75%_18%,rgba(255,255,255,0.12),transparent_18%),linear-gradient(180deg,transparent,rgba(20,5,44,0.18))]" />
            <div className="mx-auto max-w-6xl px-4 md:px-6">
              <div className="relative py-3 text-white md:py-4">
                <div className="grid items-center gap-2.5 md:grid-cols-[minmax(0,1.02fr)_minmax(300px,0.98fr)] md:gap-6">
                  <div className="space-y-2.5 text-center md:space-y-4 md:text-left">
                    <h1 className="mx-auto w-full max-w-none text-[1.18rem] font-semibold leading-[0.98] tracking-tight md:mx-0 md:max-w-xl md:text-[3rem] md:leading-[0.94]">
                      {pageHeading}
                    </h1>
                    <p className="mx-auto w-full max-w-none text-[13px] leading-[1.45] text-white/80 md:mx-0 md:max-w-lg md:text-base md:leading-6">
                      {pageIntro}
                    </p>
                    {!category ? (
                      <div className="hidden flex-wrap items-center gap-2 pt-0.5 text-xs text-slate-200 md:flex">
                      <Link
                        href={siteConfig.whatsappHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-9 items-center gap-2 rounded-full border border-white/14 bg-black/18 px-3.5 text-[13px] font-semibold text-white backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:border-white/22 hover:bg-black/24 active:translate-y-0 md:h-10 md:px-4.5"
                      >
                        <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-white/10 md:h-5 md:w-5">
                          <MessageCircle className="h-3.5 w-3.5" />
                        </span>
                        Cotizar ahora
                      </Link>
                      <Link
                        href="#catalogo"
                        className="inline-flex h-9 items-center gap-2 rounded-full border border-white/12 bg-[linear-gradient(135deg,rgba(255,255,255,0.16),rgba(255,255,255,0.06))] px-3.5 text-[13px] font-semibold text-white/92 backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-[linear-gradient(135deg,rgba(255,255,255,0.2),rgba(255,255,255,0.08))] active:translate-y-0 md:h-10 md:px-4.5"
                      >
                        <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full border border-white/12 bg-white/8 md:h-5 md:w-5">
                          <ShoppingCart className="h-3.5 w-3.5" />
                        </span>
                        Ver catalogo
                      </Link>
                      </div>
                    ) : null}
                  </div>

                  {!category ? (
                    <div className="grid min-w-0 gap-2 md:gap-2.5">
                    <FeaturedProductsCarousel products={featuredProducts} />
                    <div className="flex flex-wrap items-center justify-center gap-2.5 pt-0.5 text-xs text-slate-200 md:hidden">
                      <Link
                        href={siteConfig.whatsappHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-9 items-center gap-2 rounded-full border border-white/12 bg-black/14 px-3.5 text-[13px] font-semibold text-white/95 backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:border-white/18 hover:bg-black/22 active:translate-y-0"
                      >
                        <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-white/10">
                          <MessageCircle className="h-3.5 w-3.5" />
                        </span>
                        Cotizar ahora
                      </Link>
                      <Link
                        href="#catalogo"
                        className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.14),rgba(255,255,255,0.05))] px-3.5 text-[13px] font-semibold text-white/92 backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:border-white/18 hover:bg-[linear-gradient(135deg,rgba(255,255,255,0.18),rgba(255,255,255,0.07))] active:translate-y-0"
                      >
                        <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full border border-white/12 bg-white/8">
                          <ShoppingCart className="h-3.5 w-3.5" />
                        </span>
                        Ver catalogo
                      </Link>
                    </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {!normalizedQuery ? (
        <div className="relative left-1/2 right-1/2 -mx-[50vw] w-screen">
          <div
            className="overflow-hidden rounded-none border-0"
            style={{
              backgroundImage:
                "linear-gradient(90deg, var(--primary-strong) 0%, var(--primary) 50%, var(--primary-strong) 100%)",
            }}
          >
            <div className="promo-marquee-track">
              {[...promoItems, ...promoItems].map((item, index) => (
                <div
                  key={`${item}-${index}`}
                  className="inline-flex h-9 items-center gap-2 border-r border-white/20 px-3 text-[11px] font-semibold text-white md:h-10 md:px-4 md:text-xs"
                >
                  <span className="text-amber-300">*</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {!category ? (
        <div className="space-y-2">
        <div className="flex items-center justify-center gap-2 px-0.5 text-center">
          <span className="text-sm md:text-base">
            📱
          </span>
          <h2 className="text-sm font-normal tracking-tight text-slate-900 md:text-lg">
            Busca tu <strong className="font-semibold">categoria</strong>
          </h2>
        </div>
          <div className="flex snap-x gap-2.5 overflow-x-auto pb-0.5">
            {categoriesCarousel.map((item) => (
              <Link
                key={item.id}
                href={`/${item.slug}`}
                className="group block w-24 shrink-0 snap-start transition hover:-translate-y-0.5 sm:w-28"
              >
                <div className="aspect-square overflow-hidden rounded-xl">
                  <img
                    src={item.cover}
                    alt={item.name}
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                  />
                </div>
                <p className="mt-1.5 break-words text-center text-[11px] font-semibold leading-tight text-slate-900 sm:text-xs">
                  {item.name}
                </p>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {!normalizedQuery && !category ? (
        <div className="relative left-1/2 right-1/2 -mx-[50vw] w-screen bg-slate-50 py-6">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <div className="grid grid-cols-3 gap-4 text-center md:grid-cols-3">
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary)]/10">
                  <Star className="h-5 w-5 text-[var(--primary-strong)]" />
                </div>
                <p className="text-lg font-bold text-slate-900">500+</p>
                <p className="text-xs text-slate-500">Salones equipados</p>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary)]/10">
                  <Truck className="h-5 w-5 text-[var(--primary-strong)]" />
                </div>
                <p className="text-lg font-bold text-slate-900">Todo Colombia</p>
                <p className="text-xs text-slate-500">Envio a tu ciudad</p>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary)]/10">
                  <Shield className="h-5 w-5 text-[var(--primary-strong)]" />
                </div>
                <p className="text-lg font-bold text-slate-900">Garantia</p>
                <p className="text-xs text-slate-500">Respaldo postventa</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {products.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">No hay productos publicados todavia.</p>
        </Card>
      ) : (
        <div className="space-y-3" id="catalogo">
          {!normalizedQuery && !category ? (
            <div className="rounded-2xl border border-[var(--line)] bg-white px-4 py-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--primary-strong)]">
                Mobiliario profesional premium
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 md:text-2xl">
                Mobiliario profesional para peluqueria, barberia y salon de belleza
              </h2>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
                {`En ${brandName} encuentras sillas, estaciones y mobiliario profesional para equipar tu negocio con imagen, funcionalidad y respaldo.`}
              </p>
            </div>
          ) : null}

          {!category ? (
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">Catalogo de tienda</h2>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((product) => {
              const retailPrice = Number(product.price);
              const comparePrice = retailPrice * 1.25;
              const productHref = buildProductPath(product);
              const whatsAppHref = buildWhatsAppProductHref(product.name);
              const productSummary = sanitizeDescription(
                product.description,
                `${product.name} en ${product.category?.name ?? "mobiliario profesional"} disponible en ${brandName}.`,
              );

              return (
                <Card
                  key={product.id}
                  className="flex h-full flex-col overflow-hidden rounded-xl p-0 transition duration-300 hover:translate-y-[-3px] hover:shadow-[0_22px_40px_-30px_rgba(15,23,42,0.55)]"
                >
                  <Link href={productHref} className="group flex flex-1 flex-col">
                    <div className="relative">
                      <img
                        src={product.thumbnailUrl}
                        alt={product.name}
                        className="h-40 w-full bg-white object-contain p-2 transition duration-500 group-hover:scale-[1.02] md:h-52"
                        loading="lazy"
                      />
                      <div className="absolute -bottom-1 left-2.5 z-10 rounded-md border border-[color-mix(in_srgb,var(--primary)_24%,white)] bg-[linear-gradient(135deg,var(--primary)_0%,var(--primary-strong)_100%)] px-1.5 py-1 text-white shadow-[0_12px_20px_-14px_color-mix(in_srgb,var(--primary)_70%,black)]">
                        <span className="flex items-center gap-1 text-[7px] font-black uppercase leading-none tracking-[0.08em]">
                          <Truck className="h-2.5 w-2.5" />
                          Envio
                        </span>
                        <span className="mt-0.5 block text-[9px] font-black uppercase leading-none tracking-[0.08em]">
                          Gratis
                        </span>
                      </div>
                      <span className="absolute right-2 top-2 rounded-full border border-white/20 bg-slate-900/85 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                        {product.code?.trim() || "SKU"}
                      </span>
                    </div>

                    <div className="flex flex-1 flex-col space-y-1.5 px-3 pb-1 pt-2.5">
                      <p className="line-clamp-1 text-xs font-medium text-slate-500">
                        {product.category?.name ?? "Sin categoria"}
                      </p>
                      <h3 className="min-h-[2rem] text-[13px] font-semibold leading-4 normal-case tracking-normal text-slate-900">
                        {product.name}
                      </h3>
                      <div className="flex items-start justify-between gap-2 pt-0">
                        <div className="space-y-0.5">
                          <p className="text-xl font-bold tracking-tight text-slate-950">
                            {formatCatalogPrice(String(retailPrice), systemCurrency)}
                          </p>
                          <p className="flex items-center gap-1 text-[12px] font-medium text-slate-500">
                            <span className="line-through text-slate-400">
                              {formatCatalogPrice(String(comparePrice), systemCurrency)}
                            </span>
                            <span className="line-through">Antes</span>
                          </p>
                        </div>
                        <p className="text-right text-[9px] font-semibold leading-3 text-slate-400">
                          Cualquier
                          <br />
                          medio
                        </p>
                      </div>
                    </div>
                  </Link>

                  <div className="grid grid-cols-1 gap-1.5 px-3 pb-3 pt-0.5">
                    <Link
                      href={whatsAppHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 text-center text-xs font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-emerald-700 active:translate-y-0 active:scale-[0.98]"
                    >
                      Comprar por
                      <WhatsAppIcon className="h-4 w-4" />
                    </Link>
                    <Link
                      href={productHref}
                      className="cta-float cta-float-delay inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 text-xs font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-[var(--primary-strong)] active:translate-y-0 active:scale-[0.98]"
                    >
                      Comprar
                      <ShoppingCart className="h-4 w-4" />
                    </Link>
                  </div>
                </Card>
              );
            })}
          </div>
          {category ? (
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2 px-0.5 text-center">
                <span className="text-sm md:text-base">📱</span>
                <h2 className="text-sm font-normal tracking-tight text-slate-900 md:text-lg">
                  Busca tu <strong className="font-semibold">categoria</strong>
                </h2>
              </div>
              <div className="flex snap-x gap-2.5 overflow-x-auto pb-0.5">
                {categoriesCarousel.map((item) => (
                  <Link
                    key={item.id}
                    href={`/${item.slug}`}
                    className="group block w-24 shrink-0 snap-start transition hover:-translate-y-0.5 sm:w-28"
                  >
                    <div className="aspect-square overflow-hidden rounded-xl">
                      <img
                        src={item.cover}
                        alt={item.name}
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      />
                    </div>
                    <p className="mt-1.5 break-words text-center text-[11px] font-semibold leading-tight text-slate-900 sm:text-xs">
                      {item.name}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
          {!normalizedQuery && category ? (
            <div className="rounded-2xl border border-[var(--line)] bg-white px-4 py-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--primary-strong)]">
                {category.name}
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 md:text-2xl">
                {`${category.name} para peluqueria, barberia y espacios de belleza`}
              </h2>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
                {`Encuentra ${category.name.toLowerCase()} en ${brandName}, con referencias pensadas para negocios que necesitan proyectar calidad, comodidad y una imagen profesional.`}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
