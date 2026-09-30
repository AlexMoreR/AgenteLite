import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { canAccessClientModule, getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { getPublicBaseUrl } from "@/lib/app-url";
import { prisma } from "@/lib/prisma";

/**
 * Lo que comparten las descargas de una conversación (el PDF y la versión con audios).
 *
 * Están juntas a propósito: las dos tienen que mostrar EXACTAMENTE los mismos mensajes. Con dos
 * copias de esta lógica, el día que se corrija una -qué mensajes entran, cómo se encuentra un
 * medio- la otra seguiría mostrando otra cosa, y nadie se daría cuenta hasta comparar dos archivos.
 */

/** Un mensaje, ya aplanado: de acá para abajo no se sabe de qué tabla salió. */
export type MensajeExportado = {
  id: string;
  /** true = lo escribió el cliente. */
  delCliente: boolean;
  tipo: string;
  texto: string | null;
  /** URL absoluta y pública del medio, o null si no hay/no se pudo resolver. */
  medioUrl: string | null;
  /** Bytes del medio, solo cuando se descargaron. */
  medioBytes: Uint8Array | null;
  /** Tipo MIME de esos bytes, tal como lo dijo el servidor que los entregó. */
  medioTipo: string | null;
  /** Segundos de la nota de voz, si el mensaje los traía. */
  audioSegundos: number | null;
  /** Lo que se dice en la nota de voz, pasado a texto (ver transcripcion-de-audios). */
  transcripcion: string | null;
  /** Nombre del archivo, para los documentos. */
  archivoNombre: string | null;
  cuando: Date;
};

export type ConversacionExportada = {
  chatKey: string;
  titulo: string;
  telefono: string | null;
  descargadoPor: string | null;
  mensajes: MensajeExportado[];
};

/** Tope de mensajes. Un chat de dos años no entra en un archivo que alguien vaya a abrir. */
const MAX_MENSAJES = 1500;

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
 * La URL que va a quedar escrita adentro del archivo.
 *
 * Tiene que funcionar para alguien que lo abre SIN sesión abierta: por eso los medios de Evolution
 * salen por `/api/media/proxy` (que además le pone la apikey) y los ya guardados en nuestro disco
 * van directo, que es como los sirve Next.
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

async function descargar(url: string, maxBytes: number): Promise<{ bytes: Uint8Array; tipo: string | null } | null> {
  try {
    const respuesta = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(ESPERA_POR_MEDIO_MS) });
    if (!respuesta.ok) {
      return null;
    }
    const largo = Number(respuesta.headers.get("content-length") || 0);
    if (largo > maxBytes) {
      return null;
    }
    const bytes = new Uint8Array(await respuesta.arrayBuffer());
    if (bytes.length === 0 || bytes.length > maxBytes) {
      return null;
    }
    const tipo = respuesta.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || null;
    return { bytes, tipo };
  } catch {
    // Un medio que no baja no puede costar el archivo entero: queda su enlace.
    return null;
  }
}

/** Bytes de un medio guardado como data: adentro del propio mensaje. */
function bytesDeDataUrl(valor: string | null): { bytes: Uint8Array; tipo: string | null } | null {
  const v = valor?.trim();
  if (!v || !v.startsWith("data:")) {
    return null;
  }
  const coma = v.indexOf(",");
  const cabecera = coma > 0 ? v.slice(5, coma) : "";
  if (coma < 0 || !cabecera.includes("base64")) {
    return null;
  }
  try {
    const bytes = Buffer.from(v.slice(coma + 1), "base64");
    if (bytes.length === 0) {
      return null;
    }
    return { bytes: new Uint8Array(bytes), tipo: cabecera.split(";")[0]?.trim().toLowerCase() || null };
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
 * la de una vista previa de enlace, y el archivo terminaría mandando a otra parte. Así que primero
 * se busca `mediaUrl` —el nombre que solo usa el medio— y recién después la `url` de ADENTRO del
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

/**
 * Quién pide, qué conversación y todos sus mensajes.
 *
 * Devuelve la respuesta de error lista cuando algo falla, para que cada ruta no repita el mismo
 * rosario de 401/403/404.
 */
export async function cargarConversacionParaExportar(
  request: Request,
): Promise<{ ok: true; datos: ConversacionExportada } | { ok: false; respuesta: NextResponse }> {
  const falla = (error: string, status: number) => ({
    ok: false as const,
    respuesta: NextResponse.json({ ok: false, error }, { status }),
  });

  const session = await auth();
  if (!session?.user?.id || !session.user.role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(session.user.role)) {
    return falla("No autorizado", 401);
  }

  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access || !canAccessClientModule(access, "chats")) {
    return falla("No autorizado", 403);
  }

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  const workspaceId = membership?.workspace.id;
  if (!workspaceId) {
    return falla("Workspace no encontrado", 404);
  }

  const chatKey = new URL(request.url).searchParams.get("chatKey")?.trim() || "";
  const parsed = parseChatKey(chatKey);
  if (!parsed) {
    return falla("Chat no valido", 400);
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
    transcripcion: string | null;
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
      return falla("Conversacion no encontrada", 404);
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
      select: { id: true, direction: true, type: true, content: true, mediaUrl: true, rawPayload: true, transcripcion: true, createdAt: true },
    });

    crudos = mensajes.map((mensaje) => ({
      id: mensaje.id,
      delCliente: mensaje.direction === "INBOUND",
      tipo: String(mensaje.type),
      texto: mensaje.content,
      mediaUrl: mensaje.mediaUrl,
      rawPayload: mensaje.rawPayload,
      transcripcion: mensaje.transcripcion,
      cuando: mensaje.createdAt,
    }));
  } else {
    const conversacion = await prisma.officialApiConversation.findFirst({
      where: { id: parsed.conversationId, config: { workspaceId } },
      select: { id: true, contact: { select: { name: true, phoneNumber: true, waId: true } } },
    });
    if (!conversacion) {
      return falla("Conversacion no encontrada", 404);
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
      // El canal oficial no tiene audios transcritos: en 30 dias no entro ninguno por ahi.
      transcripcion: null,
      cuando: mensaje.createdAt,
    }));
  }

  if (crudos.length === 0) {
    return falla("La conversacion no tiene mensajes", 404);
  }

  const mensajes: MensajeExportado[] = crudos.map((crudo) => {
    const origen = crudo.mediaUrl?.trim() || medioDelPayload(crudo.rawPayload);
    // Los guardados como data: adentro del propio mensaje ya están acá, sin salir a la red.
    const incrustado =
      crudo.tipo === "IMAGE" || crudo.tipo === "STICKER" || crudo.tipo === "AUDIO" ? bytesDeDataUrl(origen) : null;
    return {
      id: crudo.id,
      delCliente: crudo.delCliente,
      tipo: crudo.tipo,
      texto: crudo.texto,
      medioUrl: urlPublicaDelMedio(base, origen),
      medioBytes: incrustado?.bytes ?? null,
      medioTipo: incrustado?.tipo ?? null,
      audioSegundos: crudo.tipo === "AUDIO" ? segundosDeAudio(crudo.rawPayload) : null,
      transcripcion: crudo.tipo === "AUDIO" ? crudo.transcripcion?.trim() || null : null,
      archivoNombre: crudo.tipo === "DOCUMENT" ? nombreDeArchivo(crudo.rawPayload) : null,
      cuando: crudo.cuando,
    };
  });

  return {
    ok: true,
    datos: {
      chatKey,
      titulo,
      telefono,
      descargadoPor: session.user.name?.trim() || session.user.email || null,
      mensajes,
    },
  };
}

/**
 * Baja los medios de los tipos pedidos y los deja en cada mensaje.
 *
 * Con topes por cantidad, por archivo y en total: pasado cualquiera de ellos, el mensaje se queda
 * sin bytes y cada archivo lo muestra como enlace. Un chat con cien audios no puede terminar en
 * un archivo que nadie logra abrir.
 */
export async function descargarMedios(
  mensajes: MensajeExportado[],
  opciones: { tipos: string[]; maximo: number; maxBytesPorArchivo: number; presupuestoTotal: number },
) {
  const pendientes = mensajes.filter(
    (mensaje) => opciones.tipos.includes(mensaje.tipo) && !mensaje.medioBytes && mensaje.medioUrl,
  );
  const cache = new Map<string, { bytes: Uint8Array; tipo: string | null } | null>();
  let descargados = 0;
  let bytesTotales = mensajes.reduce((suma, mensaje) => suma + (mensaje.medioBytes?.length ?? 0), 0);

  for (let i = 0; i < pendientes.length; i += EN_PARALELO) {
    if (descargados >= opciones.maximo || bytesTotales >= opciones.presupuestoTotal) {
      break;
    }
    const tanda = pendientes.slice(i, i + EN_PARALELO);
    await Promise.all(
      tanda.map(async (mensaje) => {
        const url = mensaje.medioUrl!;
        if (!cache.has(url)) {
          cache.set(url, await descargar(url, opciones.maxBytesPorArchivo));
        }
        const bajado = cache.get(url) ?? null;
        if (!bajado || descargados >= opciones.maximo || bytesTotales + bajado.bytes.length > opciones.presupuestoTotal) {
          return;
        }
        mensaje.medioBytes = bajado.bytes;
        mensaje.medioTipo = bajado.tipo;
        descargados += 1;
        bytesTotales += bajado.bytes.length;
      }),
    );
  }

  return { descargados, bytesTotales };
}

/** El nombre del archivo, limpio para la cabecera (sin comillas, barras ni saltos de línea). */
export function nombreDeDescarga(titulo: string, extension: string) {
  const nombre = `Conversacion ${titulo}`
    .replace(/[\u0000-\u001F"\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return `attachment; filename="${nombre.replace(/[^ -~]/g, "_")}.${extension}"; filename*=UTF-8''${encodeURIComponent(`${nombre}.${extension}`)}`;
}
