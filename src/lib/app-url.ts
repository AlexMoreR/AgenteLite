function normalizeUrl(value: string | null | undefined): string {
  return value?.trim().replace(/\/+$/, "") ?? "";
}

export function normalizeInternalPath(value: string | null | undefined, fallback = "") {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return fallback;
  }

  // Solo rutas internas absolutas del sitio. Rechazar protocolos, URLs
  // relativas de red y backslashes para evitar open redirects.
  if (!normalized.startsWith("/") || normalized.startsWith("//") || normalized.includes("\\")) {
    return fallback;
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(normalized)) {
    return fallback;
  }

  return normalized;
}

function getConfiguredBaseUrl(): string {
  return (
    normalizeUrl(process.env.AUTH_URL) ||
    normalizeUrl(process.env.NEXTAUTH_URL) ||
    normalizeUrl(process.env.NEXT_PUBLIC_SITE_URL) ||
    normalizeUrl(process.env.APP_URL)
  );
}

export function getPublicBaseUrl(request?: Request): string {
  const configuredBaseUrl = getConfiguredBaseUrl();
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  if (!request) {
    return "";
  }

  const forwardedProto = normalizeUrl(request.headers.get("x-forwarded-proto"));
  const forwardedHost = normalizeUrl(request.headers.get("x-forwarded-host"));

  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}
