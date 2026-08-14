import path from "node:path";

/**
 * Reglas de subida de archivos del chat, en un solo lugar.
 *
 * Hay DOS caminos para subir —de una sola vez y por pedazos— y tienen que aceptar exactamente lo
 * mismo. Si cada uno tuviera su propia lista, un formato permitido por uno y bloqueado por el otro
 * haria que el mismo archivo suba o no segun su tamaño, que es la clase de error que nadie
 * entiende cuando esta apurado atendiendo a un cliente.
 */

// 100 MB es el tope de WhatsApp para documentos: por encima no lo recibe ni el cliente.
export const MAX_FILE_SIZE_MB = 100;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/pdf",
]);

export function getExtensionForMime(mimeType: string, originalName: string) {
  const fromName = path.extname(originalName).toLowerCase();
  if (fromName) return fromName === ".jpeg" ? ".jpg" : fromName;
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("gif")) return ".gif";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return ".jpg";
  if (mimeType.includes("quicktime")) return ".mov";
  if (mimeType.includes("webm")) return ".webm";
  if (mimeType.includes("mp4")) return ".mp4";
  if (mimeType.includes("pdf")) return ".pdf";
  return ".bin";
}

export function resolveMediaType(baseMimeType: string) {
  if (baseMimeType.startsWith("image/")) return "IMAGE" as const;
  if (baseMimeType.startsWith("video/")) return "VIDEO" as const;
  return "DOCUMENT" as const;
}

export function getBaseUrl(request: Request) {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = request.headers.get("host")?.trim();

  if (forwardedHost) {
    return `${forwardedProto || "https"}://${forwardedHost}`;
  }

  if (host) {
    const protocol = forwardedProto || (host.includes("localhost") ? "http" : "https");
    return `${protocol}://${host}`;
  }

  return process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
}

export const CHAT_MEDIA_DIR = ["public", "uploads", "chat-media"] as const;
export const CHAT_MEDIA_TMP_DIR = ["public", "uploads", "chat-media-tmp"] as const;

/**
 * El id de una subida por pedazos viaja en el cuerpo y termina siendo un nombre de archivo. Si no
 * se limpiara, un id con ".." escribiria fuera de la carpeta.
 */
export function sanitizeUploadId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const limpio = value.trim().toLowerCase();
  return /^[a-z0-9-]{8,64}$/.test(limpio) ? limpio : null;
}
