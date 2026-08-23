import { NextResponse } from "next/server";
import QRCode from "qrcode";

import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  WACALLS_SESSION_METADATA_KEY,
  getWaCallsBaseUrl,
  getWaCallsSessionIdForChannel,
  waCallsRequest,
} from "@/lib/wacalls";

export const dynamic = "force-dynamic";

/**
 * Vincular la línea de llamadas por QR, sin salir del CRM.
 *
 * El QR de WaCalls NO se puede pedir: solo se ANUNCIA por su canal de eventos, y se renueva cada
 * ~20 segundos. Por eso esta ruta se queda escuchando ese canal desde el servidor hasta que
 * aparece uno (o hasta que se acaba el tiempo) y recién ahí responde. La pantalla la vuelve a
 * llamar y siempre tiene el código vigente, sin que el navegador tenga que hablar con WaCalls ni
 * conocer el token.
 *
 * POST = arrancar (o reintentar) la vinculación. GET = esperar el próximo QR.
 */

/** Cuánto se espera un QR antes de contestar "todavía nada". Menos que el vencimiento del código. */
const ESPERA_MS = 15000;

async function verificarPermiso() {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  // Vincular una línea es configuración del negocio, igual que conectar un WhatsApp: se pide el
  // permiso de Conexión, no el de Llamadas.
  if (!access || !canAccessClientModule(access, "connection")) {
    return { error: NextResponse.json({ error: "No autorizado" }, { status: 403 }) };
  }
  return { ok: true as const };
}

export async function POST(request: Request) {
  const permiso = await verificarPermiso();
  if ("error" in permiso) {
    return permiso.error;
  }

  const { channelId } = (await request.json().catch(() => ({}))) as { channelId?: string };
  if (!channelId) {
    return NextResponse.json({ error: "Falta el canal" }, { status: 400 });
  }

  const canal = await prisma.whatsAppChannel.findUnique({
    where: { id: channelId },
    select: { id: true, name: true, metadata: true },
  });
  if (!canal) {
    return NextResponse.json({ error: "Canal no encontrado" }, { status: 404 });
  }

  const sid = await getWaCallsSessionIdForChannel(channelId);

  /**
   * Si el canal todavía no tiene línea de llamadas se le crea una CON SU NOMBRE; si ya la tiene,
   * se le pide un QR nuevo.
   *
   * No se borra ni se recrea la existente a proposito: la sesión guarda el historial de llamadas,
   * y volver a vincular el mismo número no tiene por qué costarle eso a nadie.
   */
  if (sid) {
    const respuesta = await waCallsRequest<unknown>({
      path: `/api/sessions/${sid}/pair`,
      method: "POST",
    });
    if (!respuesta.ok) {
      return NextResponse.json({ error: respuesta.error }, { status: respuesta.status });
    }
    return NextResponse.json({ ok: true, sid });
  }

  const creada = await waCallsRequest<{ id?: string }>({
    path: "/api/sessions",
    method: "POST",
    body: { name: canal.name || "Llamadas" },
  });
  if (!creada.ok) {
    return NextResponse.json({ error: creada.error }, { status: creada.status });
  }
  const nuevo = creada.data.id?.trim();
  if (!nuevo) {
    return NextResponse.json({ error: "El servicio no devolvió la línea." }, { status: 502 });
  }

  // Se guarda EN EL CANAL: es lo que después permite que la llamada salga del mismo número con
  // el que el cliente viene chateando.
  const base =
    canal.metadata && typeof canal.metadata === "object" && !Array.isArray(canal.metadata)
      ? (canal.metadata as Record<string, unknown>)
      : {};
  await prisma.whatsAppChannel.update({
    where: { id: canal.id },
    data: {
      metadata: { ...base, [WACALLS_SESSION_METADATA_KEY]: nuevo } as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({ ok: true, sid: nuevo });
}

export async function GET(request: Request) {
  const permiso = await verificarPermiso();
  if ("error" in permiso) {
    return permiso.error;
  }

  /**
   * De que linea es el QR que estamos esperando.
   *
   * Con varias lineas vinculadas, el canal de eventos trae las novedades de TODAS. Sin filtrar,
   * la pantalla podia mostrar el QR de otro canal —o darse por vinculada porque se conecto uno
   * distinto— y quedarse esperando para siempre.
   */
  const sidEsperado = new URL(request.url).searchParams.get("sid")?.trim() || "";
  if (!sidEsperado) {
    return NextResponse.json({ error: "Falta la linea" }, { status: 400 });
  }

  const base = getWaCallsBaseUrl();
  const token = process.env.WACALLS_API_TOKEN?.trim();
  if (!base || !token) {
    return NextResponse.json({ error: "El servicio de llamadas no está configurado." }, { status: 503 });
  }

  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), ESPERA_MS);

  try {
    const flujo = await fetch(`${base}/api/events`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
      cache: "no-store",
      signal: control.signal,
    });
    if (!flujo.ok || !flujo.body) {
      return NextResponse.json({ error: "El servicio de llamadas no respondió." }, { status: 502 });
    }

    const lector = flujo.body.getReader();
    const decodificador = new TextDecoder();
    let pendiente = "";

    while (true) {
      const { done, value } = await lector.read();
      if (done) {
        break;
      }
      pendiente += decodificador.decode(value, { stream: true });

      // El formato es "data: {json}\n\n". Se procesa por líneas y se guarda el resto, porque un
      // trozo puede cortar un evento por la mitad.
      const lineas = pendiente.split("\n");
      pendiente = lineas.pop() ?? "";

      for (const linea of lineas) {
        if (!linea.startsWith("data:")) {
          continue;
        }
        let evento: { type?: string; sessionId?: string; qr?: string; paired?: boolean; state?: string };
        try {
          evento = JSON.parse(linea.slice(5).trim());
        } catch {
          continue;
        }

        if (evento.sessionId && evento.sessionId !== sidEsperado) {
          continue;
        }

        // Ya quedó vinculada: se avisa para que la pantalla cierre el QR sola, sin que nadie
        // tenga que adivinar si el escaneo funcionó.
        if (evento.paired === true || evento.state === "open") {
          void lector.cancel();
          return NextResponse.json({ ok: true, vinculado: true });
        }

        if (evento.qr) {
          void lector.cancel();
          return NextResponse.json({
            ok: true,
            vinculado: false,
            qr: await QRCode.toDataURL(evento.qr, { margin: 1, width: 320 }),
          });
        }
      }
    }

    return NextResponse.json({ ok: true, vinculado: false, qr: null });
  } catch {
    // Se acabó el tiempo sin novedades. No es un error: la pantalla vuelve a preguntar.
    return NextResponse.json({ ok: true, vinculado: false, qr: null });
  } finally {
    clearTimeout(corte);
  }
}
