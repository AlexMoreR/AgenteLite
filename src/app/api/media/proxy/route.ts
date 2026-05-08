import { NextResponse } from "next/server";
import { getEvolutionSettings } from "@/lib/system-settings";

function isAllowedMediaProtocol(protocol: string) {
  return protocol === "http:" || protocol === "https:";
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const targetValue = requestUrl.searchParams.get("url")?.trim();

  if (!targetValue) {
    return NextResponse.json({ ok: false, error: "Falta la url del medio" }, { status: 400 });
  }

  let targetUrl: URL;
  try {
    const evolutionSettings = await getEvolutionSettings();
    const evolutionBaseUrl = evolutionSettings.apiBaseUrl?.trim() || "";
    const shouldResolveAgainstEvolutionBase =
      targetValue.startsWith("/") && Boolean(evolutionBaseUrl);

    targetUrl = shouldResolveAgainstEvolutionBase
      ? new URL(targetValue, evolutionBaseUrl)
      : new URL(targetValue, request.url);
  } catch {
    return NextResponse.json({ ok: false, error: "Url invalida" }, { status: 400 });
  }

  if (!isAllowedMediaProtocol(targetUrl.protocol)) {
    return NextResponse.json({ ok: false, error: "Protocolo no permitido" }, { status: 400 });
  }

  const evolutionSettings = await getEvolutionSettings();
  const headers: HeadersInit = {};
  if (evolutionSettings.apiBaseUrl) {
    try {
      const evolutionBaseUrl = new URL(evolutionSettings.apiBaseUrl);
      if (targetUrl.origin === evolutionBaseUrl.origin && evolutionSettings.apiToken) {
        headers.apikey = evolutionSettings.apiToken;
      }
    } catch {
      // Si la configuracion no tiene una base valida, simplemente hacemos fetch directo.
    }
  }

  const response = await fetch(targetUrl, {
    cache: "no-store",
    headers,
  });
  if (!response.ok || !response.body) {
    return NextResponse.json({ ok: false, error: "No se pudo obtener el medio" }, { status: 502 });
  }

  const contentType = response.headers.get("content-type")?.trim() || "application/octet-stream";
  const body = Buffer.from(await response.arrayBuffer());

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=0, no-cache, no-store, must-revalidate",
    },
  });
}
