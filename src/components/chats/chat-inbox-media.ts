import { File as FileIcon, FileSpreadsheet, FileText } from "lucide-react";
import type { SharedInboxMessageItem } from "./chat-inbox-types";

export function isMediaSourceUrl(url?: string | null) {
  if (!url) {
    return false;
  }

  const normalized = url.trim().toLowerCase();
  if (isWhatsAppCdnMediaSourceUrl(normalized)) {
    return false;
  }

  return (
    normalized.startsWith("data:") ||
    normalized.startsWith("blob:") ||
    normalized.startsWith("/api/media/proxy") ||
    normalized.startsWith("/") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://")
  );
}

export function isWhatsAppCdnMediaSourceUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "whatsapp.net" || host.endsWith(".whatsapp.net");
  } catch {
    return false;
  }
}

export function toProxiedMediaUrl(url: string) {
  if (
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("/api/media/proxy") ||
    // Medios ya persistidos en nuestro almacenamiento: los sirve Next directo desde
    // /public, no deben pasar por el proxy (que resolveria "/..." contra Evolution).
    url.startsWith("/uploads/")
  ) {
    return url;
  }

  return `/api/media/proxy?url=${encodeURIComponent(url)}`;
}

export function uniquePush(values: string[], candidate?: string | null) {
  if (!candidate) {
    return;
  }

  const normalized = candidate.trim();
  if (!normalized || values.includes(normalized)) {
    return;
  }

  values.push(normalized);
}

export type MediaUrlType = "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT";

export const mediaUrlExtractionCache = new WeakMap<object, Map<MediaUrlType, string | null>>();
export const imagePreviewUrlCache = new WeakMap<object, string[]>();

export function getMediaUrlExtractionCacheEntry(rawPayload: unknown) {
  if (!isObjectRecord(rawPayload)) {
    return null;
  }

  let cacheEntry = mediaUrlExtractionCache.get(rawPayload);

  if (!cacheEntry) {
    cacheEntry = new Map<MediaUrlType, string | null>();
    mediaUrlExtractionCache.set(rawPayload, cacheEntry);
  }

  return cacheEntry;
}

export function extractMediaUrlFromPayload(message: SharedInboxMessageItem, type: "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT") {
  if (typeof message.mediaUrl === "string" && isMediaSourceUrl(message.mediaUrl)) {
    return toProxiedMediaUrl(message.mediaUrl);
  }

  const cacheEntry = getMediaUrlExtractionCacheEntry(message.rawPayload);
  const cachedValue = cacheEntry?.get(type);

  if (cachedValue !== undefined) {
    return cachedValue;
  }

  const rootPayload = getNestedRecord(message.rawPayload, "evolution") ?? (isObjectRecord(message.rawPayload) ? message.rawPayload : null);
  const data = getNestedRecord(rootPayload, "data");
  const messageData = getNestedRecord(data, "message") ?? getNestedRecord(rootPayload, "message");
  const nestedMessage =
    type === "IMAGE"
      ? getNestedRecord(messageData, "imageMessage")
      : type === "AUDIO"
        ? getNestedRecord(messageData, "audioMessage")
        : type === "VIDEO"
          ? getNestedRecord(messageData, "videoMessage")
          : type === "STICKER"
            ? getNestedRecord(messageData, "stickerMessage")
          : getNestedRecord(messageData, "documentMessage");

  const candidate =
    getNestedString(nestedMessage, "url") ||
    getNestedString(nestedMessage, "URL") ||
    getNestedString(nestedMessage, "directPath") ||
    getNestedString(data, "mediaUrl") ||
    getNestedString(data, "media") ||
    getNestedString(data, "url") ||
    message.mediaUrl ||
    null;

  const resolvedUrl = typeof candidate === "string" && isMediaSourceUrl(candidate) ? toProxiedMediaUrl(candidate) : null;

  cacheEntry?.set(type, resolvedUrl);

  return resolvedUrl;
}

export function formatDocumentSize(bytes?: number | null) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getDocumentTypeLabel(fileName: string, mimeType?: string | null) {
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.trim().toUpperCase() : "";
  if (ext && ext.length <= 5) return ext;
  if (mimeType?.toLowerCase().includes("pdf")) return "PDF";
  const subtype = mimeType?.split("/")[1]?.trim();
  if (subtype) return subtype.toUpperCase().slice(0, 5);
  return "ARCHIVO";
}

// Ícono coloreado según el tipo de documento (PDF rojo, Word azul, Excel verde, etc.).
export function getDocumentIcon(typeLabel: string) {
  const type = typeLabel.toUpperCase();
  if (type === "PDF") return { Icon: FileText, color: "#e2433a" };
  if (type === "DOC" || type === "DOCX") return { Icon: FileText, color: "#2b7cd3" };
  if (type === "XLS" || type === "XLSX" || type === "CSV") return { Icon: FileSpreadsheet, color: "#1d8f4e" };
  if (type === "PPT" || type === "PPTX") return { Icon: FileText, color: "#d24726" };
  return { Icon: FileIcon, color: "#64748b" };
}

// Extrae nombre / tipo / tamaño del documento desde el mensaje, soportando tanto el envío
// manual (lo que guarda sendChatMediaReplyAction: fileName/mimeType/fileSize) como el
// payload de Evolution (entrante: documentMessage.{fileName, mimetype, fileLength}).
export function getDocumentMetaFromMessage(message: SharedInboxMessageItem) {
  const raw = message.rawPayload;

  const manualName = getNestedString(raw, "fileName");
  const manualMime = getNestedString(raw, "mimeType");
  const manualSizeValue = isObjectRecord(raw) ? raw.fileSize : null;
  const manualSize = typeof manualSizeValue === "number" ? manualSizeValue : null;

  const root = getNestedRecord(raw, "evolution") ?? (isObjectRecord(raw) ? raw : null);
  const data = getNestedRecord(root, "data");
  const messageData = getNestedRecord(data, "message") ?? getNestedRecord(root, "message");
  const captionWrapper = getNestedRecord(messageData, "documentWithCaptionMessage");
  const captionMessage = getNestedRecord(captionWrapper, "message");
  const doc =
    getNestedRecord(messageData, "documentMessage") ??
    getNestedRecord(captionMessage, "documentMessage");
  const docName = getNestedString(doc, "fileName") || getNestedString(doc, "title");
  const docMime = getNestedString(doc, "mimetype");
  const docLengthRaw = doc?.fileLength;
  const docSize =
    typeof docLengthRaw === "number"
      ? docLengthRaw
      : typeof docLengthRaw === "string" && /^\d+$/.test(docLengthRaw)
        ? Number(docLengthRaw)
        : null;

  const fileName = (manualName || docName || "Documento").trim() || "Documento";
  const mimeType = manualMime || docMime || null;
  const size = manualSize ?? docSize ?? null;

  return {
    fileName,
    typeLabel: getDocumentTypeLabel(fileName, mimeType),
    sizeLabel: formatDocumentSize(size),
  };
}

export type ChatAdPreview = {
  title: string;
  body?: string | null;
  sourceUrl?: string | null;
  thumbnailUrl?: string | null;
  sourceApp?: string | null;
};

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getNestedRecord(value: unknown, key: string) {
  if (!isObjectRecord(value)) {
    return null;
  }

  const nested = value[key];
  return isObjectRecord(nested) ? nested : null;
}

export function getNestedString(value: unknown, key: string) {
  if (!isObjectRecord(value)) {
    return null;
  }

  const nested = value[key];
  return typeof nested === "string" && nested.trim().length > 0 ? nested : null;
}

export function getNestedValue(value: unknown, key: string) {
  if (!isObjectRecord(value) || !(key in value)) {
    return null;
  }

  return value[key];
}

export function bytesLikeToBase64(value: unknown) {
  const toBase64 = (bytes: number[]) => {
    if (bytes.length === 0) {
      return null;
    }

    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    if (typeof window !== "undefined" && typeof window.btoa === "function") {
      return window.btoa(binary);
    }

    if (typeof Buffer !== "undefined") {
      return Buffer.from(binary, "binary").toString("base64");
    }

    return null;
  };

  if (value instanceof Uint8Array) {
    return toBase64(Array.from(value));
  }

  if (Array.isArray(value)) {
    const bytes = value.filter((item): item is number => typeof item === "number");
    return toBase64(bytes);
  }

  if (!isObjectRecord(value)) {
    return null;
  }

  const numericEntries = Object.entries(value)
    .filter(([key, entryValue]) => /^\d+$/.test(key) && typeof entryValue === "number")
    .sort((left, right) => Number(left[0]) - Number(right[0]))
    .map(([, entryValue]) => entryValue as number);

  return toBase64(numericEntries);
}

export function collectImagePreviewUrls(message: SharedInboxMessageItem) {
  if (isObjectRecord(message.rawPayload)) {
    const cachedPreviewUrls = imagePreviewUrlCache.get(message.rawPayload);

    if (cachedPreviewUrls) {
      return cachedPreviewUrls;
    }
  }

  const previewUrls: string[] = [];

  if (typeof message.mediaUrl === "string" && isMediaSourceUrl(message.mediaUrl)) {
    uniquePush(previewUrls, toProxiedMediaUrl(message.mediaUrl));
    uniquePush(previewUrls, message.mediaUrl);
  }

  const rootPayload = getNestedRecord(message.rawPayload, "evolution") ?? (isObjectRecord(message.rawPayload) ? message.rawPayload : null);
  const data = getNestedRecord(rootPayload, "data");
  const messageData = getNestedRecord(data, "message") ?? getNestedRecord(rootPayload, "message");
  const imageMessage = getNestedRecord(messageData, "imageMessage");
  const directImageUrl =
    getNestedString(imageMessage, "url") ||
    getNestedString(imageMessage, "URL") ||
    getNestedString(imageMessage, "directPath") ||
    getNestedString(data, "mediaUrl") ||
    getNestedString(data, "media") ||
    getNestedString(data, "url");

  if (typeof directImageUrl === "string" && isMediaSourceUrl(directImageUrl)) {
    uniquePush(previewUrls, toProxiedMediaUrl(directImageUrl));
    uniquePush(previewUrls, directImageUrl);
  }

  const thumbnailBytes =
    getNestedValue(imageMessage, "jpegThumbnail") ??
    getNestedValue(imageMessage, "thumbnail") ??
    getNestedValue(getNestedRecord(getNestedRecord(data, "contextInfo"), "externalAdReply"), "thumbnail");

  const base64 = bytesLikeToBase64(thumbnailBytes);

  if (base64) {
    uniquePush(previewUrls, `data:image/jpeg;base64,${base64}`);
  }

  if (isObjectRecord(message.rawPayload)) {
    imagePreviewUrlCache.set(message.rawPayload, previewUrls);
  }

  return previewUrls;
}

export function extractChatAdPreview(rawPayload: unknown): ChatAdPreview | null {
  const rootPayload = getNestedRecord(rawPayload, "evolution") ?? (isObjectRecord(rawPayload) ? rawPayload : null);
  const data = getNestedRecord(rootPayload, "data");
  const contextInfo = getNestedRecord(data, "contextInfo") ?? getNestedRecord(rootPayload, "contextInfo");
  const externalAdReply = getNestedRecord(contextInfo, "externalAdReply");

  if (!externalAdReply) {
    return null;
  }

  const title = getNestedString(externalAdReply, "title");

  if (!title) {
    return null;
  }

  return {
    title,
    body: getNestedString(externalAdReply, "body"),
    sourceUrl: getNestedString(externalAdReply, "sourceUrl"),
    thumbnailUrl: getNestedString(externalAdReply, "thumbnailUrl"),
    sourceApp: getNestedString(externalAdReply, "sourceApp"),
  };
}

// Helpers para detectar montaje en cliente sin setState en efecto (evita el mismatch
// de hidratación del DropdownMenu de base-ui).
