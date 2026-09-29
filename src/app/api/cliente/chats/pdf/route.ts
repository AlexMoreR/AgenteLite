import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { getPublicBaseUrl } from "@/lib/app-url";
import { prisma } from "@/lib/prisma";
import { construirPdfDeConversacion, type MensajeParaPdf } from "@/lib/pdf-de-conversacion";

/**
 * Descargar un chat entero como PDF.
 *
 * Se arma en el SERVIDOR y no en el navegador por dos motivos: el navegador solo tiene los
 * mensajes que ya bajó (la bandeja carga de a 10) y no puede leer los medios de Evolution, que
 * necesitan la apikey. Acá están los dos.
 *
 * La conversación va COMPLETA, desde el primer mensaje, que fue lo que se pidió.
 */

export const dynamic = "force-dynamic";
// Un chat largo con decenas de fotos tarda: el límite por defecto lo cortaba a la mitad.
export const maxDuration = 120;

/** Tope de mensajes. Un chat de dos años no entra en un PDF que alguien vaya a abrir. */
const MAX_MENSAJES = 1500;

/** Cuántas fotos se incrustan. Más allá de esto el archivo pesa más de lo que sirve. */
const MAX_IMAGENES = 80;

/** Una foto de WhatsApp no pesa esto ni de lejos; el tope es para no tragarse un archivo raro. */
const MAX_BYTES_IMAGEN = 5 * 1024 * 1024;

const ESPERA_POR_MEDIO_MS = 8000;

/** Cuántas descargas a la vez. Secuencial, 80 fotos serían minutos. */
const EN_PARALELO = 6;

function parseChatKey(input: string) {
  const [source, ...rest] = input.split(":");
  const conversationId = rest.join(":");
  if (!conversationId || (source !== "agent" && source !== "official")) {
    return null;
  }
  return { source: source as "agent" | "official", conversationId };
}

/**
 * La URL que va a quedar escrita adentro del PDF.
 *
 * Tiene que funcionar para alguien que abre el archivo SIN sesión abierta: por eso los medios de
 * Evolution salen por `/api/media/proxy` (que además le pone la apikey) y los ya guardados en
 * nuestro disco van directo, que es como los sirve Next.
 */
function urlPublicaDelMedio(base: string, valor: string | null): string | null {
  const v = valor?.trim();
  if (!v || v.startsWith("data:") || v.startsWith("blob:")) {
    return null;
  }

  if (/^https?:\/\//i.test(v)) {
    try {
      const host = new URL(v).hostname.toLowerCase();
      // Los medios del CDN de WhatsApp están cifrados: el enlace no abriría nada.
      if (host === "whatsapp.net" || host.endsWith(".whatsapp.net")) {
        return null;
      }
    } catch {
      return null;
    }
    return `${base}/api/media/proxy?url=${encodeURIComponent(v)}`;
  }

  if (v.startsWith("/uploads/")) {
    return `${base}${v}`;
  }

  if (v.startsWith("/")) {
    return `${base}/api/media/proxy?url=${encodeURIComponent(v)}`;
  }

  return null;
}

async function descargar(url: string): Promise<Uint8Array | null> {
  const corte = AbortSignal.timeout(ESPERA_POR_MEDIO_MS);
  try {
    const respuesta = await fetch(url, { cache: "no-store", signal: corte });
    if (!respuesta.ok) {
      return null;
    }
    const largo = Number(respuesta.headers.get("content-length") || 0);
    if (largo > MAX_BYTES_IMAGEN) {
      return null;
    }
    const bytes = new Uint8Array(await respuesta.arrayBuffer());
    return bytes.length > 0 && bytes.length <= MAX_BYTES_IMAGEN ? bytes : null;
  } catch {
    // Un medio que no baja no puede costar el PDF: queda su enlace.
    return null;
  }
}

/** Bytes de una imagen guardada como data: adentro del propio mensaje. */
function bytesDeDataUrl(valor: string | null): Uint8Array | null {
  const v = valor?.trim();
  if (!v || !v.startsWith("data:")) {
    return null;
  }
  const coma = v.indexOf(",");
  if (coma < 0 || !v.slice(0, coma).includes("base64")) {
    return null;
  }
  try {
    const bytes = Buffer.from(v.slice(coma + 1), "base64");
    return bytes.length > 0 && bytes.length <= MAX_BYTES_IMAGEN ? new Uint8Array(bytes) : null;
  } catch {
    return null;
  }
}

/*
  Busca una clave a la profundidad que sea dentro del mensaje guardado.

  Es la misma lección que ya costó una vez que no se viera la tarjeta del anuncio: según el
  gateway los bloques cuelgan en distinto lugar y con otras mayúsculas, así que leer por ruta fija
  devuelve null aunque el dato esté ahí.
*/
function buscarEnPayload(valor: unknown, claves: string[], profundidad = 0): string | number | null {
  if (profundidad > 10 || !valor || typeof valor !== "object") {
    return null;
  }

  for (const [clave, dentro] of Object.entries(valor as Record<string, unknown>)) {
    if (claves.includes(clave.toLowerCase()) && (typeof dentro === "string" || typeof dentro === "number")) {
      return dentro;
    }
    if (dentro && typeof dentro === "object") {
      const encontrado = buscarEnPayload(dentro, claves, profundidad + 1);
      if (encontrado !== null) {
        return encontrado;
      }
    }
  }

  return null;
}

function segundosDeAudio(rawPayload: unknown): number | null {
  const valor = buscarEnPayload(rawPayload, ["seconds"]);
  if (typeof valor === "number") return valor;
  if (typeof valor === "string" && /^\d+$/.test(valor)) return Number(valor);
  return null;
}

function nombreDeArchivo(rawPayload: unknown): string | null {
  const valor = buscarEnPayload(rawPayload, ["filename"]);
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

/**
 * El medio, cuando la columna `mediaUrl` está vacía pero el payload lo trae.
 *
 * Buscar la clave "url" suelta por todo el mensaje traería la del anuncio del que vino el lead o
 * la de una vista previa de enlace, y el PDF terminaría mandando a otra parte. Así que primero se
 * busca `mediaUrl` —el nombre que solo usa el medio— y recién después la `url` de ADENTRO del
 * bloque del medio (`imageMessage`, `audioMessage`, …), que es donde de verdad vive.
 */
function medioDelPayload(rawPayload: unknown): string | null {
  const directo = buscarEnPayload(rawPayload, ["mediaurl"]);
  if (typeof directo === "string" && directo.trim()) {
    return directo.trim();
  }

  const bloque = buscarBloqueDeMedio(rawPayload);
  const url = bloque ? buscarEnPayload(bloque, ["url", "directpath"]) : null;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

function buscarBloqueDeMedio(valor: unknown, profundidad = 0): unknown {
  if (profundidad > 10 || !valor || typeof valor !== "object") {
    return null;
  }

  for (const [clave, dentro] of Object.entries(valor as Record<string, unknown>)) {
    if (/^(image|audio|video|document|sticker)message$/i.test(clave) && dentro && typeof dentro === "object") {
      return dentro;
    }
    const encontrado = buscarBloqueDeMedio(dentro, profundidad + 1);
    if (encontrado) {
      return encontrado;
    }
  }

  return null;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "chats")) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  const workspaceId = membership?.workspace.id;
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "Workspace no encontrado" }, { status: 404 });
  }

  const chatKey = new URL(request.url).searchParams.get("chatKey")?.trim() || "";
  const parsed = parseChatKey(chatKey);
  if (!parsed) {
    return NextResponse.json({ ok: false, error: "Chat no valido" }, { status: 400 });
  }

  const base = getPublicBaseUrl(request);

  let titulo = "";
  let telefono: string | null = null;
  let crudos: Array<{
    id: string;
    delCliente: boolean;
    tipo: string;
    texto: string | null;
    mediaUrl: string | null;
    rawPayload: unknown;
    cuando: Date;
  }> = [];

  if (parsed.source === "agent") {
    const conversacion = await prisma.conversation.findFirst({
      // El workspace en el WHERE, no después: sin eso, el id de un chat de otro negocio bajaría
      // su conversación entera.
      where: { id: parsed.conversationId, workspaceId },
      select: { id: true, contact: { select: { name: true, phoneNumber: true } } },
    });
    if (!conversacion) {
      return NextResponse.json({ ok: false, error: "Conversacion no encontrada" }, { status: 404 });
    }

    titulo = conversacion.contact.name?.trim() || conversacion.contact.phoneNumber || "Contacto";
    telefono = conversacion.contact.phoneNumber ?? null;

    const mensajes = await prisma.message.findMany({
      where: {
        conversationId: conversacion.id,
        workspaceId,
        // Las notas de sistema ("cambió la etapa a Frío") son nuestras: el cliente nunca las vio
        // y este archivo puede terminar en sus manos.
        type: { not: "SYSTEM" },
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
      take: MAX_MENSAJES,
      select: { id: true, direction: true, type: true, content: true, mediaUrl: true, rawPayload: true, createdAt: true },
    });

    crudos = mensajes.map((mensaje) => ({
      id: mensaje.id,
      delCliente: mensaje.direction === "INBOUND",
      tipo: String(mensaje.type),
      texto: mensaje.content,
      mediaUrl: mensaje.mediaUrl,
      rawPayload: mensaje.rawPayload,
      cuando: mensaje.createdAt,
    }));
  } else {
    const conversacion = await prisma.officialApiConversation.findFirst({
      where: { id: parsed.conversationId, config: { workspaceId } },
      select: { id: true, contact: { select: { name: true, phoneNumber: true, waId: true } } },
    });
    if (!conversacion) {
      return NextResponse.json({ ok: false, error: "Conversacion no encontrada" }, { status: 404 });
    }

    telefono = conversacion.contact.phoneNumber || conversacion.contact.waId || null;
    titulo = conversacion.contact.name?.trim() || telefono || "Contacto";

    const mensajes = await prisma.officialApiMessage.findMany({
      where: { conversationId: conversacion.id },
      orderBy: { createdAt: "asc" },
      take: MAX_MENSAJES,
      select: { id: true, direction: true, type: true, content: true, mediaUrl: true, rawPayload: true, createdAt: true },
    });

    crudos = mensajes.map((mensaje) => ({
      id: mensaje.id,
      delCliente: mensaje.direction === "INBOUND",
      tipo: String(mensaje.type),
      texto: mensaje.content,
      mediaUrl: mensaje.mediaUrl,
      rawPayload: mensaje.rawPayload,
      cuando: mensaje.createdAt,
    }));
  }

  if (crudos.length === 0) {
    return NextResponse.json({ ok: false, error: "La conversacion no tiene mensajes" }, { status: 404 });
  }

  const mensajes: MensajeParaPdf[] = crudos.map((crudo) => {
    const origen = crudo.mediaUrl?.trim() || medioDelPayload(crudo.rawPayload);
    return {
      id: crudo.id,
      delCliente: crudo.delCliente,
      tipo: crudo.tipo,
      texto: crudo.texto,
      medioUrl: urlPublicaDelMedio(base, origen),
      // Las guardadas como data: adentro del propio mensaje ya están acá, sin salir a la red.
      medioBytes: crudo.tipo === "IMAGE" || crudo.tipo === "STICKER" ? bytesDeDataUrl(origen) : null,
      audioSegundos: crudo.tipo === "AUDIO" ? segundosDeAudio(crudo.rawPayload) : null,
      archivoNombre: crudo.tipo === "DOCUMENT" ? nombreDeArchivo(crudo.rawPayload) : null,
      cuando: crudo.cuando,
    };
  });

  // ── Las fotos ───────────────────────────────────────────────────────────────────────────────
  const aDescargar = mensajes.filter(
    (mensaje) => (mensaje.tipo === "IMAGE" || mensaje.tipo === "STICKER") && !mensaje.medioBytes && mensaje.medioUrl,
  );
  const cache = new Map<string, Uint8Array | null>();
  let descargadas = 0;

  for (let i = 0; i < aDescargar.length; i += EN_PARALELO) {
    if (descargadas >= MAX_IMAGENES) {
      break;
    }
    const tanda = aDescargar.slice(i, i + EN_PARALELO);
    await Promise.all(
      tanda.map(async (mensaje) => {
        const url = mensaje.medioUrl!;
        if (!cache.has(url)) {
          cache.set(url, await descargar(url));
        }
        const bytes = cache.get(url) ?? null;
        if (bytes) {
          mensaje.medioBytes = bytes;
          descargadas += 1;
        }
      }),
    );
  }

  let pdf: Uint8Array;
  try {
    pdf = await construirPdfDeConversacion({
      titulo,
      telefono,
      mensajes,
      descargadoPor: session.user.name?.trim() || session.user.email || null,
    });
  } catch (error) {
    console.error("[chats/pdf] no se pudo armar el PDF", {
      chatKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false, error: "No se pudo armar el PDF" }, { status: 500 });
  }

  // El navegador nombra la descarga con lo que diga esta cabecera; sin ella se llamaría "pdf".
  const nombre = `Conversacion ${titulo}`.replace(/[\u0000-\u001F"\\/]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);

  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nombre.replace(/[^ -~]/g, "_")}.pdf"; filename*=UTF-8''${encodeURIComponent(`${nombre}.pdf`)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
