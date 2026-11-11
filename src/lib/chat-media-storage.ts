import { mkdir, writeFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { EXTENSION_PARA_ESCUCHAR, convertirAudioParaEscuchar } from "@/lib/audio-para-escuchar";
// Carpeta servida por Next desde /public (la misma que la subida manual de medios,
// src/app/api/cliente/chats/upload-media), el limite de 60 MB y el nombre por hash viven en
// guardar-archivo-de-chat.ts: lo comparten este archivo, la red de prisma.ts y la migracion.
import {
  CHAT_MEDIA_DIR_SEGMENTS,
  CHAT_MEDIA_PUBLIC_PREFIX,
  MAX_PERSISTED_MEDIA_BYTES,
  extensionForMime,
  guardarBytesDeChat,
  type PersistableMediaType,
} from "@/lib/guardar-archivo-de-chat";

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
  const uploadDir = path.join(process.cwd(), ...CHAT_MEDIA_DIR_SEGMENTS);

  /*
    Los audios se guardan en un formato que suene en todos los navegadores (ver
    audio-para-escuchar). El nombre sigue saliendo del hash del ORIGINAL, asi que un reintento del
    webhook encuentra la copia ya convertida y no vuelve a convertir.
  */
  if (input.mediaType === "AUDIO") {
    const nombreConvertido = `${hash}${EXTENSION_PARA_ESCUCHAR}`;
    const rutaConvertida = path.join(uploadDir, nombreConvertido);
    if (await fileExists(rutaConvertida)) {
      return `${CHAT_MEDIA_PUBLIC_PREFIX}${nombreConvertido}`;
    }
    const convertido = await convertirAudioParaEscuchar(parsed.buffer, ext);
    if (convertido) {
      await mkdir(uploadDir, { recursive: true });
      await writeFile(rutaConvertida, convertido);
      return `${CHAT_MEDIA_PUBLIC_PREFIX}${nombreConvertido}`;
    }
  }

  // Mismo nombre de siempre (`<hash><ext>`). Idempotencia: si el binario ya existe (mismo hash), no
  // se reescribe y se confia en el, como siempre. Lo nuevo: se escribe a un temporal y se renombra.
  const guardado = await guardarBytesDeChat({
    bytes: parsed.buffer,
    mimeType: parsed.mimeType,
    mediaType: input.mediaType,
    comprobar: "nada",
    carpeta: uploadDir,
  });

  return guardado.enlace;
}
