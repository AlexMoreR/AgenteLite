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

  /*
    El nombre del archivo, para que la descarga no se llame "proxy".

    El navegador nombra lo que baja segun la ultima parte de la URL, y la nuestra termina en
    /api/media/proxy: una cotizacion de 1,8 MB llegaba a Descargas como "proxy", sin extension y
    sin poder abrirse de un doble clic. Se veia en el historial de Chrome como "proxy" y "proxy (1)".

    Va como `inline`: un PDF se sigue abriendo en la pestaña, y al guardarlo toma este nombre. Con
    `attachment` se forzaria la descarga y se perderia la vista previa.

    El nombre se limpia de comillas, saltos de linea y barras -partirian la cabecera o dejarian
    escribir en otra carpeta- y ademas se manda en la forma con codificacion, que es la que entiende
    los acentos y las ñ.
  */
  const nombrePedido = requestUrl.searchParams.get("name")?.trim() || "";
  const nombreLimpio = nombrePedido
    // Fuera comillas, barras y todo lo que no sea imprimible: partirian la cabecera o dejarian
    // escribir en otra carpeta.
    .replace(/[\u0000-\u001F"\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=0, no-cache, no-store, must-revalidate",
      ...(nombreLimpio
        ? {
            "Content-Disposition": `inline; filename="${nombreLimpio.replace(/[^ -~]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(nombreLimpio)}`,
          }
        : {}),
    },
  });
}
