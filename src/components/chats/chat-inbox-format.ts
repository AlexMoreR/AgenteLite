import { PhoneIncoming, PhoneOutgoing } from "lucide-react";
import type { SharedInboxMessageItem } from "./chat-inbox-types";

export const CHAT_TIME_ZONE = "America/Bogota";

// Normaliza texto para búsqueda de chats: minúsculas y sin tildes/diacríticos, para que
// "envios" encuentre "Envíos" y "rafa" encuentre "Rafaél".
export function normalizeChatSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export const chatDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CHAT_TIME_ZONE,
});
export const chatDateLabelFormatter = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  timeZone: CHAT_TIME_ZONE,
});
export const chatTimeFormatter = new Intl.DateTimeFormat("es-CO", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: CHAT_TIME_ZONE,
});

export function formatChatTime(value: Date) {
  return chatTimeFormatter.format(value).replace(/\u00a0/g, " ");
}

export const activityDateTimeFormatter = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: CHAT_TIME_ZONE,
});

export function formatActivityDate(value: Date) {
  return activityDateTimeFormatter.format(value).replace(/\u00a0/g, " ");
}

// Un mensaje SYSTEM marcado como actividad (asignación, resuelto, etiqueta, etapa…).
export function isActivityMessage(message: SharedInboxMessageItem) {
  if (message.type !== "SYSTEM") return false;
  const rp = message.rawPayload;
  return Boolean(rp && typeof rp === "object" && !Array.isArray(rp) && (rp as { source?: unknown }).source === "activity");
}

export function getMediaPreviewLabel(type?: SharedInboxMessageItem["type"] | null) {
  if (type === "AUDIO") return "Audio";
  if (type === "IMAGE") return "Foto";
  if (type === "VIDEO") return "Video";
  if (type === "STICKER") return "Sticker";
  if (type === "DOCUMENT") return "Documento";
  return null;
}

export function getMessagePreviewText(message?: SharedInboxMessageItem | null) {
  if (!message) {
    return null;
  }

  if (message.deletedAt) {
    return "Mensaje eliminado";
  }

  const content = message.content?.trim();
  if (content) {
    return content;
  }

  return null;
}

export function getCallMessageSummary(message: SharedInboxMessageItem) {
  if (message.type !== "SYSTEM") {
    return null;
  }

  const content = message.content?.trim();
  if (!content || !/^llamada\s+/i.test(content)) {
    return null;
  }

  const directionLabel = message.direction === "OUTBOUND" ? "saliente" : "entrante";
  const statusText = content.replace(/^llamada\s+(entrante|saliente)\s*/i, "").trim();

  return {
    directionLabel,
    statusText,
    icon: message.direction === "OUTBOUND" ? PhoneOutgoing : PhoneIncoming,
  };
}

export function formatDateDivider(date: Date) {
  return chatDateLabelFormatter.format(date);
}
