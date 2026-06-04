"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type ComponentType, type FormEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  ArrowLeft,
  BadgeCheck,
  Bot,
  CarFront,
  Clock3,
  ChevronRight,
  CheckCheck,
  Coffee,
  Facebook,
  Flag,
  Flower2,
  Grid2x2,
  Lightbulb,
  MessageCircle,
  MessageSquareText,
  LoaderCircle,
  Pencil,
  PhoneIncoming,
  PhoneOutgoing,
  ChevronUp,
  Search,
  SendHorizonal,
  Shapes,
  Smile,
  Tag,
  Trash2,
  UserRound,
  Users,
  X,
  Sidebar,
} from "lucide-react";
import { ChatScrollAnchor } from "@/components/agents/chat-scroll-anchor";
import { ChatSelectionOverlay } from "@/components/chats/chat-selection-overlay";
import { ContactAvatar } from "@/components/chats/contact-avatar";
import {
  mergeConversationSnapshots,
  readConversationFromCache,
  saveConversationToCache,
} from "@/components/chats/chat-history-cache";
import { EditContactModal } from "@/components/chats/edit-contact-modal";
import { EtiquetaModal } from "@/components/chats/etiqueta-modal";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  clearPendingConversationSelection,
  usePendingConversationSelection,
  type PendingChatSelection,
} from "./chat-selection-store";
import { AppSidebar } from "./appsidebar";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../ui/breadcrumb";
import { SidebarHeader, SidebarInput } from "../ui/sidebar";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";

const CHAT_TIME_ZONE = "America/Bogota";
const CONVERSATION_LIST_LOAD_BATCH_SIZE = 10;
const CHAT_LIST_DEBUG = process.env.NODE_ENV !== "production";
const CHAT_COMPOSER_RECENT_KEY = "shared-inbox:composer-recent-emojis";

type ComposerEmojiCategory =
  | "caras"
  | "personas"
  | "naturaleza"
  | "comida"
  | "viajes"
  | "objetos"
  | "simbolos"
  | "banderas";

type ComposerEmoji = {
  emoji: string;
  label: string;
  category: ComposerEmojiCategory;
  keywords: string[];
};

const CHAT_COMPOSER_EMOJI_GROUPS: Record<ComposerEmojiCategory, ComposerEmoji[]> = {
  caras: [
    { emoji: "😀", label: "sonrisa", category: "caras", keywords: ["feliz", "alegre"] },
    { emoji: "😁", label: "sonrisa abierta", category: "caras", keywords: ["feliz", "dientes"] },
    { emoji: "😂", label: "risa", category: "caras", keywords: ["feliz", "broma"] },
    { emoji: "🤣", label: "carcajada", category: "caras", keywords: ["risa", "broma"] },
    { emoji: "😃", label: "alegría", category: "caras", keywords: ["feliz"] },
    { emoji: "😄", label: "entusiasmo", category: "caras", keywords: ["feliz", "energía"] },
    { emoji: "😅", label: "alivio", category: "caras", keywords: ["nervios", "sudor"] },
    { emoji: "😆", label: "diversión", category: "caras", keywords: ["risa"] },
    { emoji: "😉", label: "guiño", category: "caras", keywords: ["cómplice"] },
    { emoji: "😊", label: "amabilidad", category: "caras", keywords: ["sonrisa"] },
    { emoji: "🙂", label: "tranquilo", category: "caras", keywords: ["sereno"] },
    { emoji: "🙃", label: "irónico", category: "caras", keywords: ["broma"] },
    { emoji: "😍", label: "amor", category: "caras", keywords: ["corazones"] },
    { emoji: "🥰", label: "cariño", category: "caras", keywords: ["afecto"] },
    { emoji: "😘", label: "beso", category: "caras", keywords: ["amor"] },
    { emoji: "😗", label: "beso suave", category: "caras", keywords: ["amor"] },
    { emoji: "😜", label: "pícara", category: "caras", keywords: ["broma"] },
    { emoji: "🤪", label: "locura", category: "caras", keywords: ["broma"] },
    { emoji: "🤗", label: "abrazo", category: "caras", keywords: ["cariño"] },
    { emoji: "🤭", label: "sorpresa", category: "caras", keywords: ["vergüenza"] },
    { emoji: "🤔", label: "pensativo", category: "caras", keywords: ["duda"] },
    { emoji: "🤨", label: "escéptico", category: "caras", keywords: ["duda"] },
    { emoji: "😐", label: "neutral", category: "caras", keywords: ["serio"] },
    { emoji: "😑", label: "sin reacción", category: "caras", keywords: ["serio"] },
    { emoji: "😶", label: "silencio", category: "caras", keywords: ["callado"] },
    { emoji: "😏", label: "sarcástico", category: "caras", keywords: ["guiño"] },
    { emoji: "🙄", label: "desagrado", category: "caras", keywords: ["ojos"] },
    { emoji: "😌", label: "alivio", category: "caras", keywords: ["calma"] },
    { emoji: "😔", label: "triste", category: "caras", keywords: ["pena"] },
    { emoji: "😴", label: "sueño", category: "caras", keywords: ["cansancio"] },
    { emoji: "😎", label: "confianza", category: "caras", keywords: ["cool"] },
    { emoji: "😭", label: "llanto", category: "caras", keywords: ["triste", "lágrimas"] },
  ],
  personas: [
    { emoji: "👋", label: "saludo", category: "personas", keywords: ["hola"] },
    { emoji: "✋", label: "alto", category: "personas", keywords: ["espera"] },
    { emoji: "👌", label: "ok", category: "personas", keywords: ["bien"] },
    { emoji: "🤌", label: "énfasis", category: "personas", keywords: ["italiano"] },
    { emoji: "🤞", label: "suerte", category: "personas", keywords: ["deseo"] },
    { emoji: "🤟", label: "te quiero", category: "personas", keywords: ["amor"] },
    { emoji: "🤘", label: "rock", category: "personas", keywords: ["música"] },
    { emoji: "🤙", label: "llámame", category: "personas", keywords: ["teléfono"] },
    { emoji: "👍", label: "aprobación", category: "personas", keywords: ["bien"] },
    { emoji: "👎", label: "desaprobación", category: "personas", keywords: ["no"] },
    { emoji: "👏", label: "aplauso", category: "personas", keywords: ["felicitación"] },
    { emoji: "🙌", label: "celebración", category: "personas", keywords: ["fiesta"] },
    { emoji: "👐", label: "abierto", category: "personas", keywords: ["recibir"] },
    { emoji: "🤲", label: "ofrecer", category: "personas", keywords: ["ayuda"] },
    { emoji: "🙏", label: "gracias", category: "personas", keywords: ["oración"] },
    { emoji: "💪", label: "fuerza", category: "personas", keywords: ["poder"] },
    { emoji: "🫶", label: "afecto", category: "personas", keywords: ["amor"] },
    { emoji: "🤝", label: "acuerdo", category: "personas", keywords: ["trato"] },
    { emoji: "🫂", label: "abrazo", category: "personas", keywords: ["cariño"] },
    { emoji: "💃", label: "baile", category: "personas", keywords: ["fiesta"] },
    { emoji: "🕺", label: "baile", category: "personas", keywords: ["fiesta"] },
    { emoji: "🚶", label: "caminar", category: "personas", keywords: ["andar"] },
    { emoji: "🏃", label: "correr", category: "personas", keywords: ["rápido"] },
    { emoji: "🧠", label: "mente", category: "personas", keywords: ["idea"] },
  ],
  naturaleza: [
    { emoji: "🌞", label: "sol", category: "naturaleza", keywords: ["día"] },
    { emoji: "🌝", label: "luna llena", category: "naturaleza", keywords: ["noche"] },
    { emoji: "🌙", label: "luna", category: "naturaleza", keywords: ["noche"] },
    { emoji: "⭐", label: "estrella", category: "naturaleza", keywords: ["brillo"] },
    { emoji: "✨", label: "destello", category: "naturaleza", keywords: ["brillo"] },
    { emoji: "⚡", label: "energía", category: "naturaleza", keywords: ["rápido"] },
    { emoji: "🔥", label: "fuego", category: "naturaleza", keywords: ["intenso"] },
    { emoji: "🌈", label: "arcoíris", category: "naturaleza", keywords: ["colores"] },
    { emoji: "☁️", label: "nube", category: "naturaleza", keywords: ["cielo"] },
    { emoji: "🌧️", label: "lluvia", category: "naturaleza", keywords: ["agua"] },
    { emoji: "⛈️", label: "tormenta", category: "naturaleza", keywords: ["lluvia"] },
    { emoji: "❄️", label: "nieve", category: "naturaleza", keywords: ["frío"] },
    { emoji: "🌊", label: "ola", category: "naturaleza", keywords: ["mar"] },
    { emoji: "🌷", label: "tulipán", category: "naturaleza", keywords: ["flor"] },
    { emoji: "🌹", label: "rosa", category: "naturaleza", keywords: ["flor", "amor"] },
    { emoji: "🌸", label: "flor", category: "naturaleza", keywords: ["primavera"] },
    { emoji: "🌻", label: "girasol", category: "naturaleza", keywords: ["flor"] },
    { emoji: "🍀", label: "suerte", category: "naturaleza", keywords: ["trébol"] },
    { emoji: "🌴", label: "palmera", category: "naturaleza", keywords: ["playa"] },
    { emoji: "🌵", label: "cactus", category: "naturaleza", keywords: ["desierto"] },
    { emoji: "🐶", label: "perro", category: "naturaleza", keywords: ["mascota"] },
    { emoji: "🐱", label: "gato", category: "naturaleza", keywords: ["mascota"] },
    { emoji: "🐻", label: "oso", category: "naturaleza", keywords: ["animal"] },
    { emoji: "🦁", label: "león", category: "naturaleza", keywords: ["animal"] },
    { emoji: "🦋", label: "mariposa", category: "naturaleza", keywords: ["animal"] },
  ],
  comida: [
    { emoji: "🍏", label: "manzana verde", category: "comida", keywords: ["fruta"] },
    { emoji: "🍎", label: "manzana", category: "comida", keywords: ["fruta"] },
    { emoji: "🍌", label: "banano", category: "comida", keywords: ["fruta"] },
    { emoji: "🍉", label: "sandía", category: "comida", keywords: ["fruta"] },
    { emoji: "🍇", label: "uvas", category: "comida", keywords: ["fruta"] },
    { emoji: "🍓", label: "fresa", category: "comida", keywords: ["fruta"] },
    { emoji: "🫐", label: "arándanos", category: "comida", keywords: ["fruta"] },
    { emoji: "🍒", label: "cerezas", category: "comida", keywords: ["fruta"] },
    { emoji: "🍑", label: "durazno", category: "comida", keywords: ["fruta"] },
    { emoji: "🍍", label: "piña", category: "comida", keywords: ["fruta"] },
    { emoji: "🥝", label: "kiwi", category: "comida", keywords: ["fruta"] },
    { emoji: "🍅", label: "tomate", category: "comida", keywords: ["vegetal"] },
    { emoji: "🥑", label: "aguacate", category: "comida", keywords: ["vegetal"] },
    { emoji: "🥕", label: "zanahoria", category: "comida", keywords: ["vegetal"] },
    { emoji: "🌮", label: "taco", category: "comida", keywords: ["mexicano"] },
    { emoji: "🌯", label: "wrap", category: "comida", keywords: ["burrito"] },
    { emoji: "🍔", label: "hamburguesa", category: "comida", keywords: ["comida"] },
    { emoji: "🍟", label: "papas", category: "comida", keywords: ["fritas"] },
    { emoji: "🍕", label: "pizza", category: "comida", keywords: ["italiana"] },
    { emoji: "🍿", label: "crispetas", category: "comida", keywords: ["cine"] },
    { emoji: "🍩", label: "donut", category: "comida", keywords: ["dulce"] },
    { emoji: "🍪", label: "galleta", category: "comida", keywords: ["dulce"] },
    { emoji: "🍰", label: "pastel", category: "comida", keywords: ["torta"] },
    { emoji: "🧁", label: "cupcake", category: "comida", keywords: ["dulce"] },
    { emoji: "☕", label: "café", category: "comida", keywords: ["bebida"] },
    { emoji: "🧃", label: "jugo", category: "comida", keywords: ["bebida"] },
    { emoji: "🥤", label: "refresco", category: "comida", keywords: ["bebida"] },
  ],
  viajes: [
    { emoji: "🚗", label: "auto", category: "viajes", keywords: ["carro"] },
    { emoji: "🚕", label: "taxi", category: "viajes", keywords: ["carro"] },
    { emoji: "🚙", label: "SUV", category: "viajes", keywords: ["carro"] },
    { emoji: "🚌", label: "bus", category: "viajes", keywords: ["transporte"] },
    { emoji: "🚎", label: "trolebús", category: "viajes", keywords: ["transporte"] },
    { emoji: "🛵", label: "moto", category: "viajes", keywords: ["transporte"] },
    { emoji: "🏍️", label: "motocicleta", category: "viajes", keywords: ["transporte"] },
    { emoji: "🚲", label: "bicicleta", category: "viajes", keywords: ["transporte"] },
    { emoji: "✈️", label: "avión", category: "viajes", keywords: ["viaje"] },
    { emoji: "🚀", label: "cohete", category: "viajes", keywords: ["rápido"] },
    { emoji: "🚢", label: "barco", category: "viajes", keywords: ["mar"] },
    { emoji: "🚂", label: "tren", category: "viajes", keywords: ["transporte"] },
    { emoji: "🛫", label: "despegue", category: "viajes", keywords: ["viaje"] },
    { emoji: "🛬", label: "aterrizaje", category: "viajes", keywords: ["viaje"] },
    { emoji: "🗺️", label: "mapa", category: "viajes", keywords: ["ruta"] },
    { emoji: "🏖️", label: "playa", category: "viajes", keywords: ["vacaciones"] },
    { emoji: "🏝️", label: "isla", category: "viajes", keywords: ["vacaciones"] },
    { emoji: "⛰️", label: "montaña", category: "viajes", keywords: ["naturaleza"] },
    { emoji: "🌍", label: "planeta", category: "viajes", keywords: ["mundo"] },
    { emoji: "🌎", label: "mundo", category: "viajes", keywords: ["planeta"] },
    { emoji: "🌏", label: "tierra", category: "viajes", keywords: ["mundo"] },
  ],
  objetos: [
    { emoji: "📱", label: "teléfono", category: "objetos", keywords: ["móvil"] },
    { emoji: "💻", label: "portátil", category: "objetos", keywords: ["computador"] },
    { emoji: "🖥️", label: "escritorio", category: "objetos", keywords: ["computador"] },
    { emoji: "⌚", label: "reloj", category: "objetos", keywords: ["tiempo"] },
    { emoji: "📷", label: "cámara", category: "objetos", keywords: ["foto"] },
    { emoji: "🎥", label: "video", category: "objetos", keywords: ["cámara"] },
    { emoji: "🔊", label: "volumen", category: "objetos", keywords: ["audio"] },
    { emoji: "🔔", label: "notificación", category: "objetos", keywords: ["aviso"] },
    { emoji: "💡", label: "idea", category: "objetos", keywords: ["luz"] },
    { emoji: "🔑", label: "llave", category: "objetos", keywords: ["acceso"] },
    { emoji: "🛒", label: "carrito", category: "objetos", keywords: ["compra"] },
    { emoji: "📦", label: "paquete", category: "objetos", keywords: ["envío"] },
    { emoji: "🎁", label: "regalo", category: "objetos", keywords: ["detalle"] },
    { emoji: "📌", label: "pin", category: "objetos", keywords: ["fijar"] },
    { emoji: "🖊️", label: "bolígrafo", category: "objetos", keywords: ["escribir"] },
    { emoji: "✏️", label: "lápiz", category: "objetos", keywords: ["escribir"] },
    { emoji: "📚", label: "libros", category: "objetos", keywords: ["estudio"] },
    { emoji: "🧸", label: "peluche", category: "objetos", keywords: ["juguete"] },
    { emoji: "🧰", label: "herramientas", category: "objetos", keywords: ["reparar"] },
    { emoji: "🧾", label: "recibo", category: "objetos", keywords: ["factura"] },
    { emoji: "🧭", label: "brújula", category: "objetos", keywords: ["ruta"] },
  ],
  simbolos: [
    { emoji: "❤️", label: "corazón", category: "simbolos", keywords: ["amor"] },
    { emoji: "🧡", label: "corazón naranja", category: "simbolos", keywords: ["amor"] },
    { emoji: "💛", label: "corazón amarillo", category: "simbolos", keywords: ["amor"] },
    { emoji: "💚", label: "corazón verde", category: "simbolos", keywords: ["amor"] },
    { emoji: "💙", label: "corazón azul", category: "simbolos", keywords: ["amor"] },
    { emoji: "💜", label: "corazón morado", category: "simbolos", keywords: ["amor"] },
    { emoji: "🖤", label: "corazón negro", category: "simbolos", keywords: ["amor"] },
    { emoji: "🤍", label: "corazón blanco", category: "simbolos", keywords: ["amor"] },
    { emoji: "💯", label: "cien", category: "simbolos", keywords: ["perfecto"] },
    { emoji: "✅", label: "confirmación", category: "simbolos", keywords: ["ok"] },
    { emoji: "❌", label: "cancelar", category: "simbolos", keywords: ["no"] },
    { emoji: "❓", label: "pregunta", category: "simbolos", keywords: ["duda"] },
    { emoji: "❗", label: "alerta", category: "simbolos", keywords: ["urgente"] },
    { emoji: "➡️", label: "derecha", category: "simbolos", keywords: ["flecha"] },
    { emoji: "⬅️", label: "izquierda", category: "simbolos", keywords: ["flecha"] },
    { emoji: "⬆️", label: "arriba", category: "simbolos", keywords: ["flecha"] },
    { emoji: "⬇️", label: "abajo", category: "simbolos", keywords: ["flecha"] },
    { emoji: "➕", label: "más", category: "simbolos", keywords: ["sumar"] },
    { emoji: "➖", label: "menos", category: "simbolos", keywords: ["restar"] },
    { emoji: "♻️", label: "reciclar", category: "simbolos", keywords: ["repetir"] },
    { emoji: "🚫", label: "prohibido", category: "simbolos", keywords: ["no"] },
  ],
  banderas: [
    { emoji: "🇪🇸", label: "España", category: "banderas", keywords: ["español"] },
    { emoji: "🇲🇽", label: "México", category: "banderas", keywords: ["latam"] },
    { emoji: "🇨🇴", label: "Colombia", category: "banderas", keywords: ["latam"] },
    { emoji: "🇦🇷", label: "Argentina", category: "banderas", keywords: ["latam"] },
    { emoji: "🇨🇱", label: "Chile", category: "banderas", keywords: ["latam"] },
    { emoji: "🇵🇪", label: "Perú", category: "banderas", keywords: ["latam"] },
    { emoji: "🇻🇪", label: "Venezuela", category: "banderas", keywords: ["latam"] },
    { emoji: "🇺🇸", label: "Estados Unidos", category: "banderas", keywords: ["usa"] },
    { emoji: "🇵🇦", label: "Panamá", category: "banderas", keywords: ["latam"] },
    { emoji: "🇪🇨", label: "Ecuador", category: "banderas", keywords: ["latam"] },
    { emoji: "🇩🇴", label: "República Dominicana", category: "banderas", keywords: ["caribe"] },
    { emoji: "🇵🇷", label: "Puerto Rico", category: "banderas", keywords: ["caribe"] },
  ],
};

const CHAT_COMPOSER_EMOJIS = Object.values(CHAT_COMPOSER_EMOJI_GROUPS).flat();
const CHAT_COMPOSER_CATEGORY_ORDER: Array<"todos" | ComposerEmojiCategory> = [
  "todos",
  "caras",
  "personas",
  "naturaleza",
  "comida",
  "viajes",
  "objetos",
  "simbolos",
  "banderas",
];
type ComposerEmojiTab = "todos" | "recientes" | ComposerEmojiCategory;

const CHAT_COMPOSER_CATEGORY_LABELS: Record<ComposerEmojiTab, string> = {
  todos: "Todos",
  recientes: "Recientes",
  caras: "Caras",
  personas: "Personas",
  naturaleza: "Naturaleza",
  comida: "Comida",
  viajes: "Viajes",
  objetos: "Objetos",
  simbolos: "Símbolos",
  banderas: "Banderas",
};

const CHAT_COMPOSER_CATEGORY_ICONS: Record<ComposerEmojiTab, ComponentType<{ className?: string }>> = {
  todos: Grid2x2,
  recientes: Clock3,
  caras: Smile,
  personas: Users,
  naturaleza: Flower2,
  comida: Coffee,
  viajes: CarFront,
  objetos: Lightbulb,
  simbolos: Shapes,
  banderas: Flag,
};

function normalizeComposerEmojiSearch(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function debugConversationList(...args: unknown[]) {
  if (!CHAT_LIST_DEBUG) {
    return;
  }

  console.log("[SharedInbox][list]", ...args);
}

const chatDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CHAT_TIME_ZONE,
});
const chatDateLabelFormatter = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  timeZone: CHAT_TIME_ZONE,
});
const chatTimeFormatter = new Intl.DateTimeFormat("es-CO", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: CHAT_TIME_ZONE,
});

function formatChatTime(value: Date) {
  return chatTimeFormatter.format(value).replace(/\u00a0/g, " ");
}

type SharedInboxConversationItemLike = Partial<Omit<SharedInboxConversationItem, "lastMessageAt">> & {
  id?: string;
  key?: string;
  conversationId?: string;
  href?: string;
  lastMessageAt?: Date | string | null;
};

export type SharedInboxConversationItem = {
  id: string;
  source: "agent" | "official";
  agentId?: string | null;
  contactId?: string | null;
  label: string;
  secondaryLabel: string;
  tags?: Array<{
    label: string;
    color: string;
  }>;
  channelType?: "whatsapp" | "whatsapp_official" | "instagram" | "facebook";
  incomingCount?: number | null;
  avatarUrl?: string | null;
  lastMessage: string | null;
  lastMessageType?: SharedInboxMessageItem["type"] | null;
  lastMessageDirection?: "INBOUND" | "OUTBOUND" | null;
  lastMessageAt?: Date | null;
  href: string;
};

export type SharedInboxMessageItem = {
  id: string;
  content: string | null;
  direction: "INBOUND" | "OUTBOUND";
  createdAt: Date;
  editedAt?: Date | null;
  deletedAt?: Date | null;
  authorType?: "user" | "bot";
  outboundStatusLabel?: string | null;
  type?: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT" | "LOCATION" | "BUTTON" | "TEMPLATE" | "SYSTEM" | "INTERACTIVE";
  mediaUrl?: string | null;
  rawPayload?: unknown;
};

export type SharedInboxSelectedConversation = {
  id: string;
  label: string;
  secondaryLabel: string;
  tags?: Array<{
    label: string;
    color: string;
  }>;
  avatarUrl?: string | null;
  contactId?: string | null;
  contactName?: string | null;
  messages: SharedInboxMessageItem[];
  automationPaused?: boolean;
  loadMoreHref?: string | null;
  loadMoreCursor?: string | null;
  hasMoreMessages?: boolean;
  cacheKey?: string | null;
  isPreview?: boolean;
};

export type SharedInboxStatusMessageItem = {
  id: string;
  content: string | null;
  type?: SharedInboxMessageItem["type"] | null;
  createdAt: Date;
  mediaUrl?: string | null;
};

type OptimisticDraftMessage = SharedInboxMessageItem & {
  conversationId: string;
  isOptimistic: true;
};

type LiveConversationSnapshot = SharedInboxSelectedConversation & {
  messages: Array<SharedInboxMessageItem & { createdAt: Date }>;
};

type LiveConversationListSnapshot = SharedInboxConversationItem & {
  lastMessageAt: Date | null;
};

type ConversationContactUpdateDetail = {
  contactId: string;
  name: string;
};

type ConversationTagsUpdateDetail = {
  contactId: string;
  tags: Array<{
    label: string;
    color: string;
  }>;
};

function buildPendingConversationPreview(
  pendingConversation: PendingChatSelection,
): SharedInboxSelectedConversation {
  const lastMessage =
    pendingConversation.lastMessage?.trim() ||
    getMediaPreviewLabel(pendingConversation.lastMessageType) ||
    "";
  const direction = pendingConversation.lastMessageDirection || "INBOUND";
  const createdAt = pendingConversation.lastMessageAt ? new Date(pendingConversation.lastMessageAt) : new Date();
  const previewMessages = lastMessage
    ? [
        {
          id: `${pendingConversation.cacheKey ?? pendingConversation.id}:preview`,
          content: lastMessage,
          direction,
          createdAt,
          authorType: direction === "OUTBOUND" ? "bot" : "user",
          type: pendingConversation.lastMessageType ?? "TEXT",
        } satisfies SharedInboxMessageItem,
      ]
    : [];

  return {
    id: pendingConversation.id,
    label: pendingConversation.label,
    secondaryLabel: pendingConversation.secondaryLabel,
    avatarUrl: pendingConversation.avatarUrl ?? null,
    tags: pendingConversation.tags ?? [],
    contactId: null,
    contactName: null,
    messages: previewMessages,
    cacheKey: pendingConversation.cacheKey ?? pendingConversation.id,
    isPreview: true,
  };
}

function getMediaPreviewLabel(type?: SharedInboxMessageItem["type"] | null) {
  if (type === "AUDIO") return "Audio";
  if (type === "IMAGE") return "Foto";
  if (type === "VIDEO") return "Video";
  if (type === "STICKER") return "Sticker";
  if (type === "DOCUMENT") return "Documento";
  return null;
}

function buildComposerHiddenFields(
  baseFields: Array<{ name: string; value: string }>,
  selectedConversation: PendingChatSelection | null,
) {
  if (!selectedConversation) {
    return baseFields;
  }

  const nextFields = [...baseFields];
  const upsertField = (name: string, value: string) => {
    const index = nextFields.findIndex((field) => field.name === name);
    if (index >= 0) {
      nextFields[index] = { name, value };
      return;
    }

    nextFields.push({ name, value });
  };

  upsertField("source", selectedConversation.source || "agent");
  upsertField("conversationId", selectedConversation.id);
  upsertField("agentId", selectedConversation.source === "agent" ? (selectedConversation.agentId ?? "") : "");

  return nextFields;
}

export type SharedInboxSidebarItem = {
  id: string;
  label: string;
  helper?: string;
  href: string;
  isActive?: boolean;
  channelType?: SharedInboxConversationItem["channelType"];
};

type SharedInboxProps = {
  searchAction: string;
  selectedConversationId: string;
  mobileConversationActive?: boolean;
  searchQuery: string;
  selectedConnectionKey?: string;
  conversationListApiPath?: string;
  initialConversationBatchSize?: number;
  initialHasMoreConversations?: boolean;
  sidebarItems?: SharedInboxSidebarItem[];
  conversations: SharedInboxConversationItem[];
  selectedConversation: SharedInboxSelectedConversation | null;
  selectedConversationTags?: Array<{
    label: string;
    color: string;
  }>;
  statusMessages?: SharedInboxStatusMessageItem[];
  backHref: string;
  headerBadge?: ReactNode;
  headerActions?: ReactNode;
  composer?: {
    action: (formData: FormData) => void | Promise<void>;
    hiddenFields: Array<{ name: string; value: string }>;
    placeholder?: string;
  };
  emptyListTitle: string;
  emptyListDescription: string;
  emptySelectionTitle: string;
  emptySelectionDescription: string;
  messageScrollBehavior?: "bottom" | "preserve";
};

function countIncomingMessagesSinceLastOutbound(messages: SharedInboxMessageItem[]) {
  let incomingCount = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.direction === "OUTBOUND") {
      break;
    }

    if (message.direction === "INBOUND") {
      incomingCount += 1;
    }
  }

  return incomingCount;
}

function getMessagePreviewText(message?: SharedInboxMessageItem | null) {
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

function normalizeLiveConversationSnapshot(value: unknown): LiveConversationSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const data = value as {
    id?: unknown;
    messages?: Array<{ createdAt?: string | Date; editedAt?: string | Date | null; deletedAt?: string | Date | null } & Record<string, unknown>>;
  };

  if (typeof data.id !== "string" || !Array.isArray(data.messages)) {
    return null;
  }

  return {
    ...(value as SharedInboxSelectedConversation),
    id: data.id,
    // Normalizar a ASC (oldest-first) para que la conversación siga el orden natural.
    messages: data.messages
      .map((message) => ({
        ...(message as SharedInboxMessageItem),
        createdAt: new Date(message.createdAt || Date.now()),
        editedAt: message.editedAt ? new Date(message.editedAt) : null,
        deletedAt: message.deletedAt ? new Date(message.deletedAt) : null,
      }))
      .sort((a, b) => {
        const diff = a.createdAt.getTime() - b.createdAt.getTime();
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      }),
  };
}

function normalizeLiveConversationListSnapshot(value: unknown): LiveConversationListSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const data = value as {
    id?: unknown;
    lastMessageAt?: string | Date | null;
  };

  if (typeof data.id !== "string") {
    return null;
  }

  return {
    ...(value as SharedInboxConversationItem),
    id: data.id,
    lastMessageAt: data.lastMessageAt ? new Date(data.lastMessageAt) : null,
  };
}

function getConversationLastMessageTimestamp(value: Date | string | null | undefined) {
  if (!value) {
    return 0;
  }

  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeConversationItem(item: SharedInboxConversationItemLike, fallbackHref = ""): SharedInboxConversationItem {
  const resolvedId =
    typeof item.id === "string" && item.id.trim()
      ? item.id
      : typeof item.key === "string" && item.key.trim()
        ? item.key
        : typeof item.conversationId === "string" && item.conversationId.trim()
          ? item.conversationId
          : "";
  const lastMessageAt = item.lastMessageAt ? new Date(item.lastMessageAt) : null;
  return {
    ...item,
    id: resolvedId,
    source: item.source === "official" ? "official" : "agent",
    label: item.label ?? "",
    secondaryLabel: item.secondaryLabel ?? "",
    lastMessage: item.lastMessage ?? null,
    href: item.href?.trim() || fallbackHref,
    lastMessageAt: lastMessageAt && Number.isFinite(lastMessageAt.getTime()) ? lastMessageAt : null,
  };
}

function normalizeConversationItems(
  items: SharedInboxConversationItemLike[],
  fallbackHrefFactory: (item: SharedInboxConversationItemLike) => string = () => "",
): SharedInboxConversationItem[] {
  return items.map((item) => normalizeConversationItem(item, fallbackHrefFactory(item)));
}

function buildConversationItemHrefFromParams(
  searchAction: string,
  selectedConnectionKey: string,
  searchQuery: string,
  conversation: SharedInboxConversationItemLike,
) {
  const chatKey =
    (typeof conversation.id === "string" && conversation.id.trim()) ||
    (typeof conversation.key === "string" && conversation.key.trim()) ||
    (typeof conversation.conversationId === "string" && conversation.conversationId.trim()) ||
    "";

  if (!chatKey) {
    return "";
  }

  const params = new URLSearchParams();
  params.set("chatKey", chatKey);
  if (selectedConnectionKey) params.set("connection", selectedConnectionKey);
  if (searchQuery.trim()) params.set("q", searchQuery.trim());
  const qs = params.toString();
  return qs ? `${searchAction}?${qs}` : searchAction;
}

function extractConversationIdFromKey(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  const separatorIndex = normalized.indexOf(":");
  return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized;
}

function conversationIdMatchesKey(key: string, conversationId: string) {
  const normalizedKey = key.trim();
  const normalizedConversationId = conversationId.trim();

  if (!normalizedKey || !normalizedConversationId) {
    return false;
  }

  if (normalizedKey === normalizedConversationId) {
    return true;
  }

  return extractConversationIdFromKey(normalizedKey) === normalizedConversationId;
}

function findConversationItemBySnapshotId(
  items: SharedInboxConversationItem[],
  snapshotId: string,
  source?: SharedInboxConversationItem["channelType"],
) {
  const normalizedSnapshotId = snapshotId.trim();
  if (!normalizedSnapshotId) {
    return null;
  }

  return (
    items.find((item) => conversationIdMatchesKey(item.id, normalizedSnapshotId)) ??
    (source === "whatsapp_official"
      ? items.find((item) => item.id === normalizedSnapshotId)
      : null)
  );
}

function buildConversationItemFromSnapshot(
  snapshot: LiveConversationSnapshot,
  existing?: SharedInboxConversationItem | null,
): SharedInboxConversationItem {
  const latestMessage = snapshot.messages.at(-1) ?? null;
  const nextItem: SharedInboxConversationItem = {
    id: existing?.id ?? snapshot.id,
    source: existing?.source ?? "agent",
    agentId: existing?.agentId ?? null,
    contactId: snapshot.contactId ?? existing?.contactId ?? null,
    label: snapshot.label ?? existing?.label ?? snapshot.id,
    secondaryLabel: snapshot.secondaryLabel ?? existing?.secondaryLabel ?? "",
    tags: snapshot.tags ?? existing?.tags ?? [],
    channelType: existing?.channelType,
    incomingCount: countIncomingMessagesSinceLastOutbound(snapshot.messages),
    avatarUrl: snapshot.avatarUrl ?? existing?.avatarUrl ?? null,
    lastMessage: latestMessage ? getMessagePreviewText(latestMessage) : existing?.lastMessage ?? null,
    lastMessageType: latestMessage?.type ?? existing?.lastMessageType ?? null,
    lastMessageDirection: latestMessage?.direction ?? existing?.lastMessageDirection ?? null,
    lastMessageAt: latestMessage?.createdAt ?? existing?.lastMessageAt ?? null,
    href: existing?.href ?? "",
  };

  return nextItem;
}

function buildConversationItemFromListSnapshot(
  snapshot: LiveConversationListSnapshot,
  existing?: SharedInboxConversationItem | null,
): SharedInboxConversationItem {
  const lastMessage = snapshot.lastMessage?.trim() || null;
  const isMediaPreviewType =
    snapshot.lastMessageType === "AUDIO" ||
    snapshot.lastMessageType === "IMAGE" ||
    snapshot.lastMessageType === "VIDEO" ||
    snapshot.lastMessageType === "STICKER" ||
    snapshot.lastMessageType === "DOCUMENT";

  return {
    id: existing?.id ?? snapshot.id,
    source: existing?.source ?? (snapshot.channelType === "whatsapp_official" ? "official" : "agent"),
    agentId: existing?.agentId ?? null,
    contactId: snapshot.contactId ?? existing?.contactId ?? null,
    label: snapshot.label,
    secondaryLabel: snapshot.secondaryLabel,
    tags: snapshot.tags ?? existing?.tags ?? [],
    channelType: snapshot.channelType ?? existing?.channelType,
    incomingCount: snapshot.incomingCount ?? existing?.incomingCount ?? 0,
    avatarUrl: snapshot.avatarUrl ?? existing?.avatarUrl ?? null,
    lastMessage: lastMessage || (isMediaPreviewType ? null : existing?.lastMessage ?? null),
    lastMessageType: snapshot.lastMessageType ?? existing?.lastMessageType ?? null,
    lastMessageDirection: snapshot.lastMessageDirection ?? existing?.lastMessageDirection ?? null,
    // No usar existing como fallback para lastMessageAt: si el snapshot trae null pero existing
    // tiene una fecha vieja, el item quedaría anclado en su posición anterior en el sort.
    lastMessageAt: snapshot.lastMessageAt ?? null,
    href: existing?.href ?? "",
  };
}

function sortConversationItems(items: SharedInboxConversationItem[]) {
  return [...items].sort((left, right) => {
    const leftAt = getConversationLastMessageTimestamp(left.lastMessageAt);
    const rightAt = getConversationLastMessageTimestamp(right.lastMessageAt);
    return rightAt - leftAt;
  });
}

function insertConversationItemByTimestamp(
  items: SharedInboxConversationItem[],
  item: SharedInboxConversationItem,
) {
  const itemAt = getConversationLastMessageTimestamp(item.lastMessageAt);
  let insertIndex = 0;

  while (insertIndex < items.length && getConversationLastMessageTimestamp(items[insertIndex]?.lastMessageAt) > itemAt) {
    insertIndex += 1;
  }

  return [
    ...items.slice(0, insertIndex),
    item,
    ...items.slice(insertIndex),
  ];
}

function updateConversationItemInSortedList(
  current: SharedInboxConversationItem[],
  snapshotId: string,
  nextItem: SharedInboxConversationItem,
) {
  const currentIndex = current.findIndex((item) => conversationIdMatchesKey(item.id, snapshotId));
  if (currentIndex === -1) {
    const nextItems = insertConversationItemByTimestamp(current, nextItem);
    return nextItems.length === current.length && current.every((item, index) => areConversationListItemsEqual(item, nextItems[index]!))
      ? current
      : nextItems;
  }

  const currentItem = current[currentIndex];
  if (areConversationListItemsEqual(currentItem, nextItem)) {
    return current;
  }

  const currentAt = getConversationLastMessageTimestamp(currentItem.lastMessageAt);
  const nextAt = getConversationLastMessageTimestamp(nextItem.lastMessageAt);

  if (currentAt === nextAt) {
    const nextItems = [...current];
    nextItems[currentIndex] = nextItem;
    return nextItems;
  }

  const withoutCurrent = current.filter((_, index) => index !== currentIndex);
  const nextItems = insertConversationItemByTimestamp(withoutCurrent, nextItem);

  return nextItems.length === current.length && current.every((item, index) => areConversationListItemsEqual(item, nextItems[index]!))
    ? current
    : nextItems;
}

function mergeConversationListItem(
  next: SharedInboxConversationItem,
  existing?: SharedInboxConversationItem | null,
) {
  if (!existing) {
    return next;
  }

  const existingAt = getConversationLastMessageTimestamp(existing.lastMessageAt);
  const nextAt = getConversationLastMessageTimestamp(next.lastMessageAt);

  if (existingAt <= nextAt) {
    return next;
  }

  const nextHasMediaPreviewType =
    next.lastMessageType === "AUDIO" ||
    next.lastMessageType === "IMAGE" ||
    next.lastMessageType === "VIDEO" ||
    next.lastMessageType === "STICKER" ||
    next.lastMessageType === "DOCUMENT";

  return {
    ...next,
    incomingCount: Math.max(existing.incomingCount ?? 0, next.incomingCount ?? 0),
    lastMessage: nextHasMediaPreviewType ? next.lastMessage ?? null : existing.lastMessage ?? next.lastMessage ?? null,
    lastMessageType: existing.lastMessageType ?? next.lastMessageType ?? null,
    lastMessageDirection: existing.lastMessageDirection ?? next.lastMessageDirection ?? null,
    lastMessageAt: existing.lastMessageAt ?? next.lastMessageAt ?? null,
  };
}

function areTagListsEqual(
  left: SharedInboxConversationItem["tags"],
  right: SharedInboxConversationItem["tags"],
) {
  if (left === right) {
    return true;
  }

  if ((left?.length ?? 0) !== (right?.length ?? 0)) {
    return false;
  }

  for (let index = 0; index < (left?.length ?? 0); index += 1) {
    const leftTag = left?.[index];
    const rightTag = right?.[index];

    if (!leftTag || !rightTag || leftTag.label !== rightTag.label || leftTag.color !== rightTag.color) {
      return false;
    }
  }

  return true;
}

function areConversationListItemsEqual(
  left: SharedInboxConversationItem,
  right: SharedInboxConversationItem,
) {
  return (
    left.id === right.id &&
    left.source === right.source &&
    left.agentId === right.agentId &&
    left.contactId === right.contactId &&
    left.label === right.label &&
    left.secondaryLabel === right.secondaryLabel &&
    left.avatarUrl === right.avatarUrl &&
    left.lastMessage === right.lastMessage &&
    left.lastMessageType === right.lastMessageType &&
    left.lastMessageDirection === right.lastMessageDirection &&
    getConversationLastMessageTimestamp(left.lastMessageAt) === getConversationLastMessageTimestamp(right.lastMessageAt) &&
    left.incomingCount === right.incomingCount &&
    left.channelType === right.channelType &&
    left.href === right.href &&
    areTagListsEqual(left.tags ?? [], right.tags ?? [])
  );
}

function areMessageItemsEqual(
  left: SharedInboxMessageItem,
  right: SharedInboxMessageItem,
) {
  return (
    left.id === right.id &&
    left.content === right.content &&
    left.direction === right.direction &&
    left.authorType === right.authorType &&
    left.outboundStatusLabel === right.outboundStatusLabel &&
    left.type === right.type &&
    left.mediaUrl === right.mediaUrl &&
    left.rawPayload === right.rawPayload &&
    left.createdAt.getTime() === right.createdAt.getTime() &&
    (left.editedAt?.getTime() ?? 0) === (right.editedAt?.getTime() ?? 0) &&
    (left.deletedAt?.getTime() ?? 0) === (right.deletedAt?.getTime() ?? 0)
  );
}

function areSelectedConversationsEqual(
  left: SharedInboxSelectedConversation,
  right: SharedInboxSelectedConversation,
) {
  return (
    left.id === right.id &&
    left.label === right.label &&
    left.secondaryLabel === right.secondaryLabel &&
    left.contactId === right.contactId &&
    left.contactName === right.contactName &&
    left.avatarUrl === right.avatarUrl &&
    left.automationPaused === right.automationPaused &&
    left.loadMoreHref === right.loadMoreHref &&
    left.loadMoreCursor === right.loadMoreCursor &&
    left.hasMoreMessages === right.hasMoreMessages &&
    left.cacheKey === right.cacheKey &&
    left.isPreview === right.isPreview &&
    areTagListsEqual(left.tags ?? [], right.tags ?? []) &&
    left.messages.length === right.messages.length &&
    left.messages.every((message, index) => areMessageItemsEqual(message, right.messages[index]!))
  );
}

function mergeConversationSnapshotIfChanged(
  existing: SharedInboxSelectedConversation | null,
  next: SharedInboxSelectedConversation | null,
) {
  const merged = mergeConversationSnapshots(existing, next);
  if (!existing || !merged) {
    return merged;
  }

  return areSelectedConversationsEqual(existing, merged) ? existing : merged;
}

function updateConversationItemByContact(
  current: SharedInboxConversationItem[],
  contactId: string,
  updater: (item: SharedInboxConversationItem) => SharedInboxConversationItem,
) {
  let changed = false;
  const nextItems = current.map((item) => {
    if (item.contactId !== contactId) {
      return item;
    }

    changed = true;
    return updater(item);
  });

  return changed ? nextItems : current;
}

function renderWhatsAppText(content: string) {
  const parts = content.split(/(\*[^*\n]+\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return (
        <strong key={`${part}-${index}`} className="font-semibold">
          {part.slice(1, -1)}
        </strong>
      );
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function renderMessageText(content?: string | null, className = "") {
  if (!content?.trim()) {
    return null;
  }

  return <p className={`whitespace-pre-wrap break-words ${className}`}>{renderWhatsAppText(content)}</p>;
}

function getCallMessageSummary(message: SharedInboxMessageItem) {
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

function formatDateDivider(date: Date) {
  return chatDateLabelFormatter.format(date);
}

function isMediaSourceUrl(url?: string | null) {
  if (!url) {
    return false;
  }

  const normalized = url.trim().toLowerCase();
  return (
    normalized.startsWith("data:") ||
    normalized.startsWith("blob:") ||
    normalized.startsWith("/api/media/proxy") ||
    normalized.startsWith("/") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://")
  );
}

function toProxiedMediaUrl(url: string) {
  if (
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("/api/media/proxy")
  ) {
    return url;
  }

  return `/api/media/proxy?url=${encodeURIComponent(url)}`;
}

function uniquePush(values: string[], candidate?: string | null) {
  if (!candidate) {
    return;
  }

  const normalized = candidate.trim();
  if (!normalized || values.includes(normalized)) {
    return;
  }

  values.push(normalized);
}

type MediaUrlType = "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT";

const mediaUrlExtractionCache = new WeakMap<object, Map<MediaUrlType, string | null>>();
const imagePreviewUrlCache = new WeakMap<object, string[]>();

function getMediaUrlExtractionCacheEntry(rawPayload: unknown) {
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

function extractMediaUrlFromPayload(message: SharedInboxMessageItem, type: "IMAGE" | "AUDIO" | "VIDEO" | "STICKER" | "DOCUMENT") {
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

function AudioMessageCard({
  mediaUrl,
  content,
  outbound,
}: {
  mediaUrl: string;
  content: string | null;
  outbound: boolean;
}) {
  return (
    <div className="w-[280px] max-w-full space-y-2">
      <audio
        src={mediaUrl}
        controls
        preload="metadata"
        className={`block w-full min-w-0 rounded-xl ${outbound ? "[color-scheme:dark]" : ""}`}
      />

      {renderMessageText(content)}
    </div>
  );
}

function ComposerSendButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-2xl bg-[var(--primary)] text-white transition hover:bg-[var(--primary-strong)] disabled:cursor-not-allowed disabled:opacity-70 md:h-10 md:w-10"
      aria-label={pending ? "Enviando mensaje" : "Enviar mensaje"}
    >
      <SendHorizonal className={`h-5 w-5 ${pending ? "animate-pulse" : ""}`} />
    </button>
  );
}

type ComposerEmojiPickerProps = {
  query: string;
  activeTab: ComposerEmojiTab;
  recentEmojis: string[];
  onQueryChange: (value: string) => void;
  onActiveTabChange: (value: ComposerEmojiTab) => void;
  onSelectEmoji: (emoji: string) => void;
};

function ComposerEmojiPicker({
  query,
  activeTab,
  recentEmojis,
  onQueryChange,
  onActiveTabChange,
  onSelectEmoji,
}: ComposerEmojiPickerProps) {
  const normalizedQuery = useMemo(() => normalizeComposerEmojiSearch(query), [query]);

  const recentEmojiItems = useMemo(() => {
    const mapped = recentEmojis
      .map((emoji) => CHAT_COMPOSER_EMOJIS.find((item) => item.emoji === emoji))
      .filter((item): item is ComposerEmoji => Boolean(item));

    if (!normalizedQuery) {
      return mapped;
    }

    return mapped.filter((item) => {
      const haystack = normalizeComposerEmojiSearch([item.label, item.category, ...item.keywords].join(" "));
      return haystack.includes(normalizedQuery) || item.emoji.includes(normalizedQuery);
    });
  }, [normalizedQuery, recentEmojis]);

  const visibleEmojiItems = useMemo(() => {
    let source: ComposerEmoji[];

    if (activeTab === "todos") {
      source = CHAT_COMPOSER_EMOJIS;
    } else if (activeTab === "recientes") {
      source = recentEmojiItems;
    } else {
      source = CHAT_COMPOSER_EMOJI_GROUPS[activeTab];
    }

    if (!normalizedQuery || activeTab === "recientes") {
      return source;
    }

    return source.filter((item) => {
      const haystack = normalizeComposerEmojiSearch([item.label, item.category, ...item.keywords].join(" "));
      return haystack.includes(normalizedQuery) || item.emoji.includes(normalizedQuery);
    });
  }, [activeTab, normalizedQuery, recentEmojiItems]);

  const emojiTabs: ComposerEmojiTab[] = ["todos", "recientes", ...CHAT_COMPOSER_CATEGORY_ORDER.slice(1)];

  return (
    <div className="space-y-2.5">
      <div className="space-y-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Buscar emoticones"
            className="h-9 w-full rounded-2xl border border-[rgba(148,163,184,0.14)] bg-slate-50 pl-9 pr-10 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)] focus:bg-white focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_18%,white)]"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Limpiar búsqueda"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <Tabs value={activeTab} onValueChange={(value) => onActiveTabChange(value as ComposerEmojiTab)}>
          <TabsList className="flex h-auto w-full flex-wrap gap-1 rounded-2xl bg-slate-100 p-1">
            {emojiTabs.map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="group flex h-9 min-w-0 flex-1 items-center justify-center rounded-xl px-0 text-slate-500 transition data-[state=active]:bg-white data-[state=active]:text-slate-950 data-[state=active]:shadow-sm"
                title={CHAT_COMPOSER_CATEGORY_LABELS[tab]}
                aria-label={CHAT_COMPOSER_CATEGORY_LABELS[tab]}
              >
                {(() => {
                  const Icon = CHAT_COMPOSER_CATEGORY_ICONS[tab];

                  return <Icon className="h-4.5 w-4.5 transition-transform duration-150 group-data-[state=active]:scale-105" />;
                })()}
                <span className="sr-only">{CHAT_COMPOSER_CATEGORY_LABELS[tab]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="max-h-[17rem] overflow-y-auto pr-1">
        {activeTab === "recientes" && !recentEmojis.length ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
            Aquí aparecerán los últimos emoticones que uses.
          </div>
        ) : visibleEmojiItems.length ? (
          <div className="grid grid-cols-6 gap-0.5">
            {visibleEmojiItems.map((item) => (
              <button
                key={`${item.category}:${item.emoji}`}
                type="button"
                onClick={() => onSelectEmoji(item.emoji)}
                className="flex h-10 w-10 items-center justify-center rounded-2xl text-[1.25rem] transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_18%,white)]"
                aria-label={`Insertar ${item.label}`}
                title={item.label}
              >
                {item.emoji}
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
            No encontramos emoticones para esa búsqueda.
          </div>
        )}
      </div>
    </div>
  );
}

type ChatAdPreview = {
  title: string;
  body?: string | null;
  sourceUrl?: string | null;
  thumbnailUrl?: string | null;
  sourceApp?: string | null;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getNestedRecord(value: unknown, key: string) {
  if (!isObjectRecord(value)) {
    return null;
  }

  const nested = value[key];
  return isObjectRecord(nested) ? nested : null;
}

function getNestedString(value: unknown, key: string) {
  if (!isObjectRecord(value)) {
    return null;
  }

  const nested = value[key];
  return typeof nested === "string" && nested.trim().length > 0 ? nested : null;
}

function getNestedValue(value: unknown, key: string) {
  if (!isObjectRecord(value) || !(key in value)) {
    return null;
  }

  return value[key];
}

function bytesLikeToBase64(value: unknown) {
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

function collectImagePreviewUrls(message: SharedInboxMessageItem) {
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

function extractChatAdPreview(rawPayload: unknown): ChatAdPreview | null {
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

// Componente memoizado: solo re-renderiza si cambian sus props directas.
// Evita que los ~N mensajes renderizados re-ejecuten cuando cambia estado de UI
// en SharedInbox (modal abierto, optimisticOutgoingMessage, pendingConversation, etc.).
const MessageBubble = memo(function MessageBubble({
  message,
  previousMessage,
}: {
  message: SharedInboxMessageItem;
  previousMessage: SharedInboxMessageItem | undefined;
}) {
  const [imagePreviewIndex, setImagePreviewIndex] = useState(0);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const outbound = message.direction === "OUTBOUND";
  const currentDateKey = chatDateFormatter.format(message.createdAt);
  const previousDateKey = previousMessage ? chatDateFormatter.format(previousMessage.createdAt) : null;
  const showDateDivider = currentDateKey !== previousDateKey;
  const adPreview = useMemo(() => extractChatAdPreview(message.rawPayload), [message]);
  const isImageMessage = message.type === "IMAGE";
  const isStickerMessage = message.type === "STICKER";
  const imagePreviewUrls = useMemo(() => (isImageMessage ? collectImagePreviewUrls(message) : []), [message, isImageMessage]);
  const imagePreviewUrl = imagePreviewUrls[imagePreviewIndex] ?? null;
  const audioUrl = useMemo(
    () => (message.type === "AUDIO" ? extractMediaUrlFromPayload(message, "AUDIO") : null),
    [message],
  );
  const videoUrl = useMemo(
    () => (message.type === "VIDEO" ? extractMediaUrlFromPayload(message, "VIDEO") : null),
    [message],
  );
  const stickerUrl = useMemo(
    () => (isStickerMessage ? extractMediaUrlFromPayload(message, "STICKER") : null),
    [isStickerMessage, message],
  );
  const documentUrl = useMemo(
    () => (message.type === "DOCUMENT" ? extractMediaUrlFromPayload(message, "DOCUMENT") : null),
    [message],
  );
  const isOptimistic = "isOptimistic" in message && Boolean((message as { isOptimistic?: boolean }).isOptimistic);
  const isDeleted = Boolean(message.deletedAt);
  const mediaPreviewLabel = getMediaPreviewLabel(message.type);
  const mediaCaption = message.content?.trim() || "";
  const shouldRenderMediaCaption = mediaCaption && mediaCaption !== mediaPreviewLabel;
  const hasImagePreview = isImageMessage && imagePreviewUrl !== null;
  const imagePreviewExhausted = isImageMessage && imagePreviewUrls.length > 0 && !hasImagePreview;
  const showInlineImageTimestamp = hasImagePreview;

  const handleImageError = () => {
    setImagePreviewIndex((current) => {
      const nextIndex = current + 1;
      return nextIndex < imagePreviewUrls.length ? nextIndex : current;
    });
  };

  const openImageViewer = useCallback(() => {
    if (hasImagePreview) {
      setIsImageViewerOpen(true);
    }
  }, [hasImagePreview]);

  const closeImageViewer = useCallback(() => {
    setIsImageViewerOpen(false);
  }, []);

  useEffect(() => {
    if (!isImageViewerOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsImageViewerOpen(false);
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isImageViewerOpen]);

  const callSummary = getCallMessageSummary(message);
  const CallIcon = callSummary?.icon ?? null;

  return (
    <div
      className="space-y-2.5 md:space-y-3"
    >
      {showDateDivider ? (
        <div className="flex justify-center">
          <span className="rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[11px] font-medium text-slate-500 shadow-sm backdrop-blur">
            {formatDateDivider(message.createdAt)}
          </span>
        </div>
      ) : null}

      <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
        <div
          className={`max-w-[88%] rounded-[8px] px-[6px] py-[6px] text-[13px] leading-5 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.16)] md:max-w-[72%] md:px-[6px] md:py-[6px] ${
            outbound
              ? "bg-[var(--primary)] text-white"
              : "border border-[rgba(148,163,184,0.12)] bg-white text-slate-800"
          } ${isOptimistic ? "opacity-85" : ""}`}
        >
          {callSummary ? (
            <div className="space-y-2">
              <Badge
                className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold normal-case tracking-normal shadow-none ${
                  outbound ? "bg-white/14 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                {CallIcon ? <CallIcon className={`h-4 w-4 ${outbound ? "text-white/85" : "text-[var(--primary)]"}`} /> : null}
                <span>Llamada {callSummary.directionLabel}</span>
                {callSummary.statusText ? (
                  <span className={`font-normal ${outbound ? "text-white/75" : "text-slate-500"}`}>
                    {callSummary.statusText}
                  </span>
                ) : null}
              </Badge>
            </div>
          ) : adPreview ? (
            <div className="space-y-3">
              {adPreview.sourceUrl ? (
                <a
                  href={adPreview.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={adPreview.sourceUrl}
                  className={`group flex w-full max-w-[280px] items-center gap-3 overflow-hidden rounded-2xl border px-2.5 py-2 text-left transition ${
                    outbound
                      ? "border-white/14 bg-white/10 hover:bg-white/14"
                      : "border-[rgba(148,163,184,0.16)] bg-[#1f7a4d]/[0.14] hover:bg-[#1f7a4d]/[0.18]"
                  }`}
                >
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-black/5 bg-white">
                    {adPreview.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={isMediaSourceUrl(adPreview.thumbnailUrl) ? toProxiedMediaUrl(adPreview.thumbnailUrl) : ""}
                        alt={adPreview.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-slate-100">
                        {adPreview.sourceApp === "facebook" ? (
                          <Facebook className="h-4 w-4 text-blue-600" />
                        ) : (
                          <MessageCircle className="h-4 w-4 text-emerald-600" />
                        )}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      {adPreview.sourceApp === "facebook" ? (
                        <Facebook className={`h-3.5 w-3.5 ${outbound ? "text-white/80" : "text-blue-600"}`} />
                      ) : (
                        <MessageCircle className={`h-3.5 w-3.5 ${outbound ? "text-white/80" : "text-emerald-600"}`} />
                      )}
                      <span className={`text-[11px] font-medium ${outbound ? "text-white/75" : "text-slate-500"}`}>
                        {adPreview.sourceApp === "facebook" ? "Anuncio de Facebook" : "Referencia de anuncio"}
                      </span>
                    </div>
                    <p className={`truncate text-[13px] font-semibold leading-5 ${outbound ? "text-white" : "text-slate-900"}`}>
                      {adPreview.title}
                    </p>
                    <p className={`text-[11px] font-medium ${outbound ? "text-white/80" : "text-slate-500"}`}>
                      Ver detalles
                    </p>
                  </div>
                </a>
              ) : (
                <div
                  className={`flex w-full max-w-[280px] items-center gap-3 overflow-hidden rounded-2xl border px-2.5 py-2 ${
                    outbound
                      ? "border-white/14 bg-white/10"
                      : "border-[rgba(148,163,184,0.16)] bg-[#1f7a4d]/[0.14]"
                  }`}
                >
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-black/5 bg-white">
                    {adPreview.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={isMediaSourceUrl(adPreview.thumbnailUrl) ? toProxiedMediaUrl(adPreview.thumbnailUrl) : ""}
                        alt={adPreview.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-slate-100">
                        {adPreview.sourceApp === "facebook" ? (
                          <Facebook className="h-4 w-4 text-blue-600" />
                        ) : (
                          <MessageCircle className="h-4 w-4 text-emerald-600" />
                        )}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      {adPreview.sourceApp === "facebook" ? (
                        <Facebook className={`h-3.5 w-3.5 ${outbound ? "text-white/80" : "text-blue-600"}`} />
                      ) : (
                        <MessageCircle className={`h-3.5 w-3.5 ${outbound ? "text-white/80" : "text-emerald-600"}`} />
                      )}
                      <span className={`text-[11px] font-medium ${outbound ? "text-white/75" : "text-slate-500"}`}>
                        {adPreview.sourceApp === "facebook" ? "Anuncio de Facebook" : "Referencia de anuncio"}
                      </span>
                    </div>
                    <p className={`truncate text-[13px] font-semibold leading-5 ${outbound ? "text-white" : "text-slate-900"}`}>
                      {adPreview.title}
                    </p>
                    <p className={`text-[11px] font-medium ${outbound ? "text-white/80" : "text-slate-500"}`}>
                      Ver detalles
                    </p>
                  </div>
                </div>
              )}
              {renderMessageText(message.content)}
            </div>
          ) : hasImagePreview ? (
            <div className="space-y-2 max-w-[360px]">
              <div className="relative">
                <button
                  type="button"
                  onClick={openImageViewer}
                  className="group block w-full cursor-zoom-in overflow-hidden rounded-xl"
                  aria-label="Abrir imagen en pantalla completa"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imagePreviewUrl}
                    alt={message.content?.trim() || "Imagen del chat"}
                    loading="lazy"
                    decoding="async"
                    onError={handleImageError}
                    className="max-h-[260px] w-full rounded-xl object-cover transition duration-200 group-hover:scale-[1.01]"
                  />
                  <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-black/5 transition group-hover:bg-black/5" />
                </button>
                {showInlineImageTimestamp ? (
                  <div
                    className={`absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] leading-none backdrop-blur-sm ${
                      outbound ? "bg-black/45 text-white" : "bg-black/45 text-white"
                    }`}
                  >
                    {message.authorType === "bot" ? (
                      <Bot className="h-3 w-3" />
                    ) : (
                      <UserRound className="h-3 w-3" />
                    )}
                    {formatChatTime(message.createdAt)}
                  </div>
                ) : null}
              </div>
              {renderMessageText(message.content)}
              {portalTarget && isImageViewerOpen && hasImagePreview
                ? createPortal(
                    <div
                      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 px-3 py-3 backdrop-blur-sm"
                      role="dialog"
                      aria-modal="true"
                      aria-label="Vista previa de imagen"
                      onClick={closeImageViewer}
                    >
                      <div
                        className="relative flex h-full w-full items-center justify-center"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={closeImageViewer}
                          className="absolute right-2 top-2 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                          aria-label="Cerrar imagen"
                        >
                          <X className="h-5 w-5" />
                        </button>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imagePreviewUrl}
                          alt={message.content?.trim() || "Imagen del chat"}
                          className="max-h-[calc(100dvh-1.5rem)] max-w-[calc(100dvw-1.5rem)] select-none object-contain shadow-[0_24px_80px_-24px_rgba(0,0,0,0.65)]"
                          draggable={false}
                        />
                      </div>
                    </div>,
                    portalTarget,
                  )
                : null}
            </div>
          ) : imagePreviewExhausted ? (
            <div className="space-y-2">
              <div className={`flex h-[180px] w-full items-center justify-center rounded-xl border border-dashed ${
                outbound ? "border-white/20 bg-white/10 text-white/80" : "border-[rgba(148,163,184,0.22)] bg-slate-50 text-slate-500"
              }`}>
                <span className="text-sm font-medium">Imagen no disponible</span>
              </div>
              {renderMessageText(message.content)}
            </div>
          ) : videoUrl ? (
            <div className="space-y-2">
              <video
                src={videoUrl}
                controls
                preload="metadata"
                className="max-h-[320px] w-full rounded-xl bg-black"
              />
              {renderMessageText(message.content)}
            </div>
          ) : stickerUrl ? (
            <div className="space-y-2">
              <div className="inline-flex max-w-[220px] items-center justify-center overflow-hidden rounded-xl border border-[rgba(148,163,184,0.12)] bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={stickerUrl}
                  alt={message.content?.trim() || "Sticker"}
                  loading="lazy"
                  decoding="async"
                  className="h-auto w-full max-w-[220px] object-contain"
                />
              </div>
              {renderMessageText(message.content)}
            </div>
          ) : audioUrl ? (
            <AudioMessageCard
              mediaUrl={audioUrl}
              content={message.content}
              outbound={outbound}
            />
          ) : documentUrl ? (
            <div className="space-y-2">
              <a
                href={documentUrl}
                target="_blank"
                rel="noreferrer"
                className={`inline-flex items-center rounded-xl px-3 py-2 text-sm font-medium underline-offset-2 transition hover:underline ${
                  outbound ? "bg-white/14 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                Abrir documento
              </a>
              {renderMessageText(message.content)}
            </div>
          ) : mediaPreviewLabel ? (
            <div className="space-y-2">
              <div
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${
                  outbound
                    ? "border-white/14 bg-white/10 text-white"
                    : "border-[rgba(148,163,184,0.16)] bg-slate-50 text-slate-700"
                }`}
              >
                <LoaderCircle className={`h-4 w-4 shrink-0 animate-spin ${outbound ? "text-white/80" : "text-slate-500"}`} />
                <span>{mediaPreviewLabel}</span>
              </div>
              {shouldRenderMediaCaption ? renderMessageText(message.content) : null}
            </div>
          ) : (
            renderMessageText(message.content) || (
              <p className={`text-[12px] italic ${outbound ? "text-white/75" : "text-slate-500"}`}>
                {isDeleted ? "Mensaje eliminado" : "-"}
              </p>
            )
          )}

          <div className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${outbound ? "text-white/80" : "text-slate-400"}`}>
            {isDeleted ? (
              <Badge className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-normal tracking-[0.08em] shadow-none ${
                outbound ? "bg-white/14 text-white/80" : "bg-rose-50 text-rose-600"
              }`}>
                <Trash2 className="h-2.5 w-2.5" />
                Eliminado
              </Badge>
            ) : null}
            {message.editedAt ? (
              <Badge className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-normal tracking-[0.08em] shadow-none ${
                outbound ? "bg-white/14 text-white/80" : "bg-slate-100 text-slate-500"
              }`}>
                <Pencil className="h-2.5 w-2.5" />
                Editado
              </Badge>
            ) : null}
            {!showInlineImageTimestamp ? (
              message.authorType === "bot" ? (
                <Bot className="h-3 w-3" />
              ) : (
                <UserRound className="h-3 w-3" />
              )
            ) : null}
            {!showInlineImageTimestamp ? <span>{formatChatTime(message.createdAt)}</span> : null}
            {outbound && message.outboundStatusLabel ? (
              message.outboundStatusLabel === "entregado" ? (
                <CheckCheck className="ml-1 h-3 w-3 shrink-0" aria-hidden="true" />
              ) : (
                <span className="ml-1">{message.outboundStatusLabel}</span>
              )
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
});

const MESSAGE_VIRTUALIZATION_THRESHOLD = 28;
const MESSAGE_VIRTUALIZATION_OVERSCAN_PX = 720;
const messageBubbleHeightCache = new WeakMap<SharedInboxMessageItem, number>();
const CHAT_MESSAGES_BACKGROUND_BASE_STYLE = {
  backgroundColor: "#eef2f7",
} as const;

const CHAT_MESSAGES_BACKGROUND_OVERLAY_STYLE = {
  backgroundImage: 'url("https://static.whatsapp.net/rsrc.php/yx/r/voSdkk88H7C.svg")',
  backgroundRepeat: "repeat",
  backgroundSize: "540px 960px",
  backgroundPosition: "0 0",
  opacity: 0.08,
} as const;

function estimateMessageBubbleHeight(message: SharedInboxMessageItem) {
  const cachedHeight = messageBubbleHeightCache.get(message);
  if (cachedHeight !== undefined) {
    return cachedHeight;
  }

  const contentLength = message.content?.trim().length ?? 0;
  let height: number;

  if (message.type === "IMAGE") {
    height = 392;
  } else if (message.type === "VIDEO") {
    height = 340;
  } else if (message.type === "STICKER") {
    height = 240;
  } else if (message.type === "AUDIO") {
    height = 152;
  } else if (message.type === "DOCUMENT") {
    height = 128;
  } else {
    const estimatedTextLines = Math.max(1, Math.ceil(contentLength / 46));
    height = Math.min(92 + (estimatedTextLines - 1) * 20, 320);
  }

  messageBubbleHeightCache.set(message, height);
  return height;
}

type ConversationPanelProps = {
  backHref: string;
  composer: SharedInboxProps["composer"];
  composerHiddenFields: Array<{ name: string; value: string }>;
  hasStatusMessages: boolean;
  hasSettledConversation: boolean;
  isLoadingOlderMessages: boolean;
  loadMoreSentinelRef: RefObject<HTMLDivElement | null>;
  messageScrollBehavior: "bottom" | "preserve";
  messagesScrollRef: RefObject<HTMLDivElement | null>;
  unreadCount: number;
  onScrollToBottom: () => void;
  onOpenStatusDialog: () => void;
  onEditContact: () => void;
  onOpenTags: () => void;
  onComposerDraft: (message: string) => void;
  onLoadOlderMessages: () => void | Promise<void>;
  renderedConversation: SharedInboxSelectedConversation | null;
  renderedMessages: SharedInboxMessageItem[];
  selectedConversationId: string;
  selectedConversationScrollKey: string;
  selectedConversationTags: Array<{
    label: string;
    color: string;
  }>;
  emptySelectionTitle: string;
  emptySelectionDescription: string;
  headerActions?: ReactNode;
  headerBadge?: ReactNode;
};

const ConversationPanel = memo(function ConversationPanel({
  backHref,
  composer,
  composerHiddenFields,
  hasStatusMessages,
  hasSettledConversation,
  isLoadingOlderMessages,
  loadMoreSentinelRef,
  messageScrollBehavior,
  messagesScrollRef,
  unreadCount,
  onScrollToBottom,
  onOpenStatusDialog,
  onEditContact,
  onOpenTags,
  onComposerDraft,
  onLoadOlderMessages,
  renderedConversation,
  renderedMessages,
  selectedConversationId,
  selectedConversationScrollKey,
  selectedConversationTags,
  emptySelectionTitle,
  emptySelectionDescription,
  headerActions,
  headerBadge,
}: ConversationPanelProps) {
  const canLoadOlderMessages = Boolean(renderedConversation?.loadMoreCursor && renderedConversation.hasMoreMessages);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [emojiSearchQuery, setEmojiSearchQuery] = useState("");
  const [emojiPickerTab, setEmojiPickerTab] = useState<ComposerEmojiTab>("todos");
  const [recentComposerEmojis, setRecentComposerEmojis] = useState<string[]>([]);
  const [recentComposerEmojisReady, setRecentComposerEmojisReady] = useState(false);
  const scrollFrameRef = useRef<number | null>(null);
  const composerTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerSelectionRef = useRef({ start: 0, end: 0 });

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CHAT_COMPOSER_RECENT_KEY);
      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        return;
      }

      const nextRecent = parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
      if (nextRecent.length > 0) {
        setRecentComposerEmojis(nextRecent.slice(0, 24));
      }
    } catch {
      // Ignore storage parsing issues.
    } finally {
      setRecentComposerEmojisReady(true);
    }
  }, []);

  useEffect(() => {
    if (!recentComposerEmojisReady) {
      return;
    }

    try {
      window.localStorage.setItem(CHAT_COMPOSER_RECENT_KEY, JSON.stringify(recentComposerEmojis.slice(0, 24)));
    } catch {
      // Ignore storage write issues.
    }
  }, [recentComposerEmojis, recentComposerEmojisReady]);

  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container) {
      return;
    }

    function updateViewportHeight() {
      const nextHeight = container?.clientHeight ?? 0;
      setViewportHeight((current) => (current === nextHeight ? current : nextHeight));
    }

    function updateScrollTop() {
      if (scrollFrameRef.current !== null) {
        return;
      }

      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        const nextScrollTop = container?.scrollTop ?? 0;
        setScrollTop((current) => (current === nextScrollTop ? current : nextScrollTop));
      });
    }

    updateViewportHeight();
    updateScrollTop();
    container.addEventListener("scroll", updateScrollTop, { passive: true });

    const resizeObserver = new ResizeObserver(updateViewportHeight);
    resizeObserver.observe(container);

    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }

      container.removeEventListener("scroll", updateScrollTop);
      resizeObserver.disconnect();
    };
  }, [messagesScrollRef]);

  useEffect(() => {
    composerSelectionRef.current = { start: 0, end: 0 };
    setIsEmojiPickerOpen(false);
    setEmojiSearchQuery("");
    setEmojiPickerTab("todos");
  }, [selectedConversationId]);

  const syncComposerSelection = useCallback((target: HTMLTextAreaElement | null) => {
    if (!target) {
      return;
    }

    composerSelectionRef.current = {
      start: target.selectionStart ?? target.value.length,
      end: target.selectionEnd ?? target.value.length,
    };
  }, []);

  const insertComposerEmoji = useCallback((emoji: string) => {
    const textarea = composerTextAreaRef.current;
    if (!textarea) {
      return;
    }

    const currentValue = textarea.value;
    const fallbackSelection = composerSelectionRef.current;
    const start = textarea.selectionStart ?? fallbackSelection.start ?? currentValue.length;
    const end = textarea.selectionEnd ?? fallbackSelection.end ?? currentValue.length;
    const nextCursor = start + emoji.length;

    textarea.setRangeText(emoji, start, end, "end");
    composerSelectionRef.current = { start: nextCursor, end: nextCursor };
    setIsEmojiPickerOpen(false);
    setEmojiSearchQuery("");
    setRecentComposerEmojis((current) => [emoji, ...current.filter((item) => item !== emoji)].slice(0, 24));

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }, []);

  const { messageHeights, totalMessageHeight } = useMemo(() => {
    const nextHeights = renderedMessages.map((message) => estimateMessageBubbleHeight(message));
    return {
      messageHeights: nextHeights,
      totalMessageHeight: nextHeights.reduce((sum, height) => sum + height, 0),
    };
  }, [renderedMessages]);

  const virtualizedMessages = useMemo(() => {
    if (renderedMessages.length <= MESSAGE_VIRTUALIZATION_THRESHOLD || viewportHeight <= 0) {
      return {
        start: 0,
        end: renderedMessages.length,
        topSpacer: 0,
        bottomSpacer: 0,
      };
    }

    const overscanTop = Math.max(0, scrollTop - MESSAGE_VIRTUALIZATION_OVERSCAN_PX);
    const overscanBottom = scrollTop + viewportHeight + MESSAGE_VIRTUALIZATION_OVERSCAN_PX;
    let start = 0;
    let accumulatedTop = 0;

    while (start < messageHeights.length && accumulatedTop + messageHeights[start] < overscanTop) {
      accumulatedTop += messageHeights[start];
      start += 1;
    }

    let end = start;
    let accumulatedBottom = accumulatedTop;

    while (end < messageHeights.length && accumulatedBottom < overscanBottom) {
      accumulatedBottom += messageHeights[end];
      end += 1;
    }

    return {
      start,
      end,
      topSpacer: accumulatedTop,
      bottomSpacer: Math.max(0, totalMessageHeight - accumulatedBottom),
    };
  }, [messageHeights, renderedMessages.length, scrollTop, totalMessageHeight, viewportHeight]);

  const visibleMessages = useMemo(() => {
    if (virtualizedMessages.start === 0 && virtualizedMessages.end === renderedMessages.length) {
      return renderedMessages;
    }

    return renderedMessages.slice(virtualizedMessages.start, virtualizedMessages.end);
  }, [renderedMessages, virtualizedMessages.end, virtualizedMessages.start]);

  return (
    <Card
      className={`${selectedConversationId ? "flex md:flex" : "!hidden md:flex"} chat-inbox-panel relative min-h-0 flex-1 overflow-hidden rounded-none border border-[rgba(148,163,184,0.14)] bg-transparent p-0 shadow-none md:h-full md:shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)]`}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={CHAT_MESSAGES_BACKGROUND_BASE_STYLE} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={CHAT_MESSAGES_BACKGROUND_OVERLAY_STYLE} />
      {renderedConversation ? (
        <div className="relative z-10 flex min-h-0 h-full w-full flex-1 flex-col">
          <div className="shrink-0 border-b border-[rgba(148,163,184,0.12)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcff_100%)] px-3 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.625rem)] md:px-[10px] md:py-[10px]">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Link
                  href={backHref}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[rgba(148,163,184,0.14)] bg-white text-slate-500 transition hover:bg-slate-50 md:hidden"
                  aria-label="Volver a chats"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>
                {(() => {
                  const headerTags = renderedConversation?.tags?.length ? renderedConversation.tags : selectedConversationTags;

                  return (
                <div
                  className={`flex min-w-0 items-center gap-3 transition-opacity duration-200 ease-out ${
                    hasSettledConversation ? "opacity-100" : "opacity-80"
                  }`}
                >
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger
                        type="button"
                        onClick={onOpenStatusDialog}
                        className={`group relative shrink-0 rounded-[22px] p-[2px] transition focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_18%,white)] ${
                          hasStatusMessages
                            ? "bg-gradient-to-br from-emerald-400 via-lime-300 to-cyan-400 shadow-[0_14px_28px_-18px_rgba(16,185,129,0.55)]"
                            : "bg-transparent"
                        }`}
                        aria-label={hasStatusMessages ? "Abrir estados de WhatsApp" : "Abrir detalles del contacto"}
                        title={hasStatusMessages ? "Estados" : "Contacto"}
                      >
                        <span className="relative block">
                          <ContactAvatar
                            avatarUrl={renderedConversation.avatarUrl}
                            label={renderedConversation.label}
                            className={`h-10 w-10 rounded-[18px] border border-[rgba(148,163,184,0.12)] bg-slate-100 text-slate-500 transition ${
                              hasStatusMessages ? "ring-2 ring-white" : ""
                            }`}
                            fallbackClassName="rounded-[18px] bg-slate-100 text-sm font-semibold text-slate-700"
                          />
                          {hasStatusMessages ? (
                            <span
                              aria-hidden="true"
                              className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500 shadow-[0_4px_10px_-4px_rgba(16,185,129,0.75)]"
                            />
                          ) : null}
                        </span>
                      </TooltipTrigger>
                      {renderedConversation.secondaryLabel ? (
                        <TooltipContent side="right">
                          {hasStatusMessages ? "Toca para ver estados" : renderedConversation.secondaryLabel}
                        </TooltipContent>
                      ) : null}
                    </Tooltip>
                  </TooltipProvider>
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <h2 className="truncate text-[13px] font-semibold text-slate-950 md:text-sm">
                        {renderedConversation.label}
                      </h2>
                      {renderedConversation.contactId ? (
                        <button
                          type="button"
                          onClick={onEditContact}
                          className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                          aria-label="Editar contacto"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={onOpenTags}
                        className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                        aria-label="Etiquetas"
                      >
                        <Tag className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {headerTags.length ? (
                      <div
                        className={`flex flex-wrap gap-1.5 transition-opacity duration-200 ease-out ${
                          hasSettledConversation ? "opacity-100" : "opacity-60"
                        }`}
                      >
                        {headerTags.map((tag) => (
                          <Badge
                            key={`${renderedConversation.id}:${tag.label}`}
                            className="max-w-full px-2.5 py-1 text-[10px] shadow-[0_8px_16px_-12px_rgba(15,23,42,0.45)]"
                            style={{
                              backgroundColor: tag.color,
                              color: "#ffffff",
                            }}
                            title={tag.label}
                          >
                            <span className="truncate">{tag.label}</span>
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                  );
                })()}
              </div>

              {hasSettledConversation && (headerActions || headerBadge) ? (
                <div className="flex shrink-0 items-center justify-end gap-2">
                  {headerActions}
                  {headerBadge}
                </div>
              ) : null}
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col bg-transparent">
            <ChatSelectionOverlay selectedConversationId={selectedConversationId} />
            <div className="relative min-h-0 flex-1">
              <div
                ref={messagesScrollRef}
                className="chat-messages-scroll h-full overflow-y-auto overscroll-contain bg-transparent px-2.5 py-2.5 pb-3 [-webkit-overflow-scrolling:touch] md:px-5 md:py-5 md:pb-5"
              >
                <div
                  className={`flex min-h-full flex-col justify-end transition-opacity duration-150 ease-out ${
                    !hasSettledConversation ? "opacity-85" : "opacity-100"
                  }`}
                >
                  {virtualizedMessages.topSpacer > 0 ? (
                    <div aria-hidden="true" style={{ height: virtualizedMessages.topSpacer }} />
                  ) : null}
                  {canLoadOlderMessages ? (
                    <div className="pb-2 pt-1">
                      <div ref={loadMoreSentinelRef} aria-hidden="true" className="h-px w-full" />
                      {renderedConversation.loadMoreHref ? (
                        <div className="flex justify-center">
                          <Link
                            href={renderedConversation.loadMoreHref}
                            scroll={false}
                            className="inline-flex items-center rounded-full border border-[rgba(148,163,184,0.16)] bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-800"
                          >
                            Cargar mensajes anteriores
                          </Link>
                        </div>
                      ) : isLoadingOlderMessages ? (
                        <div className="flex justify-center px-3 py-1.5">
                          <span
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[rgba(148,163,184,0.14)] bg-white text-slate-500 shadow-sm"
                            aria-label="Cargando historial"
                            role="status"
                          >
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                          </span>
                        </div>
                      ) : (
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={() => void onLoadOlderMessages()}
                            className="inline-flex items-center rounded-full border border-[rgba(148,163,184,0.16)] bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-800"
                          >
                            Cargar mensajes anteriores
                          </button>
                        </div>
                      )}
                    </div>
                  ) : null}
                  <div className="space-y-2.5 md:space-y-3">
                    {visibleMessages.map((message, index) => {
                      const absoluteIndex = virtualizedMessages.start + index;
                      return (
                        <MessageBubble
                          key={message.id}
                          message={message}
                          previousMessage={renderedMessages[absoluteIndex - 1]}
                        />
                      );
                    })}
                    {virtualizedMessages.bottomSpacer > 0 ? (
                      <div aria-hidden="true" style={{ height: virtualizedMessages.bottomSpacer }} />
                    ) : null}
                    {messageScrollBehavior === "preserve" ? (
                      <ChatScrollAnchor dependencyKey={selectedConversationScrollKey} behavior="preserve" />
                    ) : null}
                  </div>
                </div>
              </div>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={onScrollToBottom}
                  className="absolute bottom-4 right-4 z-10 flex cursor-pointer items-center gap-1.5 rounded-full bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur-sm transition hover:bg-slate-900"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                  {unreadCount}
                </button>
              ) : null}
            </div>

            {composer && renderedConversation ? (
              <div className="chat-composer z-20 shrink-0 border-t border-[rgba(148,163,184,0.12)] bg-white/96 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 shadow-[0_-12px_28px_-24px_rgba(15,23,42,0.2)] backdrop-blur md:border-t md:bg-white md:px-2 md:py-2 md:shadow-none md:backdrop-blur-0">
                <form
                  action={composer.action}
                  className="mx-auto w-full max-w-5xl"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    const form = event.currentTarget;
                    const formData = new FormData(form);
                    const message = String(formData.get("message") || "").trim();

                    if (!message || !renderedConversation) {
                      return;
                    }

                    onComposerDraft(message);
                  }}
                >
                  {composerHiddenFields.map((field) => (
                    <input key={`${field.name}-${field.value}`} type="hidden" name={field.name} value={field.value} />
                  ))}

                  <div className="flex items-end gap-2 md:gap-3">
                    <Popover
                      open={isEmojiPickerOpen}
                      onOpenChange={(open) => {
                        setIsEmojiPickerOpen(open);
                        if (!open) {
                          setEmojiSearchQuery("");
                        }
                      }}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full border border-[rgba(148,163,184,0.14)] bg-slate-50/80 text-slate-600 transition hover:border-[rgba(148,163,184,0.24)] hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_18%,white)] md:h-10 md:w-10"
                          aria-label="Abrir selector de emoticones"
                          title="Emoticones"
                        >
                          <Smile className="h-5 w-5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        side="top"
                        sideOffset={12}
                        className="w-[min(90vw,26rem)] rounded-[26px] border border-[rgba(148,163,184,0.14)] bg-white p-3.5 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.35)]"
                      >
                        <ComposerEmojiPicker
                          query={emojiSearchQuery}
                          activeTab={emojiPickerTab}
                          recentEmojis={recentComposerEmojis}
                          onQueryChange={setEmojiSearchQuery}
                          onActiveTabChange={setEmojiPickerTab}
                          onSelectEmoji={insertComposerEmoji}
                        />
                      </PopoverContent>
                    </Popover>
                    <textarea
                      ref={composerTextAreaRef}
                      name="message"
                      rows={1}
                      placeholder={composer.placeholder || "Escribe un mensaje..."}
                      onSelect={(event) => syncComposerSelection(event.currentTarget)}
                      onKeyUp={(event) => syncComposerSelection(event.currentTarget)}
                      onMouseUp={(event) => syncComposerSelection(event.currentTarget)}
                      onBlur={(event) => syncComposerSelection(event.currentTarget)}
                      className="flex min-h-[44px] flex-1 resize-none rounded-2xl border border-[rgba(148,163,184,0.14)] bg-slate-50/80 px-3 py-2.5 text-[14px] text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-[var(--primary)] focus:bg-white focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_18%,white)] md:min-h-[40px] md:py-2 md:text-sm"
                    />
                    <ComposerSendButton />
                  </div>
                </form>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex min-h-[74vh] items-center justify-center px-6 py-10 text-center">
          <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">
              <MessageSquareText className="h-5 w-5" />
            </span>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-slate-950">{emptySelectionTitle}</h3>
              <p className="text-sm leading-6 text-slate-600">
                {emptySelectionDescription}
              </p>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
});

export function SharedInbox({
  searchAction,
  selectedConversationId,
  mobileConversationActive = false,
  searchQuery,
  selectedConnectionKey = "",
  conversationListApiPath = "/api/cliente/chats/list",
  initialConversationBatchSize = 20,
  initialHasMoreConversations,
  sidebarItems = [],
  conversations,
  selectedConversation,
  selectedConversationTags = [],
  statusMessages = [],
  backHref,
  headerBadge,
  headerActions,
  composer,
  emptyListTitle,
  emptyListDescription,
  emptySelectionTitle,
  emptySelectionDescription,
  messageScrollBehavior = "bottom",
}: SharedInboxProps) {
  const [conversationItems, setConversationItems] = useState<SharedInboxConversationItem[]>(() =>
    normalizeConversationItems(conversations, (item) =>
      buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item),
    ),
  );
  const [hasMoreConversationItems, setHasMoreConversationItems] = useState(
    initialHasMoreConversations ?? conversations.length >= initialConversationBatchSize,
  );
  const [isLoadingMoreConversationItems, setIsLoadingMoreConversationItems] = useState(false);
  const [optimisticConversation, setOptimisticConversation] = useState<SharedInboxSelectedConversation | null>(null);
  const [liveConversation, setLiveConversation] = useState<SharedInboxSelectedConversation | null>(null);
  const [optimisticOutgoingMessage, setOptimisticOutgoingMessage] = useState<OptimisticDraftMessage | null>(null);
  const [editContactOpen, setEditContactOpen] = useState(false);
  const handleCloseEditContact = useCallback(() => setEditContactOpen(false), []);
  const [etiquetaModalOpen, setEtiquetaModalOpen] = useState(false);
  const handleCloseEtiquetaModal = useCallback(() => setEtiquetaModalOpen(false), []);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const handleOpenEditContact = useCallback(() => setEditContactOpen(true), []);
  const handleOpenEtiquetaModal = useCallback(() => setEtiquetaModalOpen(true), []);
  const [, startSelectionTransition] = useTransition();
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const prevScrollKeyRef = useRef("");
  const lastScrollTopRef = useRef(0);
  const historyLoadArmedRef = useRef(false);
  const historyLoadConsumedRef = useRef(false);
  const loadMoreHistoryInFlightRef = useRef(false);
  const loadMoreHistoryRestoreRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null);
  const selectedConversationDetailFollowUpTimerRef = useRef<number | null>(null);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasHydrated, setHasHydrated] = useState(false);
  const selectedConversationDetailInFlightRef = useRef<string | null>(null);
  const hasStatusMessages = statusMessages.length > 0;
  const handleOpenStatusDialog = useCallback(() => setStatusDialogOpen(true), []);
  // Ref sincronizada en cada render: permite leer el valor actual dentro de event
  // listeners sin declararlos como dependencia (evita re-registro en cada mensaje).
  const selectedConversationRef = useRef(selectedConversation);
  const router = useRouter();
  const [searchInputValue, setSearchInputValue] = useState(searchQuery);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listQueryKeyRef = useRef(`${searchQuery.trim()}::${selectedConnectionKey.trim()}`);

  useEffect(() => {
    if (searchInputRef.current && document.activeElement === searchInputRef.current) {
      return;
    }

    setSearchInputValue(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const buildSearchUrl = useCallback(
    (q: string) => {
      const params = new URLSearchParams();
      if (selectedConversationId) params.set("chatKey", selectedConversationId);
      if (selectedConnectionKey) params.set("connection", selectedConnectionKey);
      if (q) params.set("q", q);
      const qs = params.toString();
      return qs ? `${searchAction}?${qs}` : searchAction;
    },
    [searchAction, selectedConversationId, selectedConnectionKey],
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInputValue(value);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => {
        router.replace(buildSearchUrl(value.trim()));
      }, 350);
    },
    [buildSearchUrl, router],
  );

  const handleSearchClear = useCallback(() => {
    setSearchInputValue("");
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    router.replace(buildSearchUrl(""));
  }, [buildSearchUrl, router]);

  const loadMoreConversationItems = useCallback(async () => {
    if (isLoadingMoreConversationItems || !hasMoreConversationItems) {
      return;
    }

    const offset = conversationItems.length;
    if (offset <= 0) {
      return;
    }

    debugConversationList("loadMore start", {
      offset,
      currentCount: conversationItems.length,
      hasMoreConversationItems,
      searchQuery: searchQuery.trim(),
      selectedConnectionKey: selectedConnectionKey.trim(),
    });

    setIsLoadingMoreConversationItems(true);

    try {
      const params = new URLSearchParams();
      params.set("offset", String(offset));
      params.set("limit", String(CONVERSATION_LIST_LOAD_BATCH_SIZE));

      if (searchQuery.trim()) {
        params.set("q", searchQuery.trim());
      }

      if (selectedConnectionKey.trim()) {
        params.set("connection", selectedConnectionKey.trim());
      }

      const response = await fetch(`${conversationListApiPath}?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });

      if (!response.ok) {
        debugConversationList("loadMore response not ok", {
          status: response.status,
          offset,
        });
        return;
      }

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; conversations?: SharedInboxConversationItem[]; hasMore?: boolean }
        | null;

      if (!payload?.ok || !Array.isArray(payload.conversations)) {
        debugConversationList("loadMore invalid payload", {
          offset,
          payloadKeys: payload ? Object.keys(payload) : null,
        });
        return;
      }

      const normalizedPayloadConversations = normalizeConversationItems(payload.conversations, (item) =>
        buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item),
      );
      debugConversationList("loadMore payload", {
        offset,
        received: normalizedPayloadConversations.length,
        hasMore: payload.hasMore,
      });

      setConversationItems((current) => {
        const currentById = new Map(current.map((item) => [item.id, item]));
        const merged = [
          ...current,
          ...normalizedPayloadConversations.map((conversation) =>
            mergeConversationListItem(conversation, currentById.get(conversation.id) ?? null),
          ),
        ];
        const deduped = Array.from(new Map(merged.map((item) => [item.id, item])).values());
        const sorted = sortConversationItems(deduped);

        if (
          current.length === sorted.length &&
          current.every((item, index) => areConversationListItemsEqual(item, sorted[index]))
        ) {
          return current;
        }

        return sorted;
      });

      setHasMoreConversationItems(Boolean(payload.hasMore));
      debugConversationList("loadMore applied", {
        offset,
        nextHasMore: Boolean(payload.hasMore),
      });
    } catch {
      // Background pagination is opportunistic; failures should not block the UI.
      debugConversationList("loadMore failed", { offset });
    } finally {
      setIsLoadingMoreConversationItems(false);
    }
  }, [
    conversationItems.length,
    conversationListApiPath,
    hasMoreConversationItems,
    isLoadingMoreConversationItems,
    searchAction,
    searchQuery,
    selectedConnectionKey,
  ]);

  const pendingConversation = usePendingConversationSelection();

  useEffect(() => {
    if (selectedConversation && !selectedConversation.isPreview) {
      saveConversationToCache(selectedConversation);
    }
  }, [selectedConversation]);

  useEffect(() => {
    const nextListQueryKey = `${searchQuery.trim()}::${selectedConnectionKey.trim()}`;
    const queryChanged = listQueryKeyRef.current !== nextListQueryKey;
    listQueryKeyRef.current = nextListQueryKey;

    if (queryChanged) {
      setHasMoreConversationItems(initialHasMoreConversations ?? conversations.length >= initialConversationBatchSize);
      setConversationItems(
        normalizeConversationItems(conversations, (item) =>
          buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item),
        ),
      );
      return;
    }

    setConversationItems((current) => {
      if (current.length === 0) {
        return sortConversationItems(
          normalizeConversationItems(conversations, (item) =>
            buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item),
          ),
        );
      }

      const currentById = new Map(current.map((item) => [item.id, item]));
      const merged = normalizeConversationItems(conversations, (item) =>
        buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item),
      ).map((conversation) =>
        mergeConversationListItem(conversation, currentById.get(conversation.id) ?? null),
      );
      const sorted = sortConversationItems(merged);

      if (
        current.length === sorted.length &&
        current.every((item, index) => areConversationListItemsEqual(item, sorted[index]))
      ) {
        return current;
      }

      return sorted;
    });
  }, [conversations, initialConversationBatchSize, initialHasMoreConversations, searchAction, searchQuery, selectedConnectionKey]);

  useEffect(() => {
    selectedConversationRef.current = selectedConversation;
  }, [selectedConversation]);

  useEffect(() => {
    if (liveConversation && !conversationIdMatchesKey(selectedConversationId, liveConversation.id)) {
      setLiveConversation(null);
    }
  }, [liveConversation, pendingConversation?.id, selectedConversationId]);

  useEffect(() => {
    return () => {
      clearPendingConversationSelection();
    };
  }, []);

  // Clave efectiva del chat activo. Sirve para sincronizar el panel y para
  // evitar que el listado se reordene cuando el evento pertenece al chat abierto.
  const selectedConversationKey = (pendingConversation?.chatKey ?? selectedConversationId).trim();
  const selectedConversationCache = useMemo(
    () => (hasHydrated && selectedConversationKey ? readConversationFromCache(selectedConversationKey) : null),
    [hasHydrated, selectedConversationKey],
  );
  const selectedConversationMatchesCurrentKey =
    Boolean(selectedConversation && conversationIdMatchesKey(selectedConversationKey, selectedConversation.id));
  const currentSelectedConversation = selectedConversationMatchesCurrentKey ? selectedConversation : null;
  const currentSelectedConversationHasContent = Boolean(currentSelectedConversation?.messages.length && !currentSelectedConversation?.isPreview);
  const currentSelectedConversationHasContentRef = useRef(currentSelectedConversationHasContent);
  currentSelectedConversationHasContentRef.current = currentSelectedConversationHasContent;
  const cachedConversationForCurrentSelection =
    selectedConversationCache && conversationIdMatchesKey(selectedConversationKey, selectedConversationCache.id)
      ? selectedConversationCache
      : null;
  useEffect(() => {
    if (!optimisticOutgoingMessage) {
      return;
    }

    const timer = window.setTimeout(() => {
      setOptimisticOutgoingMessage(null);
    }, 12000);

    return () => window.clearTimeout(timer);
  }, [optimisticOutgoingMessage]);

  useEffect(() => {
    if (!pendingConversation?.id) {
      return;
    }

    const cacheKey = pendingConversation.cacheKey || pendingConversation.id;
    const cachedConversation = readConversationFromCache(cacheKey);

    startSelectionTransition(() => {
      setLiveConversation(null);
      setOptimisticConversation(
        cachedConversation
          ? {
              ...cachedConversation,
              tags: cachedConversation.tags?.length ? cachedConversation.tags : pendingConversation.tags ?? [],
            }
          : buildPendingConversationPreview(pendingConversation),
      );
    });
  }, [pendingConversation, startSelectionTransition]);

  useEffect(() => {
    function handleLiveUpdate(event: Event) {
      const customEvent = event as CustomEvent<{ conversation?: unknown }>;
      const snapshot = normalizeLiveConversationSnapshot(customEvent.detail?.conversation);
      const effectiveSelectedKey = pendingConversation?.chatKey ?? selectedConversationId;

      if (!snapshot || !conversationIdMatchesKey(effectiveSelectedKey, snapshot.id)) {
        return;
      }

      setLiveConversation((current) => {
        // Si current pertenece a una conversación diferente (liveConversation nunca se
        // resetea al navegar), usarlo como base haría que mergeCachedMessages concatene
        // mensajes de dos chats distintos. Solo se usa current si es del mismo chat.
        const base = (current && current.id === snapshot.id)
          ? current
          : (selectedConversationRef.current ?? null);
        return mergeConversationSnapshotIfChanged(base, snapshot);
      });
      setConversationItems((current) => {
        const currentItem = findConversationItemBySnapshotId(current, snapshot.id) ?? undefined;
        const updatedItem = buildConversationItemFromSnapshot(snapshot, currentItem);
        return updateConversationItemInSortedList(current, snapshot.id, updatedItem);
      });
    }

    window.addEventListener("chat-live-update", handleLiveUpdate as EventListener);
    return () => window.removeEventListener("chat-live-update", handleLiveUpdate as EventListener);
  }, [pendingConversation?.chatKey, selectedConversationId]);

  useEffect(() => {
    function handleListUpdate(event: Event) {
      const customEvent = event as CustomEvent<{ conversation?: unknown }>;
      const snapshot = normalizeLiveConversationListSnapshot(customEvent.detail?.conversation);
      if (!snapshot) {
        return;
      }

      setConversationItems((current) => {
        const currentItem = findConversationItemBySnapshotId(current, snapshot.id) ?? undefined;
        const updatedItem = buildConversationItemFromListSnapshot(snapshot, currentItem);
        return updateConversationItemInSortedList(current, snapshot.id, updatedItem);
      });
    }

    window.addEventListener("chat-list-update", handleListUpdate as EventListener);
    return () => window.removeEventListener("chat-list-update", handleListUpdate as EventListener);
  }, []);

  useEffect(() => {
    function handleContactUpdate(event: Event) {
      const customEvent = event as CustomEvent<ConversationContactUpdateDetail>;
      const detail = customEvent.detail;

      if (!detail?.contactId || !detail.name?.trim()) {
        return;
      }

      setConversationItems((current) =>
        updateConversationItemByContact(current, detail.contactId, (item) => {
          const nextLabel = detail.name.trim();
          if (item.label === nextLabel) {
            return item;
          }

          return {
            ...item,
            label: nextLabel,
          };
        }),
      );

      setLiveConversation((current) => {
        const baseConversation = current ?? selectedConversationRef.current ?? null;
        if (!baseConversation || baseConversation.contactId !== detail.contactId) {
          return current;
        }

        return {
          ...baseConversation,
          label: detail.name.trim(),
          contactName: detail.name.trim(),
        };
      });

      setOptimisticConversation((current) => {
        if (!current || current.contactId !== detail.contactId) {
          return current;
        }

        return {
          ...current,
          label: detail.name.trim(),
          contactName: detail.name.trim(),
        };
      });
    }

    window.addEventListener("chat-contact-updated", handleContactUpdate as EventListener);
    return () => window.removeEventListener("chat-contact-updated", handleContactUpdate as EventListener);
  }, []);

  useEffect(() => {
    function handleTagsUpdate(event: Event) {
      const customEvent = event as CustomEvent<ConversationTagsUpdateDetail>;
      const detail = customEvent.detail;

      if (!detail?.contactId) {
        return;
      }

      setConversationItems((current) =>
        updateConversationItemByContact(current, detail.contactId, (item) => {
          if (areTagListsEqual(item.tags ?? [], detail.tags)) {
            return item;
          }

          return {
            ...item,
            tags: detail.tags,
          };
        }),
      );

      setLiveConversation((current) => {
        const baseConversation = current ?? selectedConversationRef.current ?? null;
        if (!baseConversation || baseConversation.contactId !== detail.contactId) {
          return current;
        }

        return {
          ...baseConversation,
          tags: detail.tags,
        };
      });

      setOptimisticConversation((current) => {
        if (!current || current.contactId !== detail.contactId) {
          return current;
        }

        return {
          ...current,
          tags: detail.tags,
        };
      });
    }

    window.addEventListener("chat-tags-updated", handleTagsUpdate as EventListener);
    return () => window.removeEventListener("chat-tags-updated", handleTagsUpdate as EventListener);
  }, []);

  useEffect(() => {
    const normalizedSelectedConversationId = (pendingConversation?.chatKey ?? selectedConversationId).trim();

    if (!normalizedSelectedConversationId.startsWith("agent:")) {
      return;
    }

    if (currentSelectedConversationHasContentRef.current) {
      return;
    }

    if (selectedConversationDetailInFlightRef.current === normalizedSelectedConversationId) {
      return;
    }

    selectedConversationDetailInFlightRef.current = normalizedSelectedConversationId;

    const controller = new AbortController();
    let cancelled = false;

    async function loadSelectedConversationDetail() {
      try {
        const response = await fetch(`/api/cliente/chats/live?chatKey=${encodeURIComponent(normalizedSelectedConversationId)}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok || cancelled) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; conversation?: unknown }
          | null;

        if (!payload?.ok || !payload.conversation || cancelled) {
          return;
        }

        const snapshot = normalizeLiveConversationSnapshot(payload.conversation);
        if (!snapshot || cancelled) {
          return;
        }

        setLiveConversation((current) => {
          const base = current && conversationIdMatchesKey(current.id, snapshot.id)
            ? current
            : (selectedConversationRef.current && conversationIdMatchesKey(selectedConversationRef.current.id, snapshot.id)
                ? selectedConversationRef.current
                : selectedConversationRef.current ?? null);
          return mergeConversationSnapshotIfChanged(base, snapshot);
        });
      } catch {
        // Intentional no-op: si falla, la vista cacheada/preview sigue siendo usable.
      } finally {
        if (selectedConversationDetailInFlightRef.current === normalizedSelectedConversationId) {
          selectedConversationDetailInFlightRef.current = null;
        }
      }
    }

    void loadSelectedConversationDetail();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [pendingConversation?.chatKey, selectedConversationId]);

  useEffect(() => {
    const normalizedSelectedConversationId = (pendingConversation?.chatKey ?? selectedConversationId).trim();

    if (!normalizedSelectedConversationId.startsWith("agent:")) {
      return;
    }

    if (selectedConversationDetailFollowUpTimerRef.current !== null) {
      window.clearTimeout(selectedConversationDetailFollowUpTimerRef.current);
    }

    selectedConversationDetailFollowUpTimerRef.current = window.setTimeout(() => {
      selectedConversationDetailFollowUpTimerRef.current = null;
      void fetch(`/api/cliente/chats/live?chatKey=${encodeURIComponent(normalizedSelectedConversationId)}`, {
        credentials: "same-origin",
        cache: "no-store",
      })
        .then((response) => (response.ok ? response.json().catch(() => null) : null))
        .then((payload) => {
          const snapshot = normalizeLiveConversationSnapshot((payload as { conversation?: unknown } | null)?.conversation);
          if (!snapshot) {
            return;
          }

          setLiveConversation((current) => {
            const base = current && conversationIdMatchesKey(current.id, snapshot.id)
              ? current
              : (selectedConversationRef.current && conversationIdMatchesKey(selectedConversationRef.current.id, snapshot.id)
                  ? selectedConversationRef.current
                  : selectedConversationRef.current ?? null);
            return mergeConversationSnapshotIfChanged(base, snapshot);
          });
        })
        .catch(() => null);
    }, 2500);

    return () => {
      if (selectedConversationDetailFollowUpTimerRef.current !== null) {
        window.clearTimeout(selectedConversationDetailFollowUpTimerRef.current);
        selectedConversationDetailFollowUpTimerRef.current = null;
      }
    };
  }, [pendingConversation?.chatKey, selectedConversationId]);

  const effectiveLiveConversation =
    liveConversation && conversationIdMatchesKey(selectedConversationId, liveConversation.id) ? liveConversation : null;
  const liveOrCachedConversation = useMemo(
    () =>
      mergeConversationSnapshots(
        currentSelectedConversation ?? null,
        effectiveLiveConversation ?? selectedConversationCache ?? cachedConversationForCurrentSelection,
      ),
    [
      cachedConversationForCurrentSelection,
      currentSelectedConversation,
      effectiveLiveConversation,
      selectedConversationCache,
    ],
  );
  const hasLoadedSelectedConversationContent = Boolean(
    liveOrCachedConversation &&
      conversationIdMatchesKey(selectedConversationId, liveOrCachedConversation.id) &&
      liveOrCachedConversation.messages.length > 0,
  );
  const pendingConversationPreview = useMemo(
    () => {
      if (!pendingConversation) {
        return null;
      }

      if (optimisticConversation && conversationIdMatchesKey(pendingConversation.id, optimisticConversation.id)) {
        return optimisticConversation;
      }

      return buildPendingConversationPreview(pendingConversation);
    },
    [optimisticConversation, pendingConversation],
  );

  const renderedConversation = useMemo(() => {
    if (!pendingConversationPreview) {
      return liveOrCachedConversation;
    }

    if (!liveOrCachedConversation || pendingConversationPreview.id !== liveOrCachedConversation.id) {
      return pendingConversationPreview;
    }

    const previewLastMessage = pendingConversationPreview.messages.at(-1) ?? null;
    const currentLastMessage = liveOrCachedConversation.messages.at(-1) ?? null;

    if (!previewLastMessage) {
      return liveOrCachedConversation;
    }

    if (!currentLastMessage) {
      return pendingConversationPreview;
    }

    const previewAt = previewLastMessage.createdAt.getTime();
    const currentAt = currentLastMessage.createdAt.getTime();

    if (previewAt > currentAt) {
      return pendingConversationPreview;
    }

    if (previewAt === currentAt) {
      const previewContent = previewLastMessage.content?.trim() || "";
      const currentContent = currentLastMessage.content?.trim() || "";
      const previewDirection = previewLastMessage.direction;
      const currentDirection = currentLastMessage.direction;
      const previewIsMedia = Boolean(getMediaPreviewLabel(previewLastMessage.type));

      if (previewIsMedia) {
        return liveOrCachedConversation;
      }

      if (previewContent !== currentContent || previewDirection !== currentDirection) {
        return pendingConversationPreview;
      }
    }

    return liveOrCachedConversation;
  }, [liveOrCachedConversation, pendingConversationPreview]);

  useEffect(() => {
    if (!pendingConversation?.id || pendingConversation.id !== selectedConversationId) {
      return;
    }

    historyLoadArmedRef.current = false;
    lastScrollTopRef.current = 0;
    setIsLoadingOlderMessages(false);

    if (hasLoadedSelectedConversationContent) {
      clearPendingConversationSelection();
      setOptimisticConversation(null);
    }
  }, [hasLoadedSelectedConversationContent, pendingConversation?.id, selectedConversationId]);

  useEffect(() => {
    if (!renderedConversation || renderedConversation.isPreview) {
      return;
    }

    saveConversationToCache(renderedConversation);
  }, [renderedConversation]);

  const loadOlderMessages = useCallback(async () => {
    const conversation = renderedConversation;
    const loadMoreCursor = conversation?.loadMoreCursor?.trim() || "";
    const chatKey = conversation?.cacheKey?.trim() || selectedConversationId.trim();
    let shouldRestoreScroll = false;

    if (
      !conversation ||
      !chatKey ||
      !loadMoreCursor ||
      !conversation.hasMoreMessages ||
      loadMoreHistoryInFlightRef.current
    ) {
      return;
    }

    const container = messagesScrollRef.current;
    if (!container) {
      return;
    }

    loadMoreHistoryInFlightRef.current = true;
    setIsLoadingOlderMessages(true);
    loadMoreHistoryRestoreRef.current = {
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
    };

    try {
      const response = await fetch(
        `/api/cliente/chats/live?chatKey=${encodeURIComponent(chatKey)}&beforeMessageId=${encodeURIComponent(loadMoreCursor)}&batchSize=10`,
        {
          credentials: "same-origin",
          cache: "no-store",
        },
      );

      if (!response.ok) {
        return;
      }

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; conversation?: unknown }
        | null;

      if (!payload?.ok || !payload.conversation) {
        return;
      }

      const snapshot = normalizeLiveConversationSnapshot(payload.conversation);
      if (!snapshot) {
        return;
      }

      shouldRestoreScroll = true;
      setLiveConversation((current) => {
        const base = current && conversationIdMatchesKey(current.id, snapshot.id)
          ? current
          : (selectedConversationRef.current && conversationIdMatchesKey(selectedConversationRef.current.id, snapshot.id)
              ? selectedConversationRef.current
              : selectedConversation ?? null);
        return mergeConversationSnapshotIfChanged(base, snapshot);
      });
    } catch {
      // Ignore loading failures so scroll never gets blocked.
    } finally {
      if (!shouldRestoreScroll) {
        loadMoreHistoryRestoreRef.current = null;
      }
      loadMoreHistoryInFlightRef.current = false;
      setIsLoadingOlderMessages(false);
    }
  }, [renderedConversation, selectedConversation, selectedConversationId]);

  const optimisticDraftMatchesLatestMessage =
    Boolean(
      optimisticOutgoingMessage &&
        renderedConversation &&
        renderedConversation.id === optimisticOutgoingMessage.conversationId &&
        renderedConversation.messages.at(-1)?.direction === "OUTBOUND" &&
        renderedConversation.messages.at(-1)?.content?.trim() === optimisticOutgoingMessage.content?.trim(),
    );
  const optimisticDraftHasPersistedMatch =
    Boolean(
      optimisticOutgoingMessage &&
        renderedConversation &&
        renderedConversation.id === optimisticOutgoingMessage.conversationId &&
        renderedConversation.messages.some((message) =>
          message.direction === "OUTBOUND" &&
          message.type === optimisticOutgoingMessage.type &&
          message.content?.trim() === optimisticOutgoingMessage.content?.trim() &&
          Math.abs(message.createdAt.getTime() - optimisticOutgoingMessage.createdAt.getTime()) < 120_000,
        ),
    );
  const renderedMessages = useMemo(
    () =>
      renderedConversation &&
      optimisticOutgoingMessage &&
      renderedConversation.id === optimisticOutgoingMessage.conversationId &&
      !optimisticDraftMatchesLatestMessage &&
      !optimisticDraftHasPersistedMatch
        ? [...renderedConversation.messages, optimisticOutgoingMessage]
        : renderedConversation?.messages ?? [],
    [optimisticDraftHasPersistedMatch, optimisticDraftMatchesLatestMessage, optimisticOutgoingMessage, renderedConversation],
  );

  useEffect(() => {
    if (!optimisticOutgoingMessage || !renderedConversation) {
      return;
    }

    if (renderedConversation.id !== optimisticOutgoingMessage.conversationId) {
      return;
    }

    if (!optimisticDraftHasPersistedMatch) {
      return;
    }

    setOptimisticOutgoingMessage(null);
  }, [optimisticDraftHasPersistedMatch, optimisticOutgoingMessage, renderedConversation]);

  const handleComposerDraft = useCallback(
    (message: string) => {
      if (!renderedConversation) {
        return;
      }

      const now = new Date();
      const optimisticListSnapshot = {
        id: renderedConversation.id,
        label: renderedConversation.label,
        secondaryLabel: renderedConversation.secondaryLabel,
        tags: renderedConversation.tags ?? [],
        avatarUrl: renderedConversation.avatarUrl ?? null,
        incomingCount: 0,
        lastMessage: message,
        lastMessageType: "TEXT" as const,
        lastMessageDirection: "OUTBOUND" as const,
        lastMessageAt: now,
        channelType: selectedConversationId.startsWith("official:") ? "whatsapp_official" : "whatsapp",
      };

      setOptimisticOutgoingMessage({
        id: `optimistic:${renderedConversation.id}:${Date.now()}`,
        conversationId: renderedConversation.id,
        content: message,
        direction: "OUTBOUND",
        createdAt: now,
        authorType: "user",
        outboundStatusLabel: "enviando",
        type: "TEXT",
        mediaUrl: null,
        rawPayload: { optimistic: true },
        isOptimistic: true,
      });

      window.dispatchEvent(
        new CustomEvent("chat-list-update", {
          detail: {
            conversation: optimisticListSnapshot,
          },
        }),
      );

    },
    [renderedConversation, selectedConversationId],
  );
  const hasSettledConversation = Boolean(renderedConversation && currentSelectedConversation && renderedConversation.id === currentSelectedConversation.id);
  const canLoadOlderMessages = Boolean(renderedConversation?.loadMoreCursor && renderedConversation.hasMoreMessages);
  const loadOlderMessagesRef = useRef(loadOlderMessages);
  loadOlderMessagesRef.current = loadOlderMessages;
  const canLoadOlderMessagesRef = useRef(canLoadOlderMessages);
  canLoadOlderMessagesRef.current = canLoadOlderMessages;
  const loadMoreHrefRef = useRef(renderedConversation?.loadMoreHref ?? null);
  loadMoreHrefRef.current = renderedConversation?.loadMoreHref ?? null;
  const messageScrollBehaviorRef = useRef(messageScrollBehavior);
  messageScrollBehaviorRef.current = messageScrollBehavior;
  const settledConversationBottomScrollAppliedRef = useRef("");
  const settledConversationBottomScrollTimeoutRef = useRef<number | null>(null);
  const composerHiddenFields = composer
    ? buildComposerHiddenFields(
        composer.hiddenFields,
        pendingConversation && pendingConversation.id === renderedConversation?.id ? pendingConversation : null,
      )
    : [];
  const selectedConversationScrollKey = renderedConversation
    ? `${renderedConversation.id}:${renderedMessages.length}:${renderedMessages.at(-1)?.id ?? ""}`
    : "empty";
  const selectedConversationMessageCount = useMemo(() => {
    if (selectedConversationScrollKey === "empty") {
      return 0;
    }

    const count = Number(selectedConversationScrollKey.split(":")[1]);
    return Number.isFinite(count) ? count : 0;
  }, [selectedConversationScrollKey]);
  const hasSidebar = sidebarItems.length > 0;

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  // Reset scroll state when the user opens a different conversation.
  useEffect(() => {
    isNearBottomRef.current = true;
    setUnreadCount(0);
    prevScrollKeyRef.current = "";
    lastScrollTopRef.current = 0;
    historyLoadArmedRef.current = false;
    historyLoadConsumedRef.current = false;
    settledConversationBottomScrollAppliedRef.current = "";
    if (settledConversationBottomScrollTimeoutRef.current !== null) {
      window.clearTimeout(settledConversationBottomScrollTimeoutRef.current);
      settledConversationBottomScrollTimeoutRef.current = null;
    }
  }, [selectedConversationId]);

  // Track whether the user is near the bottom of the message list and only arm
  // older-history loading after the user actually scrolls upward.
  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    const BOTTOM_SCROLL_THRESHOLD_PX = 24;
    const TOP_SCROLL_THRESHOLD_PX = 96;

    function handleScroll() {
      const el = container!;
      const nextScrollTop = el.scrollTop;
      const previousScrollTop = lastScrollTopRef.current;

      if (nextScrollTop < previousScrollTop) {
        historyLoadArmedRef.current = true;
      }

      if (nextScrollTop > TOP_SCROLL_THRESHOLD_PX) {
        historyLoadConsumedRef.current = false;
      }

      lastScrollTopRef.current = nextScrollTop;

      const distFromBottom = el.scrollHeight - nextScrollTop - el.clientHeight;
      isNearBottomRef.current = distFromBottom <= BOTTOM_SCROLL_THRESHOLD_PX;
      if (isNearBottomRef.current) setUnreadCount(0);

      if (
        !historyLoadArmedRef.current ||
        historyLoadConsumedRef.current ||
        nextScrollTop > TOP_SCROLL_THRESHOLD_PX ||
        loadMoreHistoryInFlightRef.current
      ) {
        return;
      }

      historyLoadArmedRef.current = false;
      historyLoadConsumedRef.current = true;

      const loadMoreHref = loadMoreHrefRef.current;
      if (loadMoreHref && messageScrollBehaviorRef.current === "preserve") {
        router.replace(loadMoreHref, { scroll: false });
        return;
      }

      if (canLoadOlderMessagesRef.current) {
        void loadOlderMessagesRef.current();
      }
    }

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [router]);

  // Smart scroll: auto-scroll only when near bottom; count new messages when scrolled up.
  useLayoutEffect(() => {
    if (messageScrollBehavior !== "bottom") return;

    const container = messagesScrollRef.current;
    const currentKey = selectedConversationScrollKey;
    const prevKey = prevScrollKeyRef.current;
    prevScrollKeyRef.current = currentKey;

    if (currentKey === "empty" || !container) return;

    if (loadMoreHistoryRestoreRef.current) {
      const restore = loadMoreHistoryRestoreRef.current;
      const delta = container.scrollHeight - restore.scrollHeight;
      container.scrollTop = Math.max(0, restore.scrollTop + delta);
      loadMoreHistoryRestoreRef.current = null;
      return;
    }

    const jumpToBottom = (smooth: boolean) => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }

      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = window.requestAnimationFrame(() => {
          if (smooth) {
            container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
          } else {
            container.scrollTop = container.scrollHeight;
          }

          isNearBottomRef.current = true;
          setUnreadCount(0);
          scrollFrameRef.current = null;
        });
      });
    };

    if (!prevKey || prevKey === "empty") {
      // Initial load — jump to bottom without animation.
      jumpToBottom(false);
      return;
    }

    const prevConvId = prevKey.split(":")[0];
    const curConvId = currentKey.split(":")[0];

    if (prevConvId !== curConvId) {
      // Different conversation opened — always jump to bottom.
      jumpToBottom(false);
      return;
    }

    // Same conversation: check for appended messages.
    const prevCount = Number(prevKey.split(":")[1]) || 0;
    const curCount = Number(currentKey.split(":")[1]) || 0;
    const added = curCount - prevCount;
    if (added <= 0) return;

    // First messages arriving (0 → N): always jump to bottom regardless of scroll position.
    if (prevCount === 0) {
      jumpToBottom(false);
      return;
    }

    // Transition from a lightweight preview (usually 1 message) to the real chat:
    // use a hard jump so the final hydration doesn't leave the viewport slightly above.
    if (prevCount <= 1) {
      jumpToBottom(false);
      return;
    }

    if (isNearBottomRef.current) {
      jumpToBottom(true);
    } else {
      setUnreadCount((prev) => prev + added);
    }
  }, [selectedConversationScrollKey, messageScrollBehavior]);

  useLayoutEffect(() => {
    if (messageScrollBehavior !== "bottom") {
      return;
    }

    if (!hasSettledConversation || selectedConversationMessageCount <= 1) {
      return;
    }

    if (settledConversationBottomScrollAppliedRef.current === selectedConversationId) {
      return;
    }

    const container = messagesScrollRef.current;
    if (!container) {
      return;
    }

    settledConversationBottomScrollAppliedRef.current = selectedConversationId;

    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
      isNearBottomRef.current = true;
      setUnreadCount(0);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    hasSettledConversation,
    messageScrollBehavior,
    selectedConversationId,
    selectedConversationMessageCount,
  ]);

  useEffect(() => {
    if (messageScrollBehavior !== "bottom") {
      return;
    }

    if (!hasSettledConversation || selectedConversationMessageCount <= 1) {
      return;
    }

    if (!selectedConversationId) {
      return;
    }

    if (settledConversationBottomScrollTimeoutRef.current !== null) {
      window.clearTimeout(settledConversationBottomScrollTimeoutRef.current);
    }

    settledConversationBottomScrollTimeoutRef.current = window.setTimeout(() => {
      const container = messagesScrollRef.current;
      if (!container) {
        return;
      }

      container.scrollTop = container.scrollHeight;
      isNearBottomRef.current = true;
      setUnreadCount(0);
      settledConversationBottomScrollTimeoutRef.current = null;
    }, 180);

    return () => {
      if (settledConversationBottomScrollTimeoutRef.current !== null) {
        window.clearTimeout(settledConversationBottomScrollTimeoutRef.current);
        settledConversationBottomScrollTimeoutRef.current = null;
      }
    };
  }, [
    hasSettledConversation,
    messageScrollBehavior,
    selectedConversationId,
    selectedConversationMessageCount,
  ]);

  const scrollToBottom = useCallback(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    isNearBottomRef.current = true;
    setUnreadCount(0);
  }, []);

  return (
    <>
    <div
      className={`chat-inbox-grid flex h-full min-h-0 flex-1 flex-col gap-0 overflow-hidden md:grid ${
        hasSidebar ? "md:grid-cols-[250px_360px_minmax(0,1fr)]" : "md:grid-cols-[380px_minmax(0,1fr)]"
      }`}
    >
      {hasSidebar ? (
        <div className="hidden chat-inbox-sidebar min-h-0 overflow-hidden rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#171717] p-0 text-white shadow-[0_28px_70px_-42px_rgba(15,23,42,0.42)] md:flex md:h-full">
          <div className="flex min-h-0 w-full flex-col">
            <div className="border-b border-white/8 px-4 py-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/90">
                  <MessageSquareText className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold tracking-[-0.03em] text-white">Chats</p>
                  <p className="text-[11px] text-white/45">Conexiones creadas</p>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
              <nav className="space-y-1">
                {sidebarItems.map((item) => {
                  const isActive = item.isActive || selectedConnectionKey === item.id;
                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      className={`group flex items-center gap-3 rounded-2xl px-3 py-2.5 transition ${
                        isActive ? "bg-white/8 text-white" : "text-white/72 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <span
                        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
                          isActive ? "border-white/16 bg-white/8" : "border-white/8 bg-white/4"
                        }`}
                      >
                        {item.channelType === "whatsapp_official" ? (
                          <BadgeCheck className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <MessageCircle className="h-4 w-4 text-emerald-400" />
                        )}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.label}</p>
                        {item.helper ? <p className="truncate text-[11px] text-white/42">{item.helper}</p> : null}
                      </div>

                      <ChevronRight
                        className={`h-4 w-4 shrink-0 transition ${
                          isActive ? "translate-x-0 text-white/75" : "text-white/28 group-hover:text-white/55"
                        }`}
                      />
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>
      ) : null}

      <AppSidebar
        conversationItems={conversationItems}
        selectedConversationId={selectedConversationId}
        searchAction={searchAction}
        selectedConnectionKey={selectedConnectionKey}
        searchInputValue={searchInputValue}
        searchInputRef={searchInputRef}
        onSearchChange={handleSearchChange}
        onSearchClear={handleSearchClear}
        onSearchSubmit={() => {
          if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        }}
        hasMoreConversationItems={hasMoreConversationItems}
        isLoadingMoreConversationItems={isLoadingMoreConversationItems}
        onLoadMoreConversationItems={loadMoreConversationItems}
        mobileConversationActive={mobileConversationActive}
        emptyListTitle={emptyListTitle}
        emptyListDescription={emptyListDescription}
      />

      <ConversationPanel
        key={mobileConversationActive ? (selectedConversationId || "selected") : "empty"}
        backHref={backHref}
        composer={composer}
        composerHiddenFields={composerHiddenFields}
        hasStatusMessages={hasStatusMessages}
        hasSettledConversation={hasSettledConversation}
        isLoadingOlderMessages={isLoadingOlderMessages}
        loadMoreSentinelRef={loadMoreSentinelRef}
        messageScrollBehavior={messageScrollBehavior}
        messagesScrollRef={messagesScrollRef}
        unreadCount={unreadCount}
        onScrollToBottom={scrollToBottom}
        onOpenStatusDialog={handleOpenStatusDialog}
        onEditContact={handleOpenEditContact}
        onOpenTags={handleOpenEtiquetaModal}
        onComposerDraft={handleComposerDraft}
        onLoadOlderMessages={loadOlderMessages}
        renderedConversation={renderedConversation}
        renderedMessages={renderedMessages}
        selectedConversationId={selectedConversationId}
        selectedConversationScrollKey={selectedConversationScrollKey}
        selectedConversationTags={selectedConversationTags}
        emptySelectionTitle={emptySelectionTitle}
        emptySelectionDescription={emptySelectionDescription}
        headerActions={headerActions}
        headerBadge={headerBadge}
      />
    </div>

    {renderedConversation?.contactId ? (
      <EditContactModal
        open={editContactOpen}
        onClose={handleCloseEditContact}
        contactId={renderedConversation.contactId}
        contactName={renderedConversation.contactName ?? renderedConversation.label}
      />
    ) : null}
    <EtiquetaModal
      open={etiquetaModalOpen}
      onClose={handleCloseEtiquetaModal}
      contactId={renderedConversation?.contactId}
    />
    <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
      <DialogContent className="w-[min(92vw,34rem)] max-w-none overflow-hidden border border-[rgba(148,163,184,0.14)] bg-white p-0 shadow-[0_30px_80px_-36px_rgba(15,23,42,0.45)]">
        <div className="border-b border-[rgba(148,163,184,0.12)] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-5 py-4">
          <DialogHeader className="text-left">
            <DialogTitle>Estados de WhatsApp</DialogTitle>
            <DialogDescription>
              {renderedConversation?.secondaryLabel
                ? `Estados sincronizados para ${renderedConversation.secondaryLabel}`
                : "Estados sincronizados para este contacto"}
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto p-5">
          {hasStatusMessages ? (
            statusMessages.slice(0, 8).map((message) => {
              const previewText =
                message.content?.trim() ||
                (message.type === "IMAGE"
                  ? "Foto"
                  : message.type === "VIDEO"
                    ? "Video"
                    : message.type === "AUDIO"
                      ? "Audio"
                      : message.type === "DOCUMENT"
                        ? "Documento"
                        : "Estado");

              return (
                <div
                  key={message.id}
                  className="rounded-2xl border border-[rgba(148,163,184,0.12)] bg-slate-50/80 p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 via-lime-300 to-cyan-400 p-[2px]">
                      <div className="flex h-full w-full items-center justify-center rounded-full bg-white text-emerald-600">
                        <MessageCircle className="h-4 w-4" />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-semibold text-slate-950">{previewText}</p>
                        <Badge variant="outline" className="h-5 border-emerald-200 bg-emerald-50 px-2 text-[10px] text-emerald-700">
                          {message.type ?? "TEXT"}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-500">{formatChatTime(message.createdAt)}</p>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[rgba(148,163,184,0.18)] bg-slate-50/70 px-6 py-10 text-center">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-[0_8px_24px_-18px_rgba(15,23,42,0.35)]">
                <MessageCircle className="h-5 w-5" />
              </span>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">No hay estados sincronizados</p>
                <p className="text-sm text-slate-500">
                  Si Evolution expone estados para este chat, aparecerán aquí al tocar la foto.
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}



