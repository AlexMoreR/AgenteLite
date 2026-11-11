import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";

/*
  Guardar los bytes de un archivo de chat en `public/uploads/chat-media/<sha256>.<ext>`.

  Vive aparte de chat-media-storage.ts para que la red de `prisma.ts` (mensaje-sin-archivos.ts) lo
  use sin cargar el conversor de audio. Es el MISMO nombre de siempre (hash del contenido + extension
  por mimetype), asi que el webhook encuentra el archivo que ya guardo la red y no escribe dos veces,
  y el mismo catalogo mandado 500 veces queda UNA vez en disco.

  Nunca pisa ni borra un archivo que ya esta: si existe, se compara (ver `comprobar`).
*/

export const CHAT_MEDIA_DIR_SEGMENTS = ["public", "uploads", "chat-media"] as const;
export const CHAT_MEDIA_PUBLIC_PREFIX = "/uploads/chat-media/";

// Limite defensivo para no llenar el disco con binarios anomalos. Los medios de
// WhatsApp normalmente estan muy por debajo de esto.
export const MAX_PERSISTED_MEDIA_BYTES = 60 * 1024 * 1024;

export type PersistableMediaType = "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT";

export function extensionForMime(mimeType: string, mediaType: PersistableMediaType) {
  const mime = mimeType.toLowerCase();

  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("mpeg") && mediaType === "AUDIO") return ".mp3";
  if (mime.includes("mp3")) return ".mp3";
  if (mime.includes("wav")) return ".wav";
  if (mime.includes("aac")) return ".aac";
  if (mime.includes("amr")) return ".amr";
  if (mime.includes("m4a") || mime.includes("mp4a")) return ".m4a";
  if (mime.includes("quicktime")) return ".mov";
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("3gpp")) return ".3gp";
  if (mime.includes("pdf")) return ".pdf";
  if (mime.includes("msword")) return ".doc";
  if (mime.includes("wordprocessingml")) return ".docx";
  if (mime.includes("ms-excel")) return ".xls";
  if (mime.includes("spreadsheetml")) return ".xlsx";
  if (mime.includes("ms-powerpoint")) return ".ppt";
  if (mime.includes("presentationml")) return ".pptx";
  if (mime.includes("zip")) return ".zip";
  if (mime.includes("text/plain")) return ".txt";

  if (mediaType === "IMAGE" || mediaType === "STICKER") return ".jpg";
  if (mediaType === "AUDIO") return ".ogg";
  if (mediaType === "VIDEO") return ".mp4";
  return ".bin";
}

/** El tipo de medio cuando el mensaje no lo dice: por el mimetype. */
export function tipoDeMedioPorMime(mimeType: string | null | undefined): PersistableMediaType {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/webp")) return "STICKER";
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("audio/")) return "AUDIO";
  if (mime.startsWith("video/")) return "VIDEO";
  return "DOCUMENT";
}

export class ArchivoDistintoError extends Error {
  constructor(nombre: string, detalle: string) {
    super(`ya existe ${nombre} con otro contenido (${detalle}); no se pisa`);
    this.name = "ArchivoDistintoError";
  }
}

export type ArchivoDeChatGuardado = {
  /** `/uploads/chat-media/<sha256>.<ext>` */
  enlace: string;
  nombre: string;
  /** Ruta completa en disco. */
  rutaEnDisco: string;
  bytes: number;
  sha256: string;
  /** true = ya estaba en disco (mismo nombre) y no se escribio nada. */
  yaExistia: boolean;
};

/**
 * Guarda los bytes con nombre por hash. Escribe a `<nombre>.tmp-<pid>-<azar>` y despues lo
 * renombra: nadie (ni el navegador ni WhatsApp) ve nunca un archivo a medio escribir.
 *
 * Si el archivo ya existe:
 *  - `comprobar: "nada"`: se confia en el (lo que hacia `persistChatMediaFromDataUrl` de siempre).
 *  - `"tamano"` (por defecto): el tamano tiene que ser el mismo.
 *  - `"hash"`: ademas se relee y el sha256 tiene que ser el mismo (la migracion).
 * Si no coincide lanza `ArchivoDistintoError` y NO toca el que esta.
 *
 * Lanza si el archivo pasa de 60 MB o si el disco falla: quien llama decide (la red de prisma deja
 * el base64 en la base, ver mensaje-sin-archivos.ts).
 */
export async function guardarBytesDeChat(input: {
  bytes: Buffer;
  mimeType: string;
  mediaType: PersistableMediaType;
  comprobar?: "nada" | "tamano" | "hash";
  /** Para pruebas: la carpeta destino. Por defecto `<cwd>/public/uploads/chat-media`. */
  carpeta?: string;
}): Promise<ArchivoDeChatGuardado> {
  const { bytes } = input;
  if (bytes.length === 0) {
    throw new Error("archivo vacio");
  }
  if (bytes.length > MAX_PERSISTED_MEDIA_BYTES) {
    throw new Error(`archivo de ${bytes.length} bytes, pasa el limite de ${MAX_PERSISTED_MEDIA_BYTES}`);
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const nombre = `${sha256}${extensionForMime(input.mimeType || "", input.mediaType)}`;
  const carpeta = input.carpeta ?? path.join(process.cwd(), ...CHAT_MEDIA_DIR_SEGMENTS);
  const rutaEnDisco = path.join(carpeta, nombre);
  const resultado = (yaExistia: boolean): ArchivoDeChatGuardado => ({
    enlace: `${CHAT_MEDIA_PUBLIC_PREFIX}${nombre}`,
    nombre,
    rutaEnDisco,
    bytes: bytes.length,
    sha256,
    yaExistia,
  });

  const comprobarExistente = async () => {
    const existente = await stat(rutaEnDisco).catch(() => null);
    if (!existente) return false;
    const comprobar = input.comprobar ?? "tamano";
    if (comprobar === "nada") return true;
    if (!existente.isFile() || existente.size !== bytes.length) {
      throw new ArchivoDistintoError(nombre, `pesa ${existente.size} y no ${bytes.length}`);
    }
    if (comprobar === "hash") {
      const hashDelDisco = createHash("sha256").update(await readFile(rutaEnDisco)).digest("hex");
      if (hashDelDisco !== sha256) throw new ArchivoDistintoError(nombre, "otro sha256");
    }
    return true;
  };

  if (await comprobarExistente()) {
    return resultado(true);
  }

  await mkdir(carpeta, { recursive: true });
  const temporal = `${rutaEnDisco}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    const archivo = await open(temporal, "wx");
    try {
      await archivo.writeFile(bytes);
      await archivo.sync();
    } finally {
      await archivo.close();
    }
    // Si otro pedido lo guardo mientras tanto, se deja el suyo (mismo contenido) y se descarta el temporal.
    if (await comprobarExistente()) {
      return resultado(true);
    }
    await rename(temporal, rutaEnDisco);
  } finally {
    // El temporal es nuestro y nunca es un archivo de un cliente: si quedo, se quita.
    await unlink(temporal).catch(() => {});
  }

  return resultado(false);
}
