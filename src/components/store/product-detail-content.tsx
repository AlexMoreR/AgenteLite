import Link from "next/link";
import { MessageCircle, ShoppingCart } from "lucide-react";
import { ProductGallery } from "@/components/store/product-gallery";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/currency";
import type { SupportedCurrencyCode } from "@/lib/currency";
import { buildProductPath } from "@/lib/product-slugs";
import { buildWhatsAppProductHref, getSiteUrl, sanitizeDescription, siteConfig } from "@/lib/site";

type ProductDetailContentProps = {
  product: {
    id: string;
    slug: string;
    name: string;
    code: string | null;
    description: string | null;
    price: unknown;
    wholesalePrice: unknown;
    minWholesaleQty: number;
    thumbnailUrl: string;
    categoryId: string | null;
    category: { name: string; slug: string } | null;
    images: Array<{ url: string }>;
  };
  currency: SupportedCurrencyCode;
  relatedProducts: Array<{
    id: string;
    slug: string;
    name: string;
    price: unknown;
    thumbnailUrl: string;
    code: string | null;
    category: { name: string; slug: string } | null;
  }>;
};

export function ProductDetailContent({
  product,
  currency,
  relatedProducts,
}: ProductDetailContentProps) {
  const gallery = Array.from(
    new Set(
      [product.thumbnailUrl, ...product.images.map((item) => item.url)]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  const whatsAppHref = buildWhatsAppProductHref(product.name);
  const productDescription = sanitizeDescription(
    product.description,
    `${product.name} disponible en ${siteConfig.name} para proyectos de salon, barberia y mobiliario profesional premium.`,
  );
  const canonicalPath = buildProductPath(product);
  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${getSiteUrl(canonicalPath)}#product`,
    name: product.name,
    description: productDescription,
    image: gallery.map((url) => (url.startsWith("http") ? url : getSiteUrl(url))),
    sku: product.code ?? undefined,
    brand: {
      "@type": "Brand",
      name: siteConfig.name,
    },
    category: product.category?.name ?? "Mobiliario profesional",
    offers: {
      "@type": "Offer",
      url: getSiteUrl(canonicalPath),
      priceCurrency: currency,
      price: Number(product.price),
      availability: "https://schema.org/InStock",
      seller: {
        "@type": "Organization",
        name: siteConfig.name,
      },
    },
  };

  return (
    <section className="app-page space-y-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }}
      />

      <div className="flex items-center justify-between">
        <Link
          href={product.category?.slug ? `/${product.category.slug}` : "/"}
          className="inline-flex items-center rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-sm font-medium text-[var(--primary-strong)] transition hover:bg-slate-50"
        >
          Volver a tienda
        </Link>
        {product.category?.name ? (
          <span className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-[var(--line)]">
            {product.category.name}
          </span>
        ) : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <ProductGallery name={product.name} images={gallery} />

        <Card className="space-y-4 rounded-2xl">
          <div className="space-y-2 border-b border-[var(--line)] pb-4">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">{product.name}</h1>
            {product.description ? (
              <p className="text-sm leading-6 text-slate-600">{product.description}</p>
            ) : (
              <p className="text-sm text-slate-500">Este producto no tiene descripcion disponible.</p>
            )}
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-[var(--primary)] bg-white px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">Precio detal</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
                {formatMoney(String(product.price), currency)}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-white px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">Precio mayorista</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {formatMoney(String(product.wholesalePrice), currency)}
              </p>
              <p className="mt-1 text-xs text-slate-500">Minimo {product.minWholesaleQty} unidades</p>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <Link
                href={whatsAppHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center justify-center gap-1.5 text-sm font-semibold text-emerald-700 transition hover:text-emerald-800"
              >
                <MessageCircle className="h-4 w-4" />
                Comprar por WhatsApp
              </Link>
              <button
                type="button"
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-strong)]"
              >
                <ShoppingCart className="h-4 w-4" />
                Comprar
              </button>
            </div>
            {product.code ? (
              <p className="text-xs text-slate-500">
                Codigo de referencia: <span className="font-medium text-slate-700">{product.code}</span>
              </p>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="rounded-2xl border border-[var(--line)] bg-white px-5 py-4">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">Detalle profesional</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {productDescription} Esta referencia forma parte del catalogo premium de {siteConfig.name}, enfocado en
          sillas, estaciones y mobiliario profesional para negocios que cuidan la experiencia del cliente y la imagen
          del espacio.
        </p>
      </div>

      {relatedProducts.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">Productos relacionados</h2>
            <Link href="/" className="text-xs font-medium text-[var(--primary)] hover:text-[var(--primary-strong)]">
              Ver toda la tienda
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {relatedProducts.map((item) => (
              <Link key={item.id} href={buildProductPath(item)} className="group block">
                <Card className="h-full overflow-hidden rounded-xl p-0 transition group-hover:translate-y-[-2px] group-hover:shadow-[0_20px_35px_-30px_rgba(15,23,42,0.45)]">
                  <div className="relative">
                    <img
                      src={item.thumbnailUrl}
                      alt={item.name}
                      className="h-36 w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                    />
                    {item.category?.name ? (
                      <span className="absolute left-2 top-2 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                        {item.category.name}
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-1.5 px-3 py-3">
                    <p className="line-clamp-1 text-sm font-semibold text-slate-900">{item.name}</p>
                    <p className="text-sm font-semibold text-[var(--primary-strong)]">
                      {formatMoney(String(item.price), currency)}
                    </p>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
