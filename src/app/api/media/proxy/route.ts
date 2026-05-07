import { NextResponse } from "next/server";

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
    targetUrl = new URL(targetValue, request.url);
  } catch {
    return NextResponse.json({ ok: false, error: "Url invalida" }, { status: 400 });
  }

  if (!isAllowedMediaProtocol(targetUrl.protocol)) {
    return NextResponse.json({ ok: false, error: "Protocolo no permitido" }, { status: 400 });
  }

  const response = await fetch(targetUrl, { cache: "no-store" });
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
