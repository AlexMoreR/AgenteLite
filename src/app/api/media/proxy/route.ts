import { NextResponse } from "next/server";
import { getEvolutionSettings } from "@/lib/system-settings";
import { readGatewayConnection } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";

function isAllowedMediaProtocol(protocol: string) {
  return protocol === "http:" || protocol === "https:";
}

// Los medios de *.whatsapp.net estan cifrados y no son descargables directamente;
// intentar el fetch solo provoca cuelgues de DNS de varios segundos.
function isWhatsAppCdnHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "whatsapp.net" || host.endsWith(".whatsapp.net");
}

/** Nuestro propio dominio, el publico y el que llega en la peticion (por si se entra por otro). */
const HOSTS_PROPIOS = ["app.aizenbot.com"];

function esHostPropio(hostname: string, request: Request) {
  const host = hostname.toLowerCase();
  const pedido = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "")
    .split(",")[0]
    .trim()
    .split(":")[0]
    .toLowerCase();
  return HOSTS_PROPIOS.includes(host) || (Boolean(pedido) && host === pedido);
}

/**
 * Los sitios de donde llegan los medios: las fotos de anuncios y perfiles de Meta, el catalogo,
 * y los gateways de WhatsApp (Evolution y los WAHA de cada linea). Sacado de lo que el proxy pidio
 * de verdad (05-10-2026): nuestro dominio, `*.fbcdn.net` y el WAHA.
 */
const DOMINIOS_PERMITIDOS = ["fbcdn.net", "cdninstagram.com", "fbsbx.com", "magilus.com"];

function esDeDominio(host: string, dominio: string) {
  return host === dominio || host.endsWith(`.${dominio}`);
}

// Los hosts de los gateways salen de la base: se releen cada 5 minutos, no en cada foto.
let gatewaysCache: { hosts: Set<string>; vence: number } | null = null;

async function hostsDeGateways(): Promise<Set<string>> {
  if (gatewaysCache && gatewaysCache.vence > Date.now()) {
    return gatewaysCache.hosts;
  }
  const hosts = new Set<string>();
  try {
    const evolution = await getEvolutionSettings();
    if (evolution.apiBaseUrl) {
      hosts.add(new URL(evolution.apiBaseUrl).hostname.toLowerCase());
    }
  } catch {
    // sin Evolution configurado no hay host que agregar
  }
  try {
    const lineas = await prisma.whatsAppChannel.findMany({ select: { metadata: true } });
    for (const linea of lineas) {
      const conexion = readGatewayConnection(linea.metadata);
      if (conexion?.baseUrl) {
        try {
          hosts.add(new URL(conexion.baseUrl).hostname.toLowerCase());
        } catch {
          // una direccion mal guardada no tumba al resto
        }
      }
    }
  } catch {
    // Si la base no responde se usa lo ultimo que se supo.
    if (gatewaysCache) {
      return gatewaysCache.hosts;
    }
  }
  gatewaysCache = { hosts, vence: Date.now() + 5 * 60 * 1000 };
  return hosts;
}

async function esHostPermitido(hostname: string) {
  const host = hostname.toLowerCase();
  if (DOMINIOS_PERMITIDOS.some((dominio) => esDeDominio(host, dominio))) {
    return true;
  }
  return (await hostsDeGateways()).has(host);
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

  const nombreParaDescargar = requestUrl.searchParams.get("name")?.trim() || "";

  /*
    Un archivo NUESTRO: se manda directo, no se baja y se reenvia.

    Antes el servidor se descargaba a si mismo el archivo y lo devolvia sin cache, y el navegador lo
    volvia a pedir en cada vista (73 MB en 15 minutos desde la oficina, 05-10-2026). La direccion
    directa la sirve el nginx de archivos y queda guardada. Los documentos con nombre siguen por
    aca: el nombre de la descarga solo se puede poner desde esta ruta.
  */
  if (esHostPropio(targetUrl.hostname, request)) {
    if (targetUrl.pathname.startsWith("/uploads/") && !nombreParaDescargar) {
      return new NextResponse(null, {
        status: 302,
        headers: { Location: `${targetUrl.pathname}${targetUrl.search}` },
      });
    }
    if (!targetUrl.pathname.startsWith("/uploads/")) {
      return NextResponse.json({ ok: false, error: "Direccion no permitida" }, { status: 403 });
    }
  } else if (!(await esHostPermitido(targetUrl.hostname))) {
    /*
      Solo se piden archivos a quienes nos los mandan de verdad.

      El proxy no exige sesion -el chat exportado se abre sin estar logueado y la transcripcion
      llama desde el propio servidor-, asi que sin esta lista cualquiera podia usar nuestro servidor
      para pedir lo que quisiera: otras paginas, o la red interna (la base, el gateway) desde
      adentro.
    */
    console.warn("[MEDIA_PROXY] host no permitido", { host: targetUrl.hostname });
    return NextResponse.json({ ok: false, error: "Direccion no permitida" }, { status: 403 });
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
      /*
        Un dia en el navegador de quien lo pidio. Lo que pasa por aca no cambia para la misma
        direccion (las de Meta vienen firmadas y vencen solas), y sin cache cada vista lo volvia a
        bajar entero. `private`: son medios de clientes, no se guardan en intermediarios.
      */
      "Cache-Control": "private, max-age=86400",
      ...(nombreLimpio
        ? {
            "Content-Disposition": `inline; filename="${nombreLimpio.replace(/[^ -~]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(nombreLimpio)}`,
          }
        : {}),
    },
  });
}
