const CANONICAL_SITE_URL = "https://magilus.com";

function normalizeSiteDomain(value: string | undefined): string {
  const fallback = CANONICAL_SITE_URL;
  const normalizedValue = value?.trim().replace(/\/+$/, "");

  if (!normalizedValue) {
    return fallback;
  }

  try {
    const parsed = new URL(normalizedValue);
    const hostname = parsed.hostname.toLowerCase();

    if (hostname === "www.magilus.com" || hostname === "magilus.com.co" || hostname === "www.magilus.com.co") {
      return fallback;
    }

    return parsed.origin;
  } catch {
    return fallback;
  }
}

export const siteConfig = {
  name: "Magilus",
  legalName: "Magilus",
  description:
    "Magilus ofrece sillas barberas e hidraulicas, camillas, tocadores, salas de espera y mobiliario profesional para peluqueria, barberia y salon de belleza, con envio a toda Colombia.",
  domain: normalizeSiteDomain(process.env.NEXT_PUBLIC_SITE_URL),
  phoneDisplay: "+57 304 648 1994",
  phoneHref: "+573046481994",
  whatsappHref:
    "https://wa.me/573046481994?text=Hola%20Magilus%2C%20quiero%20cotizar%20mobiliario%20profesional",
  logoPath: "/magilus-logo.svg",
  ogImagePath: "/magilus-logo.svg",
  country: "CO",
  locale: "es_CO",
  coreKeywords: [
    "magilus",
    "sillas para salon de belleza",
    "estaciones de belleza",
    "mobiliario para barberia",
    "mobiliario profesional para salon",
    "muebles para peluqueria",
    "sillas de barberia premium",
    "catalogo mobiliario de belleza",
  ],
} as const;

export function getSiteUrl(path = ""): string {
  return new URL(path, `${siteConfig.domain}/`).toString();
}

export function buildWhatsAppProductHref(productName: string): string {
  return `https://wa.me/${siteConfig.phoneHref.replace("+", "")}?text=${encodeURIComponent(
    `Hola ${siteConfig.name}, quiero comprar el producto: ${productName}`,
  )}`;
}

export function sanitizeDescription(value: string | null | undefined, fallback: string): string {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}
