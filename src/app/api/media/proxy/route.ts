import { NextResponse } from "next/server";
import { getEvolutionSettings } from "@/lib/system-settings";

function isAllowedMediaProtocol(protocol: string) {
  return protocol === "http:" || protocol === "https:";
}

// Los medios de *.whatsapp.net estan cifrados y no son descargables directamente;
// intentar el fetch solo provoca cuelgues de DNS de varios segundos.
function isWhatsAppCdnHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "whatsapp.net" || host.endsWith(".whatsapp.net");
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

  if (isWhatsAppCdnHost(targetUrl.hostname)) {
    return NextResponse.json(
      { ok: false, error: "Medio de WhatsApp no disponible" },
      { status: 404 },
    );
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

  let response: Response;
  try {
    response = await fetch(targetUrl, {
      cache: "no-store",
      headers,
    });
  } catch (error) {
    // Las URLs de WhatsApp (*.whatsapp.net) son medios cifrados que no se pueden
    // descargar con un fetch directo, ademas de posibles fallos de DNS/red.
    // Devolvemos 502 en lugar de dejar que la excepcion tumbe la ruta.
    console.warn("[MEDIA_PROXY] fetch_failed", {
      url: targetUrl.toString(),
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: "No se pudo obtener el medio" },
      { status: 502 },
    );
  }

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
