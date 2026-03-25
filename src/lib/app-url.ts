function normalizeUrl(value: string | null | undefined): string {
  return value?.trim().replace(/\/+$/, "") ?? "";
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
