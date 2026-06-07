import { mkdir, writeFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// Carpeta servida por Next desde /public; reutiliza el mismo mecanismo de
// almacenamiento que la subida manual de medios (src/app/api/cliente/chats/upload-media).
const CHAT_MEDIA_DIR_SEGMENTS = ["public", "uploads", "chat-media"] as const;
const CHAT_MEDIA_PUBLIC_PREFIX = "/uploads/chat-media/";

// Limite defensivo para no llenar el disco con binarios anomalos. Los medios de
// WhatsApp normalmente estan muy por debajo de esto.
const MAX_PERSISTED_MEDIA_BYTES = 60 * 1024 * 1024;

type PersistableMediaType = "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT";

// Una URL ya persistida en nuestro almacenamiento propio es estable y renderable
// directamente; los consumidores la detectan para no re-resolver contra Evolution.
export function isPersistedChatMediaUrl(value?: string | null) {
  if (!value) {
    return false;
  }

  return value.trim().startsWith(CHAT_MEDIA_PUBLIC_PREFIX);
}

/**
 * Indica si una URL de medio persistido (`/uploads/chat-media/<archivo>`) corresponde
 * a un archivo que realmente existe en el disco de ESTE servidor. La BD es compartida
 * entre entornos (local/desplegado), asi que una fila puede referenciar un binario que
 * solo se escribio en otro servidor; en ese caso hay que re-resolver contra Evolution.
 */
export async function persistedChatMediaFileExists(publicUrl?: string | null): Promise<boolean> {
  if (!isPersistedChatMediaUrl(publicUrl)) {
    return false;
  }

  const fileName = publicUrl!.trim().slice(CHAT_MEDIA_PUBLIC_PREFIX.length);
  // Defensa contra path traversal: solo nombre de archivo plano.
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
    return false;
  }

  const filePath = path.join(process.cwd(), ...CHAT_MEDIA_DIR_SEGMENTS, fileName);
  return fileExists(filePath);
}

function extensionForMime(mimeType: string, mediaType: PersistableMediaType) {
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

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
  const trimmed = dataUrl.trim();
  if (!trimmed.toLowerCase().startsWith("data:")) {
    return null;
  }

  const commaIndex = trimmed.indexOf(",");
  if (commaIndex < 0) {
    return null;
  }

  const header = trimmed.slice(5, commaIndex); // entre "data:" y la coma
  const isBase64 = /;base64/i.test(header);
  const mimeType = header.split(";")[0]?.trim() || "application/octet-stream";
  const data = trimmed.slice(commaIndex + 1);

  try {
    const buffer = isBase64
      ? Buffer.from(data, "base64")
      : Buffer.from(decodeURIComponent(data), "utf8");

    if (buffer.length === 0) {
      return null;
    }

    return { mimeType, buffer };
  } catch {
    return null;
  }
}

async function fileExists(filePath: string) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Persiste el binario de un medio (recibido como data: URL base64 ya resuelta) en el
 * almacenamiento propio de AgenteLite y devuelve una URL relativa permanente y
 * renderable (`/uploads/chat-media/<hash>.<ext>`), o null si la entrada no es un
 * data: URL valido o no se pudo escribir.
 *
 * El nombre se deriva de un hash del contenido, asi que reprocesar el mismo binario
 * (reintentos de webhook, backfill) no duplica archivos: se escribe a la misma ruta.
 */
export async function persistChatMediaFromDataUrl(input: {
  dataUrl?: string | null;
  mediaType: PersistableMediaType;
}): Promise<string | null> {
  if (!input.dataUrl) {
    return null;
  }

  const parsed = parseDataUrl(input.dataUrl);
  if (!parsed) {
    return null;
  }

  if (parsed.buffer.length > MAX_PERSISTED_MEDIA_BYTES) {
    return null;
  }

  const ext = extensionForMime(parsed.mimeType, input.mediaType);
  const hash = createHash("sha256").update(parsed.buffer).digest("hex");
  const fileName = `${hash}${ext}`;
  const publicUrl = `${CHAT_MEDIA_PUBLIC_PREFIX}${fileName}`;

  const uploadDir = path.join(process.cwd(), ...CHAT_MEDIA_DIR_SEGMENTS);
  const filePath = path.join(uploadDir, fileName);

  // Idempotencia: si el binario ya existe (mismo hash), no reescribir.
  if (await fileExists(filePath)) {
    return publicUrl;
  }

  await mkdir(uploadDir, { recursive: true });
  await writeFile(filePath, parsed.buffer);

  return publicUrl;
}
