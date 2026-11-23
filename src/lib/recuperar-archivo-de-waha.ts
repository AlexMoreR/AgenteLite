import { buscarArchivosEnPayload, decodificarBase64 } from "@/lib/payload-sin-archivos";
import { guardarBytesDeChat, type PersistableMediaType } from "@/lib/guardar-archivo-de-chat";

/*
  Un archivo que quedó apuntando a WAHA (`https://<waha>/api/files/<línea>/<archivo>`) en vez de a
  nuestro disco.

  Esa dirección exige la clave de la línea, así que en el chat se veía el ícono roto: el proxy la
  pide sin clave, WAHA contesta 401 y el proxy da 502 (Alex, 23-nov-2026, un video de una clienta en
  el celular). Les pasaba a los VIDEOS que mandan las clientas: las fotos y los audios del mismo día
  sí quedaban en /uploads/chat-media.

  Al abrir el chat se recupera en segundo plano, de lo más barato a lo más caro:
    1. el base64 que haya quedado en la fila (si el guardado del webhook falló, la red lo conserva);
    2. el archivo en WAHA, pedido CON la clave de su línea;
    3. pedirle a WAHA que lo vuelva a bajar de WhatsApp (sirve mientras WhatsApp lo tenga).
  Lo que se recupera se guarda en /uploads/chat-media con el nombre por hash de siempre y la fila
  pasa a apuntar ahí: la próxima apertura ya no hace nada.

  Es puro en lo que importa: la base, WAHA y el disco entran por `dependencias`, para probarlo sin
  servidor.
*/

/** `https://<host>/api/files/<sesión>/<archivo>` → la sesión (la línea). null si no es de WAHA. */
export function sesionDeUnArchivoDeWaha(url: string | null | undefined): string | null {
  const valor = url?.trim();
  if (!valor || !/^https?:\/\//i.test(valor)) return null;
  try {
    const partes = new URL(valor).pathname.split("/").filter(Boolean);
    if (partes[0] !== "api" || partes[1] !== "files" || partes.length < 4) return null;
    return decodeURIComponent(partes[2]);
  } catch {
    return null;
  }
}

/** El chat y el id que WAHA necesita para volver a bajarlo, sacados del id del mensaje (`false_<chat>_<id>`). */
export function chatYMensajeDeWaha(externalId: string | null | undefined): { chatId: string; mensajeId: string } | null {
  const valor = externalId?.trim() ?? "";
  const coincide = /^(true|false)_(.+)_([^_]+)$/.exec(valor);
  if (!coincide) return null;
  return { chatId: coincide[2], mensajeId: valor };
}

export type ConexionDeWaha = { baseUrl: string; apiToken: string };

export type DependenciasDeLaRecuperacion = {
  /** El rawPayload COMPLETO de la fila (con base64, si quedó). */
  leerPayloadCompleto: (messageId: string) => Promise<unknown>;
  /** La conexión de la línea con esa sesión, o null. */
  conexionDeLaSesion: (sesion: string) => Promise<ConexionDeWaha | null>;
  /** Baja un archivo de WAHA con la clave; los bytes o null. */
  bajar: (conexion: ConexionDeWaha, url: string) => Promise<{ bytes: Buffer; mimetype: string | null } | null>;
  /** Le pide a WAHA que lo baje otra vez de WhatsApp; la nueva URL o null. */
  pedirOtraVez: (
    conexion: ConexionDeWaha,
    sesion: string,
    chatId: string,
    mensajeId: string,
  ) => Promise<{ url: string; mimetype: string } | null>;
  guardar: (input: { bytes: Buffer; mimeType: string; mediaType: PersistableMediaType }) => Promise<{ enlace: string }>;
  /** Apunta la fila al archivo guardado. */
  apuntarFila: (messageId: string, enlace: string) => Promise<void>;
  avisar?: (texto: string, datos: Record<string, unknown>) => void;
};

export type MensajeConArchivoEnWaha = {
  id: string;
  externalId: string | null;
  mediaUrl: string | null;
  type: PersistableMediaType;
};

const MIME_POR_TIPO: Record<PersistableMediaType, string> = {
  IMAGE: "image/jpeg",
  STICKER: "image/webp",
  AUDIO: "audio/ogg",
  VIDEO: "video/mp4",
  DOCUMENT: "application/octet-stream",
};

/*
  Lo que ya se intentó y no salió no se reintenta en cada apertura (cada una son hasta tres pedidos a
  WAHA). Media hora en memoria del proceso: si WhatsApp lo devuelve más tarde, se vuelve a intentar.
*/
const ESPERA_TRAS_FALLAR_MS = 30 * 60 * 1000;
const fallidos = new Map<string, number>();
const enCurso = new Set<string>();

export function olvidarIntentos() {
  fallidos.clear();
  enCurso.clear();
}

/** Se está recuperando ahora (el navegador tiene que volver a preguntar). */
export function seEstaRecuperando(messageId: string): boolean {
  return enCurso.has(messageId);
}

/** La fila tiene el archivo en WAHA y vale la pena intentarlo ahora. */
export function hayQueRecuperar(mensaje: MensajeConArchivoEnWaha, ahora = Date.now()): boolean {
  if (!sesionDeUnArchivoDeWaha(mensaje.mediaUrl)) return false;
  if (enCurso.has(mensaje.id)) return false;
  const fallo = fallidos.get(mensaje.id);
  return !(fallo && ahora - fallo < ESPERA_TRAS_FALLAR_MS);
}

/**
 * Recupera el archivo y apunta la fila a /uploads/chat-media. Devuelve el enlace nuevo, o null si no
 * se pudo (y queda anotado para no insistir media hora). Nunca lanza.
 */
export async function recuperarArchivoDeWaha(
  mensaje: MensajeConArchivoEnWaha,
  dependencias: DependenciasDeLaRecuperacion,
  ahora = Date.now(),
): Promise<string | null> {
  const sesion = sesionDeUnArchivoDeWaha(mensaje.mediaUrl);
  if (!sesion || !mensaje.mediaUrl || !hayQueRecuperar(mensaje, ahora)) return null;
  const avisar = dependencias.avisar ?? ((texto, datos) => console.warn(texto, datos));
  enCurso.add(mensaje.id);
  let paso = "base";

  const guardarYApuntar = async (bytes: Buffer, mimetype: string | null) => {
    const { enlace } = await dependencias.guardar({
      bytes,
      mimeType: mimetype || MIME_POR_TIPO[mensaje.type],
      mediaType: mensaje.type,
    });
    await dependencias.apuntarFila(mensaje.id, enlace);
    fallidos.delete(mensaje.id);
    console.log("[archivo-de-waha] recuperado", { messageId: mensaje.id, tipo: mensaje.type, paso, bytes: bytes.length });
    return enlace;
  };

  try {
    // 1. El base64 que haya quedado en la fila.
    const payload = await dependencias.leerPayloadCompleto(mensaje.id).catch(() => null);
    for (const archivo of buscarArchivosEnPayload(payload)) {
      const leido = decodificarBase64(archivo.texto);
      if (leido && leido.bytes.length > 0) {
        return await guardarYApuntar(leido.bytes, leido.mimetype ?? archivo.mimetype);
      }
    }

    const conexion = await dependencias.conexionDeLaSesion(sesion);
    if (!conexion) {
      avisar("[archivo-de-waha] la línea del archivo no tiene clave de WAHA", { messageId: mensaje.id, sesion });
      fallidos.set(mensaje.id, ahora);
      return null;
    }

    // 2. El archivo en WAHA, con la clave.
    paso = "waha";
    const bajado = await dependencias.bajar(conexion, mensaje.mediaUrl);
    if (bajado && bajado.bytes.length > 0) {
      return await guardarYApuntar(bajado.bytes, bajado.mimetype);
    }

    // 3. Que WAHA lo vuelva a bajar de WhatsApp.
    paso = "whatsapp";
    const ids = chatYMensajeDeWaha(mensaje.externalId);
    if (ids) {
      const nuevo = await dependencias.pedirOtraVez(conexion, sesion, ids.chatId, ids.mensajeId);
      if (nuevo?.url) {
        const otraVez = await dependencias.bajar(conexion, nuevo.url);
        if (otraVez && otraVez.bytes.length > 0) {
          return await guardarYApuntar(otraVez.bytes, otraVez.mimetype ?? nuevo.mimetype);
        }
      }
    }

    avisar("[archivo-de-waha] no se pudo recuperar", { messageId: mensaje.id, tipo: mensaje.type, sesion });
    fallidos.set(mensaje.id, ahora);
    return null;
  } catch (error) {
    avisar("[archivo-de-waha] falló la recuperación", {
      messageId: mensaje.id,
      paso,
      error: error instanceof Error ? error.message : String(error),
    });
    fallidos.set(mensaje.id, ahora);
    return null;
  } finally {
    enCurso.delete(mensaje.id);
  }
}

/** Las dependencias de verdad: la base, WAHA y el disco. */
export async function dependenciasReales(): Promise<DependenciasDeLaRecuperacion> {
  const [{ prisma }, { readGatewayConnection }, { reintentarMediaWaha }] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/evolution"),
    import("@/lib/waha"),
  ]);
  return {
    leerPayloadCompleto: async (messageId) =>
      (await prisma.message.findUnique({ where: { id: messageId }, select: { rawPayload: true } }))?.rawPayload ?? null,
    conexionDeLaSesion: async (sesion) => {
      const linea = await prisma.whatsAppChannel.findUnique({
        where: { evolutionInstanceName: sesion },
        select: { metadata: true },
      });
      const conexion = linea ? readGatewayConnection(linea.metadata) : null;
      return conexion?.apiToken ? { baseUrl: conexion.baseUrl, apiToken: conexion.apiToken } : null;
    },
    bajar: async (conexion, url) => {
      // Solo a la misma WAHA de la línea: la clave no sale hacia otro host.
      if (new URL(url).host !== new URL(conexion.baseUrl).host) return null;
      const respuesta = await fetch(url, {
        headers: { "X-Api-Key": conexion.apiToken },
        cache: "no-store",
        signal: AbortSignal.timeout(120_000),
      }).catch(() => null);
      if (!respuesta?.ok) return null;
      const mimetype = respuesta.headers.get("content-type")?.split(";")[0]?.trim() || null;
      return { bytes: Buffer.from(await respuesta.arrayBuffer()), mimetype };
    },
    pedirOtraVez: async (conexion, sesion, chatId, mensajeId) => {
      const nuevo = await reintentarMediaWaha({ connection: conexion, sesion, chatId, mensajeId });
      return nuevo ? { url: nuevo.url, mimetype: nuevo.mimetype } : null;
    },
    guardar: (input) => guardarBytesDeChat({ ...input, comprobar: "nada" }),
    apuntarFila: async (messageId, enlace) => {
      await prisma.message.update({ where: { id: messageId }, data: { mediaUrl: enlace } });
    },
  };
}
