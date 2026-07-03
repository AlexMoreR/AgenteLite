"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type ComponentType, type FormEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  BadgeCheck,
  AlertTriangle,
  Bot,
  CarFront,
  Clock3,
  ChevronRight,
  CheckCheck,
  ChevronDown,
  Copy,
  Forward,
  Pin,
  Reply,
  Star,
  Coffee,
  Facebook,
  Flag,
  Flower2,
  Grid2x2,
  Headphones,
  ImageIcon,
  Lightbulb,
  MessageCircle,
  MessageSquareText,
  FileText,
  LoaderCircle,
  Mic,
  MapPin,
  Plus,
  Pencil,
  PhoneIncoming,
  PhoneOutgoing,
  ChevronUp,
  RotateCcw,
  Search,
  SendHorizonal,
  Shapes,
  Smile,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  X,
  Sidebar,
} from "lucide-react";
import { ChatScrollAnchor } from "@/components/agents/chat-scroll-anchor";
import { FaFileAlt, FaFileExcel, FaFilePdf, FaFilePowerpoint, FaFileWord } from "react-icons/fa";
import { ContactAvatar } from "@/components/chats/contact-avatar";
import { getContactDetailsAction } from "@/app/actions/chats-actions";
import {
  mergeConversationSnapshots,
  readConversationFromCache,
  saveConversationToCache,
} from "@/components/chats/chat-history-cache";
import { EditContactModal } from "@/components/chats/edit-contact-modal";
import { ChatTagsControl } from "@/components/chats/chat-tags-control";
import { QuickRepliesDialog } from "@/components/chats/quick-replies-dialog";
import { MediaPreviewDialog } from "@/components/chats/media-preview-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  clearPendingConversationSelection,
  usePendingConversationSelection,
  type PendingChatSelection,
} from "./chat-selection-store";
import { deleteChatMessageAction, generateSuggestedReplyAction } from "@/app/actions/chats-actions";
import { AppSidebar } from "./appsidebar";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../ui/breadcrumb";
import { SidebarHeader, SidebarInput } from "../ui/sidebar";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";

const CHAT_TIME_ZONE = "America/Bogota";
const CONVERSATION_LIST_LOAD_BATCH_SIZE = 10;
// Logs de depuración de la lista desactivados (ensuciaban la consola en desarrollo).
const CHAT_LIST_DEBUG = false;
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

// Normaliza texto para b\u00fasqueda de chats: min\u00fasculas y sin tildes/diacr\u00edticos, para que
// "envios" encuentre "Env\u00edos" y "rafa" encuentre "Rafa\u00e9l".
function normalizeChatSearchText(value: string) {
  return value
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

const activityDateTimeFormatter = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: CHAT_TIME_ZONE,
});

function formatActivityDate(value: Date) {
  return activityDateTimeFormatter.format(value).replace(/\u00a0/g, " ");
}

// Un mensaje SYSTEM marcado como actividad (asignaci\u00f3n, resuelto, etiqueta, etapa\u2026).
function isActivityMessage(message: SharedInboxMessageItem) {
  if (message.type !== "SYSTEM") return false;
  const rp = message.rawPayload;
  return Boolean(rp && typeof rp === "object" && !Array.isArray(rp) && (rp as { source?: unknown }).source === "activity");
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
  assignedToName?: string | null;
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

type ComposerReplyTarget = {
  id: string;
  content: string;
  type: SharedInboxMessageItem["type"];
  direction: "INBOUND" | "OUTBOUND";
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

export type AssignedFilter = "all" | "mine" | "unassigned";
export type StatusFilter = "all" | "open" | "resolved";

type SharedInboxProps = {
  searchAction: string;
  selectedConversationId: string;
  mobileConversationActive?: boolean;
  searchQuery: string;
  selectedConnectionKey?: string;
  assignedFilter?: AssignedFilter;
  statusFilter?: StatusFilter;
  isManager?: boolean;
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
  contactPanelActions?: ReactNode;
  composer?: {
    action: (formData: FormData) => void | Promise<{ ok: boolean; error?: string; suppressOptimistic?: boolean } | void>;
    hiddenFields: Array<{ name: string; value: string }>;
    placeholder?: string;
    audio?: {
      uploadPath: string;
      conversationId: string;
      source: string;
      agentId: string;
      returnTo: string;
      sendAction: (input: {
        source: string;
        conversationId: string;
        agentId: string;
        audioUrl: string;
        returnTo: string;
      }) => Promise<{ ok: true } | { error: string }>;
    };
    media?: {
      uploadPath: string;
      conversationId: string;
      source: string;
      agentId: string;
      returnTo: string;
      sendAction: (input: {
        source: string;
        conversationId: string;
        agentId: string;
        mediaUrl: string;
        mediaType: "IMAGE" | "VIDEO" | "DOCUMENT";
        fileName: string;
        mimeType: string;
        caption?: string;
        returnTo: string;
      }) => Promise<{ ok: true } | { error: string }>;
    };
  };
  emptyListTitle: string;
  emptyListDescription: string;
  emptySelectionTitle: string;
  emptySelectionDescription: string;
  messageScrollBehavior?: "bottom" | "preserve";
};

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
  assignedFilter: AssignedFilter = "all",
  statusFilter: StatusFilter = "open",
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
  if (assignedFilter !== "all") params.set("assigned", assignedFilter);
  if (statusFilter !== "open") params.set("status", statusFilter);
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
    assignedToName: existing?.assignedToName ?? null,
    // Esta funcion solo actualiza la conversacion abierta: el usuario la esta viendo,
    // asi que no hay mensajes sin leer.
    incomingCount: 0,
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
    assignedToName: snapshot.assignedToName ?? existing?.assignedToName ?? null,
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
    left.assignedToName === right.assignedToName &&
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
    url.startsWith("/api/media/proxy") ||
    // Medios ya persistidos en nuestro almacenamiento: los sirve Next directo desde
    // /public, no deben pasar por el proxy (que resolveria "/..." contra Evolution).
    url.startsWith("/uploads/")
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

function formatDocumentSize(bytes?: number | null) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getDocumentTypeLabel(fileName: string, mimeType?: string | null) {
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.trim().toUpperCase() : "";
  if (ext && ext.length <= 5) return ext;
  if (mimeType?.toLowerCase().includes("pdf")) return "PDF";
  const subtype = mimeType?.split("/")[1]?.trim();
  if (subtype) return subtype.toUpperCase().slice(0, 5);
  return "ARCHIVO";
}

// Ícono coloreado según el tipo de documento (PDF rojo, Word azul, Excel verde, etc.).
function getDocumentIcon(typeLabel: string) {
  const type = typeLabel.toUpperCase();
  if (type === "PDF") return { Icon: FaFilePdf, color: "#e2433a" };
  if (type === "DOC" || type === "DOCX") return { Icon: FaFileWord, color: "#2b7cd3" };
  if (type === "XLS" || type === "XLSX" || type === "CSV") return { Icon: FaFileExcel, color: "#1d8f4e" };
  if (type === "PPT" || type === "PPTX") return { Icon: FaFilePowerpoint, color: "#d24726" };
  return { Icon: FaFileAlt, color: "#64748b" };
}

// Extrae nombre / tipo / tamaño del documento desde el mensaje, soportando tanto el envío
// manual (lo que guarda sendChatMediaReplyAction: fileName/mimeType/fileSize) como el
// payload de Evolution (entrante: documentMessage.{fileName, mimetype, fileLength}).
function getDocumentMetaFromMessage(message: SharedInboxMessageItem) {
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
    <Button
      type="submit"
      variant="ghost"
      size="icon"
      disabled={pending}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-primary transition hover:bg-muted-foreground/20 disabled:cursor-not-allowed disabled:opacity-70 md:size-8"
      aria-label={pending ? "Enviando mensaje" : "Enviar mensaje"}
    >
      <SendHorizonal className={`size-6 ${pending ? "animate-pulse" : ""}`} />
    </Button>
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
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Buscar emoticones"
            className="h-9 w-full rounded-2xl border border-border bg-muted pl-9 pr-10 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:bg-background focus:ring-2 focus:ring-ring/50"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Limpiar búsqueda"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <Tabs value={activeTab} onValueChange={(value) => onActiveTabChange(value as ComposerEmojiTab)}>
          <TabsList className="flex h-auto w-full flex-wrap gap-1 rounded-2xl bg-muted p-1">
            {emojiTabs.map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="group flex h-9 min-w-0 flex-1 items-center justify-center rounded-xl px-0 text-muted-foreground transition data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
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
          <div className="rounded-2xl border border-dashed border-border bg-muted px-4 py-5 text-center text-sm text-muted-foreground">
            Aquí aparecerán los últimos emoticones que uses.
          </div>
        ) : visibleEmojiItems.length ? (
          <div className="grid grid-cols-6 gap-0.5">
            {visibleEmojiItems.map((item) => (
              <button
                key={`${item.category}:${item.emoji}`}
                type="button"
                onClick={() => onSelectEmoji(item.emoji)}
                className="flex h-10 w-10 items-center justify-center rounded-2xl text-[1.25rem] transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/50"
                aria-label={`Insertar ${item.label}`}
                title={item.label}
              >
                {item.emoji}
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-muted px-4 py-5 text-center text-sm text-muted-foreground">
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

// Helpers para detectar montaje en cliente sin setState en efecto (evita el mismatch
// de hidratación del DropdownMenu de base-ui).
const subscribeNoop = () => () => {};
const getMountedClient = () => true;
const getMountedServer = () => false;

// Extrae el preview de una cita (Responder): para mensajes propios usa el `replyTo`
// que guardamos al enviar; para entrantes lee la cita de WhatsApp (contextInfo).
function getMessageReplyPreview(message: SharedInboxMessageItem): { author: string; text: string } | null {
  const raw = message.rawPayload;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;

  const replyTo = record.replyTo;
  if (replyTo && typeof replyTo === "object") {
    const r = replyTo as Record<string, unknown>;
    const text = typeof r.content === "string" ? r.content.trim() : "";
    return { author: r.direction === "OUTBOUND" ? "Tú" : "Cliente", text: text || "Mensaje" };
  }

  const evolution = record.evolution as Record<string, unknown> | undefined;
  const data = evolution?.data as Record<string, unknown> | undefined;
  const msg = data?.message as Record<string, unknown> | undefined;
  if (msg) {
    for (const value of Object.values(msg)) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const ctx = (value as Record<string, unknown>).contextInfo as Record<string, unknown> | undefined;
      const quoted = ctx?.quotedMessage as Record<string, unknown> | undefined;
      if (!quoted) {
        continue;
      }
      const ext = quoted.extendedTextMessage as Record<string, unknown> | undefined;
      const text =
        (typeof quoted.conversation === "string" && quoted.conversation) ||
        (ext && typeof ext.text === "string" ? ext.text : "") ||
        "";
      if (text) {
        return { author: "", text: text.trim() };
      }
    }
  }
  return null;
}

// Menu de acciones del mensaje (estilo WhatsApp): flecha que aparece al pasar el
// mouse y abre las opciones. "Copiar" y "Responder" funcionan; el resto se
// implementa por partes (varias requieren backend: Evolution API + schema + realtime).
function MessageActionsMenu({
  message,
  outbound,
  onReply,
  onDelete,
}: {
  message: SharedInboxMessageItem;
  outbound: boolean;
  onReply?: (message: SharedInboxMessageItem) => void;
  onDelete?: (message: SharedInboxMessageItem) => void;
}) {
  // El DropdownMenu de base-ui (FloatingTree/ids/atributos) no es estable en SSR y
  // provoca un mismatch de hidratación que ROMPE la interactividad del menú. Lo
  // montamos solo en el cliente (useSyncExternalStore: false en server, true en
  // cliente) para evitarlo sin setState dentro de un efecto.
  const mounted = useSyncExternalStore(subscribeNoop, getMountedClient, getMountedServer);

  const handleCopy = () => {
    const text = (message.content ?? "").trim();
    if (!text) {
      toast.info("Este mensaje no tiene texto para copiar");
      return;
    }
    if (!navigator.clipboard?.writeText) {
      toast.error("Tu navegador no permite copiar");
      return;
    }
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success("Mensaje copiado"))
      .catch(() => toast.error("No se pudo copiar el mensaje"));
  };

  const pending = (label: string) => () => toast.info(`${label}: disponible próximamente`);

  if (!mounted) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Opciones del mensaje"
          className={`absolute right-0.5 top-0.5 z-10 inline-flex size-6 items-center justify-center rounded-full opacity-0 shadow-sm transition group-hover/bubble:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100 ${
            outbound
              ? "bg-primary text-white hover:brightness-110"
              : "bg-card text-muted-foreground hover:bg-muted"
          }`}
        >
          <ChevronDown className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className="w-52">
        <DropdownMenuItem onClick={() => onReply?.(message)}>
          <Reply className="size-4" /> Responder
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopy}>
          <Copy className="size-4" /> Copiar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={pending("Reaccionar")}>
          <Smile className="size-4" /> Reaccionar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={pending("Reenviar")}>
          <Forward className="size-4" /> Reenviar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={pending("Fijar")}>
          <Pin className="size-4" /> Fijar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={pending("Destacar")}>
          <Star className="size-4" /> Destacar
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onDelete?.(message)}>
          <Trash2 className="size-4" /> Eliminar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Componente memoizado: solo re-renderiza si cambian sus props directas.
// Evita que los ~N mensajes renderizados re-ejecuten cuando cambia estado de UI
// en SharedInbox (modal abierto, optimisticOutgoingMessage, pendingConversation, etc.).
const MessageBubble = memo(function MessageBubble({
  message,
  previousMessage,
  onRetry,
  onReply,
  onDelete,
}: {
  message: SharedInboxMessageItem;
  previousMessage: SharedInboxMessageItem | undefined;
  onRetry?: () => void;
  onReply?: (message: SharedInboxMessageItem) => void;
  onDelete?: (message: SharedInboxMessageItem) => void;
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
  const documentMeta = useMemo(
    () => (message.type === "DOCUMENT" ? getDocumentMetaFromMessage(message) : null),
    [message],
  );
  // Mensaje de archivo aún enviándose (burbuja optimista): muestra spinner en vez de hora.
  const isPendingMedia = message.id.startsWith("optimistic-media:");
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
  const replyPreview = useMemo(() => getMessageReplyPreview(message), [message]);
  const activity = isActivityMessage(message);

  return (
    <div
      className="space-y-2.5 md:space-y-3"
    >
      {showDateDivider ? (
        <div className="flex justify-center">
          <span className="rounded-full border border-border bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">
            {formatDateDivider(message.createdAt)}
          </span>
        </div>
      ) : null}

      {activity ? (
        // Badge de actividad (asignación, resuelto/reabierto, etiqueta, etapa). Tooltip con fecha.
        <div className="flex justify-center">
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger
                type="button"
                className="cursor-default rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium text-card-foreground shadow-sm"
              >
                {message.content}
              </TooltipTrigger>
              <TooltipContent side="top">{formatActivityDate(message.createdAt)}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      ) : (
      <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
        <div
          className={`group/bubble relative max-w-[88%] rounded-md px-[6px] py-[6px] text-[13px] leading-5 shadow-sm md:max-w-[72%] md:px-[6px] md:py-[6px] ${
            outbound
              ? "bg-primary text-white"
              : "border border-border bg-card text-foreground"
          }`}
        >
          {!isDeleted && !callSummary ? (
            <MessageActionsMenu message={message} outbound={outbound} onReply={onReply} onDelete={onDelete} />
          ) : null}
          {replyPreview ? (
            <div
              className={`mb-1 rounded-md border-l-2 px-2 py-1 text-[11px] ${
                outbound ? "border-white/60 bg-white/15" : "border-primary bg-muted"
              }`}
            >
              {replyPreview.author ? (
                <p className={`font-semibold ${outbound ? "text-white" : "text-primary"}`}>
                  {replyPreview.author}
                </p>
              ) : null}
              <p className={`truncate ${outbound ? "text-white/80" : "text-muted-foreground"}`}>
                {replyPreview.text}
              </p>
            </div>
          ) : null}
          {callSummary ? (
            <div className="space-y-2">
              <Badge
                className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold normal-case tracking-normal shadow-none ${
                  outbound ? "bg-white/14 text-white" : "bg-muted text-foreground"
                }`}
              >
                {CallIcon ? <CallIcon className={`h-4 w-4 ${outbound ? "text-white/85" : "text-primary"}`} /> : null}
                <span>Llamada {callSummary.directionLabel}</span>
                {callSummary.statusText ? (
                  <span className={`font-normal ${outbound ? "text-white/75" : "text-muted-foreground"}`}>
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
                      : "border-border bg-muted hover:bg-muted/80"
                  }`}
                >
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-black/5 bg-card">
                    {adPreview.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={isMediaSourceUrl(adPreview.thumbnailUrl) ? toProxiedMediaUrl(adPreview.thumbnailUrl) : ""}
                        alt={adPreview.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-muted">
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
                      <span className={`text-[11px] font-medium ${outbound ? "text-white/75" : "text-muted-foreground"}`}>
                        {adPreview.sourceApp === "facebook" ? "Anuncio de Facebook" : "Referencia de anuncio"}
                      </span>
                    </div>
                    <p className={`truncate text-[13px] font-semibold leading-5 ${outbound ? "text-white" : "text-foreground"}`}>
                      {adPreview.title}
                    </p>
                    <p className={`text-[11px] font-medium ${outbound ? "text-white/80" : "text-muted-foreground"}`}>
                      Ver detalles
                    </p>
                  </div>
                </a>
              ) : (
                <div
                  className={`flex w-full max-w-[280px] items-center gap-3 overflow-hidden rounded-2xl border px-2.5 py-2 ${
                    outbound
                      ? "border-white/14 bg-white/10"
                      : "border-border bg-muted"
                  }`}
                >
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-black/5 bg-card">
                    {adPreview.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={isMediaSourceUrl(adPreview.thumbnailUrl) ? toProxiedMediaUrl(adPreview.thumbnailUrl) : ""}
                        alt={adPreview.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-muted">
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
                      <span className={`text-[11px] font-medium ${outbound ? "text-white/75" : "text-muted-foreground"}`}>
                        {adPreview.sourceApp === "facebook" ? "Anuncio de Facebook" : "Referencia de anuncio"}
                      </span>
                    </div>
                    <p className={`truncate text-[13px] font-semibold leading-5 ${outbound ? "text-white" : "text-foreground"}`}>
                      {adPreview.title}
                    </p>
                    <p className={`text-[11px] font-medium ${outbound ? "text-white/80" : "text-muted-foreground"}`}>
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
                          className="max-h-[calc(100dvh-1.5rem)] max-w-[calc(100dvw-1.5rem)] select-none object-contain shadow-lg"
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
                outbound ? "border-white/20 bg-white/10 text-white/80" : "border-border bg-muted text-muted-foreground"
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
              <div className="inline-flex max-w-[220px] items-center justify-center overflow-hidden rounded-xl border border-border bg-card">
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
                title={documentMeta?.fileName ?? "Abrir documento"}
                className={`flex max-w-[min(230px,68vw)] items-center gap-2 rounded-xl p-1.5 pr-3 transition ${
                  outbound ? "bg-white/14 hover:bg-white/20" : "bg-background hover:bg-muted"
                }`}
              >
                {(() => {
                  const { Icon, color } = getDocumentIcon(documentMeta?.typeLabel ?? "ARCHIVO");
                  return <Icon className="size-8 shrink-0" style={{ color }} />;
                })()}
                <span className="flex min-w-0 flex-col">
                  <span className={`truncate text-[13px] font-normal leading-tight ${outbound ? "text-white" : "text-foreground"}`}>
                    {documentMeta?.fileName ?? "Documento"}
                  </span>
                  <span className={`truncate text-[11px] leading-tight ${outbound ? "text-white/70" : "text-muted-foreground"}`}>
                    {documentMeta?.sizeLabel
                      ? `${documentMeta.typeLabel} • ${documentMeta.sizeLabel}`
                      : documentMeta?.typeLabel ?? "Documento"}
                  </span>
                </span>
              </a>
              {/* No repetir el nombre del archivo abajo: WhatsApp manda el nombre como
                  "caption" cuando no hay mensaje real, y ya se muestra en la tarjeta. */}
              {message.content?.trim() && message.content.trim() !== (documentMeta?.fileName ?? "").trim()
                ? renderMessageText(message.content)
                : null}
            </div>
          ) : mediaPreviewLabel ? (
            <div className="space-y-2">
              <div
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${
                  outbound
                    ? "border-white/14 bg-white/10 text-white"
                    : "border-border bg-muted text-foreground"
                }`}
              >
                <LoaderCircle className={`h-4 w-4 shrink-0 animate-spin ${outbound ? "text-white/80" : "text-muted-foreground"}`} />
                <span>{mediaPreviewLabel}</span>
              </div>
              {shouldRenderMediaCaption ? renderMessageText(message.content) : null}
            </div>
          ) : (
            renderMessageText(message.content) || (
              <p className={`text-[12px] italic ${outbound ? "text-white/75" : "text-muted-foreground"}`}>
                {isDeleted ? "Mensaje eliminado" : "-"}
              </p>
            )
          )}

          <div className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${outbound ? "text-white/80" : "text-muted-foreground"}`}>
            {isDeleted ? (
              <Badge className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-normal tracking-[0.08em] shadow-none ${
                outbound ? "bg-white/14 text-white/80" : "bg-destructive/10 text-destructive"
              }`}>
                <Trash2 className="h-2.5 w-2.5" />
                Eliminado
              </Badge>
            ) : null}
            {message.editedAt ? (
              <Badge className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-normal tracking-[0.08em] shadow-none ${
                outbound ? "bg-white/14 text-white/80" : "bg-muted text-muted-foreground"
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
            {isPendingMedia ? (
              <LoaderCircle className="ml-0.5 h-3 w-3 shrink-0 animate-spin" aria-label="Enviando" />
            ) : null}
            {outbound && message.outboundStatusLabel ? (
              message.outboundStatusLabel === "entregado" ? (
                <CheckCheck className="ml-1 h-3 w-3 shrink-0" aria-hidden="true" />
              ) : message.outboundStatusLabel === "error" ? (
                <span className="ml-1 inline-flex items-center gap-1 font-medium text-amber-100">
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                  No se envió
                  {onRetry ? (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="ml-0.5 inline-flex cursor-pointer items-center gap-0.5 rounded-full bg-white/20 px-1.5 py-0.5 font-semibold text-white transition hover:bg-white/30"
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                      Reintentar
                    </button>
                  ) : null}
                </span>
              ) : (
                <span className="ml-1">{message.outboundStatusLabel}</span>
              )
            ) : null}
          </div>
        </div>
      </div>
      )}
    </div>
  );
});

const CHAT_MESSAGES_BACKGROUND_BASE_STYLE = {
  // Token por defecto de shadcn: blanco con una tonalidad un poco mas oscura.
  backgroundColor: "var(--muted)",
} as const;

const CHAT_MESSAGES_BACKGROUND_OVERLAY_STYLE = {
  backgroundImage: 'url("https://static.whatsapp.net/rsrc.php/yx/r/voSdkk88H7C.svg")',
  backgroundRepeat: "repeat",
  backgroundSize: "540px 960px",
  backgroundPosition: "0 0",
} as const;

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
  onComposerDraft: (message: string, formData: FormData) => void;
  onRetryFailedMessage?: () => void;
  onReplyToMessage?: (message: SharedInboxMessageItem) => void;
  onDeleteMessage?: (message: SharedInboxMessageItem) => void;
  replyTarget?: ComposerReplyTarget | null;
  onCancelReply?: () => void;
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
  contactPanelActions?: ReactNode;
  canDeleteTags: boolean;
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
  onComposerDraft,
  onRetryFailedMessage,
  onReplyToMessage,
  onDeleteMessage,
  replyTarget,
  onCancelReply,
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
  contactPanelActions,
  canDeleteTags,
}: ConversationPanelProps) {
  const canLoadOlderMessages = Boolean(renderedConversation?.loadMoreCursor && renderedConversation.hasMoreMessages);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const [isQuickRepliesOpen, setIsQuickRepliesOpen] = useState(false);
  // Archivos elegidos pendientes de confirmar en la vista previa (con caption) antes de enviar.
  const [pendingMediaFiles, setPendingMediaFiles] = useState<File[]>([]);
  const [isSuggestingReply, setIsSuggestingReply] = useState(false);
  const [emojiSearchQuery, setEmojiSearchQuery] = useState("");
  const [emojiPickerTab, setEmojiPickerTab] = useState<ComposerEmojiTab>("todos");
  const [recentComposerEmojis, setRecentComposerEmojis] = useState<string[]>([]);
  const [recentComposerEmojisReady, setRecentComposerEmojisReady] = useState(false);
  const composerTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerSelectionRef = useRef({ start: 0, end: 0 });
  const composerRouter = useRouter();
  const [composerHasText, setComposerHasText] = useState(false);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [isSendingAudio, setIsSendingAudio] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordCancelledRef = useRef(false);
  const audioConfig = composer?.audio;
  const mediaConfig = composer?.media;
  const mediaFileInputRef = useRef<HTMLInputElement | null>(null);
  const documentFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isSendingMedia, setIsSendingMedia] = useState(false);
  // Mensajes optimistas de archivos en envío: el documento/imagen aparece en el chat con un
  // spinner mientras se envía (estilo WhatsApp), SIN bloquear el composer. Se ocultan solos
  // cuando llega el mensaje real (se deduplican por mediaUrl en el render).
  const [optimisticMediaMessages, setOptimisticMediaMessages] = useState<SharedInboxMessageItem[]>([]);
  // Lista final a renderizar: mensajes reales + optimistas que aún no llegaron (mismo
  // mediaUrl ⇒ ya está el real, se descarta el optimista para no duplicar).
  const displayedMessages = useMemo(() => {
    if (optimisticMediaMessages.length === 0) {
      return renderedMessages;
    }
    const pending = optimisticMediaMessages.filter(
      (optimistic) =>
        !renderedMessages.some((real) => Boolean(real.mediaUrl) && real.mediaUrl === optimistic.mediaUrl),
    );
    return pending.length === 0 ? renderedMessages : [...renderedMessages, ...pending];
  }, [renderedMessages, optimisticMediaMessages]);
  const [isContactPanelOpen, setIsContactPanelOpen] = useState(false);
  const [contactCity, setContactCity] = useState("");

  const panelContactId = renderedConversation?.contactId ?? null;
  useEffect(() => {
    if (!isContactPanelOpen || !panelContactId) {
      setContactCity("");
      return;
    }

    let cancelled = false;
    getContactDetailsAction(panelContactId).then((result) => {
      if (cancelled) return;
      if ("details" in result) {
        setContactCity(result.details.city);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isContactPanelOpen, panelContactId]);

  // Sube y envía UN archivo; devuelve true si se envió. No toca el estado de carga global
  // (eso lo maneja el batch) para poder reutilizarlo al enviar varios en secuencia.
  const sendSingleMediaFile = useCallback(
    async (file: File, caption?: string): Promise<boolean> => {
      if (!mediaConfig) {
        return false;
      }

      const trimmedCaption = caption?.trim() || "";
      let optimisticId: string | null = null;
      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(mediaConfig.uploadPath, { method: "POST", body: formData });
        const data = (await response.json().catch(() => null)) as
          | { url?: string; fileName?: string; mimeType?: string; mediaType?: "IMAGE" | "VIDEO" | "DOCUMENT"; error?: string }
          | null;
        if (!response.ok || !data?.url || !data.mediaType) {
          toast.error(data?.error || `No se pudo subir "${file.name}".`);
          return false;
        }

        // Burbuja optimista: el archivo aparece en el chat con spinner mientras se envía.
        optimisticId = `optimistic-media:${data.url}`;
        const optimisticMessage: SharedInboxMessageItem = {
          id: optimisticId,
          content: trimmedCaption || null,
          direction: "OUTBOUND",
          createdAt: new Date(),
          authorType: "bot",
          outboundStatusLabel: null,
          type: data.mediaType,
          mediaUrl: data.url,
          rawPayload: {
            source: "manual",
            fileName: data.fileName || file.name,
            mimeType: data.mimeType || file.type,
            fileSize: file.size,
          },
        };
        setOptimisticMediaMessages((prev) => [...prev, optimisticMessage]);
        window.requestAnimationFrame(() => onScrollToBottom());

        const result = await mediaConfig.sendAction({
          source: mediaConfig.source,
          conversationId: mediaConfig.conversationId,
          agentId: mediaConfig.agentId,
          mediaUrl: data.url,
          mediaType: data.mediaType,
          fileName: data.fileName || file.name,
          mimeType: data.mimeType || file.type,
          caption: trimmedCaption || undefined,
          returnTo: mediaConfig.returnTo,
        });

        if (result && "ok" in result && result.ok) {
          return true;
        }

        // Falló el envío: quitar la burbuja optimista.
        setOptimisticMediaMessages((prev) => prev.filter((message) => message.id !== optimisticId));
        toast.error((result && "error" in result && result.error) || `No se pudo enviar "${file.name}".`);
        return false;
      } catch {
        if (optimisticId) {
          const failedId = optimisticId;
          setOptimisticMediaMessages((prev) => prev.filter((message) => message.id !== failedId));
        }
        toast.error(`No se pudo enviar "${file.name}".`);
        return false;
      }
    },
    [mediaConfig, onScrollToBottom],
  );

  // Envía uno o varios archivos en secuencia. No bloquea el composer: cada archivo aparece
  // como burbuja optimista con spinner y se resuelve al llegar el mensaje real.
  const uploadAndSendMediaFiles = useCallback(
    async (files: File[], caption?: string) => {
      if (!mediaConfig || files.length === 0) {
        return;
      }

      setIsSendingMedia(true);

      let sentCount = 0;
      for (let index = 0; index < files.length; index += 1) {
        // El caption (mensaje) va con el primer archivo, como WhatsApp.
        const ok = await sendSingleMediaFile(files[index], index === 0 ? caption : undefined);
        if (ok) {
          sentCount += 1;
        }
      }

      if (sentCount > 0) {
        composerRouter.refresh();
      }

      setIsSendingMedia(false);
    },
    [mediaConfig, sendSingleMediaFile, composerRouter],
  );

  const stopRecordTracks = useCallback(() => {
    recordStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordStreamRef.current = null;
  }, []);

  const clearRecordTimer = useCallback(() => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }, []);

  const uploadAndSendAudio = useCallback(
    async (blob: Blob, mimeType: string) => {
      if (!audioConfig) {
        return;
      }

      setIsSendingAudio(true);
      try {
        // El mime de MediaRecorder suele venir como "audio/webm;codecs=opus"; usamos el tipo base.
        const baseMime = mimeType.split(";")[0].trim() || "audio/webm";
        const ext = baseMime.includes("ogg") || baseMime.includes("opus") ? "ogg" : baseMime.includes("mp4") ? "mp4" : "webm";
        const file = new File([blob], `nota-de-voz-${Date.now()}.${ext}`, { type: baseMime });
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(audioConfig.uploadPath, { method: "POST", body: formData });
        const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
        if (!response.ok || !data?.url) {
          toast.error(data?.error || "No se pudo subir la nota de voz.");
          return;
        }

        const result = await audioConfig.sendAction({
          source: audioConfig.source,
          conversationId: audioConfig.conversationId,
          agentId: audioConfig.agentId,
          audioUrl: data.url,
          returnTo: audioConfig.returnTo,
        });

        if (result && "ok" in result && result.ok) {
          composerRouter.refresh();
        } else {
          toast.error((result && "error" in result && result.error) || "No se pudo enviar la nota de voz.");
        }
      } catch {
        toast.error("No se pudo enviar la nota de voz.");
      } finally {
        setIsSendingAudio(false);
      }
    },
    [audioConfig, composerRouter],
  );

  const startAudioRecording = useCallback(async () => {
    if (!audioConfig || isRecordingAudio || isSendingAudio) {
      return;
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recordCancelledRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        clearRecordTimer();
        stopRecordTracks();
        setIsRecordingAudio(false);
        setRecordSeconds(0);

        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        const cancelled = recordCancelledRef.current;
        const mimeType = recorder.mimeType || "audio/webm";

        if (cancelled || chunks.length === 0) {
          return;
        }

        void uploadAndSendAudio(new Blob(chunks, { type: mimeType }), mimeType);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecordingAudio(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => setRecordSeconds((value) => value + 1), 1000);
    } catch {
      stopRecordTracks();
    }
  }, [audioConfig, clearRecordTimer, isRecordingAudio, isSendingAudio, stopRecordTracks, uploadAndSendAudio]);

  const stopAndSendAudio = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      recordCancelledRef.current = false;
      mediaRecorderRef.current.stop();
    }
  }, []);

  const cancelAudioRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      recordCancelledRef.current = true;
      mediaRecorderRef.current.stop();
    }
  }, []);

  useEffect(() => {
    return () => {
      clearRecordTimer();
      stopRecordTracks();
    };
  }, [clearRecordTimer, stopRecordTracks]);

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

  // Ajusta la altura del textarea al contenido para que se expanda hacia arriba
  // (el composer esta anclado abajo) en lugar de mostrar scroll. Solo aparece
  // scroll una vez superada la altura maxima.
  const autoResizeComposer = useCallback((target: HTMLTextAreaElement | null) => {
    if (!target) {
      return;
    }

    const maxHeight = 160;
    target.style.height = "auto";
    const nextHeight = Math.min(target.scrollHeight, maxHeight);
    target.style.height = `${nextHeight}px`;
    target.style.overflowY = target.scrollHeight > maxHeight ? "auto" : "hidden";
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
    setComposerHasText(textarea.value.trim().length > 0);
    autoResizeComposer(textarea);
    setIsEmojiPickerOpen(false);
    setEmojiSearchQuery("");
    setRecentComposerEmojis((current) => [emoji, ...current.filter((item) => item !== emoji)].slice(0, 24));

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }, [autoResizeComposer]);

  // Inserta el texto de una respuesta rápida en el cuadro (en la posición del cursor),
  // sin enviarlo, para que la chica lo revise/edite antes de mandar.
  const insertQuickReply = useCallback((content: string) => {
    const textarea = composerTextAreaRef.current;
    if (!textarea) {
      return;
    }

    const currentValue = textarea.value;
    const fallbackSelection = composerSelectionRef.current;
    const start = textarea.selectionStart ?? fallbackSelection.start ?? currentValue.length;
    const end = textarea.selectionEnd ?? fallbackSelection.end ?? currentValue.length;
    const nextCursor = start + content.length;

    textarea.setRangeText(content, start, end, "end");
    composerSelectionRef.current = { start: nextCursor, end: nextCursor };
    setComposerHasText(textarea.value.trim().length > 0);
    autoResizeComposer(textarea);

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }, [autoResizeComposer]);

  const handleSuggestReply = useCallback(async () => {
    const conversationId = mediaConfig?.conversationId ?? audioConfig?.conversationId;
    if (!conversationId || isSuggestingReply) {
      return;
    }

    setIsSuggestingReply(true);
    try {
      const result = await generateSuggestedReplyAction(conversationId);
      if (result.error || !result.suggestion) {
        toast.error(result.error || "No se pudo generar la sugerencia");
        return;
      }

      const textarea = composerTextAreaRef.current;
      if (textarea) {
        const suggestion = result.suggestion;
        textarea.value = suggestion;
        composerSelectionRef.current = { start: suggestion.length, end: suggestion.length };
        setComposerHasText(suggestion.trim().length > 0);
        autoResizeComposer(textarea);
        window.requestAnimationFrame(() => {
          textarea.focus();
          textarea.setSelectionRange(suggestion.length, suggestion.length);
        });
      }
    } catch (error) {
      console.error("[handleSuggestReply] error", error);
      toast.error("No se pudo generar la sugerencia");
    } finally {
      setIsSuggestingReply(false);
    }
  }, [mediaConfig?.conversationId, audioConfig?.conversationId, isSuggestingReply, autoResizeComposer]);

  return (
    <Card
      className={`${selectedConversationId ? "flex md:flex" : "!hidden md:!flex"} chat-inbox-panel relative min-h-0 flex-1 overflow-hidden rounded-none border border-border bg-transparent p-0 shadow-none md:h-full md:shadow-lg`}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={CHAT_MESSAGES_BACKGROUND_BASE_STYLE} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.08] dark:opacity-[0.14] dark:invert" style={CHAT_MESSAGES_BACKGROUND_OVERLAY_STYLE} />
      {renderedConversation ? (
        <div className="relative z-10 flex min-h-0 h-full w-full flex-1">
        <div className="flex min-h-0 h-full min-w-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-border bg-card px-3 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.625rem)] md:px-[10px] md:py-[10px]">
            <div className="@container/chathdr flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Link
                  href={backHref}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition hover:bg-muted md:hidden"
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
                        className={`group relative shrink-0 rounded-2xl p-[2px] transition focus:outline-none focus:ring-2 focus:ring-ring/50 ${
                          hasStatusMessages
                            ? "bg-gradient-to-br from-emerald-400 via-lime-300 to-cyan-400 shadow-lg"
                            : "bg-transparent"
                        }`}
                        aria-label={hasStatusMessages ? "Abrir estados de WhatsApp" : "Abrir detalles del contacto"}
                        title={hasStatusMessages ? "Estados" : "Contacto"}
                      >
                        <span className="relative block">
                          <ContactAvatar
                            avatarUrl={renderedConversation.avatarUrl}
                            label={renderedConversation.label}
                            className={`h-10 w-10 rounded-xl border border-border bg-muted text-muted-foreground transition ${
                              hasStatusMessages ? "ring-2 ring-white" : ""
                            }`}
                            fallbackClassName="rounded-xl bg-muted text-muted-foreground"
                          />
                          {hasStatusMessages ? (
                            <span
                              aria-hidden="true"
                              className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-background bg-emerald-500 shadow-sm"
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
                      <h2 className="truncate text-[13px] font-semibold text-foreground md:text-sm">
                        {renderedConversation.label}
                      </h2>
                      <button
                        type="button"
                        onClick={() => setIsContactPanelOpen((open) => !open)}
                        aria-pressed={isContactPanelOpen}
                        className={`shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-muted ${
                          isContactPanelOpen ? "bg-muted text-foreground" : "text-muted-foreground"
                        }`}
                        aria-label={isContactPanelOpen ? "Cerrar detalles del contacto" : "Abrir detalles del contacto"}
                        title="Detalles del contacto"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div
                      className={`transition-opacity duration-200 ease-out ${
                        hasSettledConversation ? "opacity-100" : "opacity-60"
                      }`}
                    >
                      <ChatTagsControl
                        contactId={renderedConversation.contactId}
                        conversationId={renderedConversation.id}
                        tags={headerTags}
                        badgeClassName="shadow-sm"
                        canDelete={canDeleteTags}
                        compact
                      />
                    </div>
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
            <div className="relative min-h-0 flex-1">
              <div
                ref={messagesScrollRef}
                className="chat-messages-scroll h-full overflow-y-auto overscroll-contain bg-transparent px-2.5 py-2.5 pb-3 [-webkit-overflow-scrolling:touch] md:px-5 md:py-5 md:pb-5"
              >
                <div className="flex min-h-full flex-col justify-end">
                  {renderedConversation?.isPreview ? (
                    <div
                      className="flex justify-center pb-2.5 pt-1"
                      role="status"
                      aria-label="Cargando conversación"
                    >
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm">
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      </span>
                    </div>
                  ) : null}
                  {canLoadOlderMessages ? (
                    <div className="pb-2 pt-1">
                      <div ref={loadMoreSentinelRef} aria-hidden="true" className="h-px w-full" />
                      {renderedConversation.loadMoreHref ? (
                        <div className="flex justify-center">
                          <Link
                            href={renderedConversation.loadMoreHref}
                            scroll={false}
                            className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
                          >
                            Cargar mensajes anteriores
                          </Link>
                        </div>
                      ) : isLoadingOlderMessages ? (
                        <div className="flex justify-center px-3 py-1.5">
                          <span
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm"
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
                            className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
                          >
                            Cargar mensajes anteriores
                          </button>
                        </div>
                      )}
                    </div>
                  ) : null}
                  <div className="space-y-2.5 md:space-y-3">
                    {displayedMessages.map((message, index) => (
                      <MessageBubble
                        key={message.id}
                        message={message}
                        previousMessage={displayedMessages[index - 1]}
                        onRetry={
                          message.outboundStatusLabel === "error" ? onRetryFailedMessage : undefined
                        }
                        onReply={onReplyToMessage}
                        onDelete={onDeleteMessage}
                      />
                    ))}
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
                  className="absolute bottom-4 right-4 z-10 flex cursor-pointer items-center gap-1.5 rounded-full bg-foreground/90 px-3 py-1.5 text-xs font-semibold text-background shadow-lg backdrop-blur-sm transition hover:bg-foreground"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                  {unreadCount}
                </button>
              ) : null}
            </div>

            {composer && renderedConversation ? (
              <div className="chat-composer z-20 shrink-0 bg-transparent px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 md:px-2 md:py-2">
                <form
                  className="mx-auto w-full max-w-5xl"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const formData = new FormData(form);
                    const message = String(formData.get("message") || "").trim();

                    if (!message || !renderedConversation) {
                      return;
                    }

                    // El handler externo crea la burbuja optimista y envia sin
                    // navegacion (la accion valida internamente y devuelve resultado).
                    onComposerDraft(message, formData);
                    setComposerHasText(false);
                    form.reset();
                    autoResizeComposer(composerTextAreaRef.current);
                  }}
                >
                  {composerHiddenFields.map((field) => (
                    <input key={`${field.name}-${field.value}`} type="hidden" name={field.name} value={field.value} />
                  ))}

                  {replyTarget ? (
                    <div className="mb-1.5 flex items-center gap-2 rounded-xl border-l-4 border-primary bg-muted/70 px-3 py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold text-primary">
                          {replyTarget.direction === "OUTBOUND" ? "Tú" : "Cliente"}
                        </p>
                        <p className="truncate text-[12px] text-muted-foreground">
                          {replyTarget.content || "Mensaje"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={onCancelReply}
                        aria-label="Cancelar respuesta"
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-background hover:text-foreground"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ) : null}

                  <div className="flex items-end gap-2 md:gap-3">
                    {isRecordingAudio ? (
                      <div className="flex min-h-[44px] flex-1 items-center gap-2 rounded-2xl border border-border bg-muted/80 px-4 text-sm text-foreground md:min-h-[40px]">
                        <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                        <span className="font-medium">Grabando</span>
                        <span className="tabular-nums text-muted-foreground">
                          {`${Math.floor(recordSeconds / 60)}:${String(recordSeconds % 60).padStart(2, "0")}`}
                        </span>
                        <div className="ml-auto flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={cancelAudioRecording}
                            aria-label="Cancelar grabacion"
                            title="Cancelar"
                            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-background hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 md:size-8"
                          >
                            <Trash2 className="size-5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={stopAndSendAudio}
                            aria-label="Enviar nota de voz"
                            title="Enviar"
                            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-primary transition hover:bg-background focus:outline-none focus:ring-2 focus:ring-ring/50 md:size-8"
                          >
                            <SendHorizonal className="size-6" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex min-h-[44px] min-w-0 flex-1 items-center gap-0.5 rounded-2xl border border-border bg-background px-1.5 transition focus-within:border-primary focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/50 md:min-h-[40px]">
                        {mediaConfig ? (
                          <>
                            <input
                              ref={mediaFileInputRef}
                              type="file"
                              accept="image/*,video/*"
                              multiple
                              className="hidden"
                              onChange={(event) => {
                                const files = Array.from(event.currentTarget.files ?? []);
                                event.currentTarget.value = "";
                                if (files.length > 0) {
                                  setPendingMediaFiles(files);
                                }
                              }}
                            />
                            <input
                              ref={documentFileInputRef}
                              type="file"
                              accept="application/pdf"
                              multiple
                              className="hidden"
                              onChange={(event) => {
                                const files = Array.from(event.currentTarget.files ?? []);
                                event.currentTarget.value = "";
                                if (files.length > 0) {
                                  setPendingMediaFiles(files);
                                }
                              }}
                            />
                            <Popover open={isAttachMenuOpen} onOpenChange={setIsAttachMenuOpen}>
                              <PopoverTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  disabled={isSendingMedia}
                                  aria-label="Adjuntar"
                                  title="Adjuntar"
                                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-background hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 md:size-7"
                                >
                                  <Plus className="size-5" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent
                                align="start"
                                side="top"
                                sideOffset={12}
                                className="w-[min(80vw,16rem)] rounded-2xl border border-border bg-popover p-1.5 shadow-lg"
                              >
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    setIsQuickRepliesOpen(true);
                                  }}
                                  className="flex h-auto w-full items-center justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-normal text-foreground transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <MessageSquareText className="size-5 shrink-0 text-emerald-500" />
                                  <span>Respuestas rápidas</span>
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    documentFileInputRef.current?.click();
                                  }}
                                  className="flex h-auto w-full items-center justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-normal text-foreground transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <FileText className="size-5 shrink-0 text-violet-500" />
                                  <span>Documento</span>
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    mediaFileInputRef.current?.click();
                                  }}
                                  className="flex h-auto w-full items-center justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-normal text-foreground transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <ImageIcon className="size-5 shrink-0 text-sky-500" />
                                  <span>Fotos y videos</span>
                                </Button>
                                {audioConfig ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    disabled={isSendingAudio}
                                    onClick={() => {
                                      setIsAttachMenuOpen(false);
                                      void startAudioRecording();
                                    }}
                                    className="flex h-auto w-full items-center justify-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-normal text-foreground transition hover:bg-muted focus:outline-none focus-visible:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    <Headphones className="size-5 shrink-0 text-orange-400" />
                                    <span>Audio</span>
                                  </Button>
                                ) : null}
                              </PopoverContent>
                            </Popover>
                          </>
                        ) : null}
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
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={isSendingAudio}
                              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-background hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 md:size-7"
                              aria-label="Abrir selector de emoticones"
                              title="Emoticones"
                            >
                              <Smile className="size-5" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            side="top"
                            sideOffset={12}
                            className="w-[min(90vw,26rem)] rounded-2xl border border-border bg-popover p-3.5 shadow-lg"
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
                          placeholder={isSendingAudio ? "Enviando nota de voz..." : composer.placeholder || "Escribe un mensaje..."}
                          disabled={isSendingAudio}
                          onChange={(event) => {
                            setComposerHasText(event.currentTarget.value.trim().length > 0);
                            autoResizeComposer(event.currentTarget);
                          }}
                          onSelect={(event) => syncComposerSelection(event.currentTarget)}
                          onKeyUp={(event) => syncComposerSelection(event.currentTarget)}
                          onMouseUp={(event) => syncComposerSelection(event.currentTarget)}
                          onBlur={(event) => syncComposerSelection(event.currentTarget)}
                          className="min-h-[42px] min-w-0 flex-1 resize-none bg-transparent py-2.5 pr-2 text-[14px] text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-70 md:min-h-[38px] md:py-2 md:text-sm"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => void handleSuggestReply()}
                          disabled={isSuggestingReply || isSendingAudio}
                          aria-label="Respuesta sugerida con IA"
                          title="Respuesta sugerida con IA"
                          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-muted-foreground/20 hover:text-primary focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 md:size-8"
                        >
                          {isSuggestingReply ? (
                            <LoaderCircle className="size-5 animate-spin" />
                          ) : (
                            <Sparkles className="size-5" />
                          )}
                        </Button>
                        {composerHasText || !audioConfig ? (
                          <ComposerSendButton />
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={startAudioRecording}
                            disabled={isSendingAudio}
                            aria-label="Grabar nota de voz"
                            title="Grabar nota de voz"
                            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-muted-foreground/20 focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 md:size-8"
                          >
                            <Mic className="size-5" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </form>
              </div>
            ) : null}
          </div>
        </div>
        <QuickRepliesDialog
          open={isQuickRepliesOpen}
          onClose={() => setIsQuickRepliesOpen(false)}
          onSelect={insertQuickReply}
        />
        {pendingMediaFiles.length > 0 ? (
          <MediaPreviewDialog
            files={pendingMediaFiles}
            onCancel={() => setPendingMediaFiles([])}
            onSend={(caption) => {
              const files = pendingMediaFiles;
              setPendingMediaFiles([]);
              void uploadAndSendMediaFiles(files, caption);
            }}
          />
        ) : null}
        {isContactPanelOpen ? (
          <aside className="hidden w-72 shrink-0 flex-col border-l border-border bg-card md:flex lg:w-80">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">Contacto</h3>
              <button
                type="button"
                onClick={() => setIsContactPanelOpen(false)}
                aria-label="Cerrar panel"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <div className="flex items-center gap-3">
                <ContactAvatar
                  avatarUrl={renderedConversation.avatarUrl}
                  label={renderedConversation.label}
                  className="h-12 w-12 shrink-0 rounded-full border border-border bg-muted text-muted-foreground"
                  fallbackClassName="rounded-full bg-muted text-muted-foreground"
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {renderedConversation.label}
                  </p>
                  {renderedConversation.secondaryLabel ? (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span className="min-w-0 flex-1 truncate">{renderedConversation.secondaryLabel}</span>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(renderedConversation.secondaryLabel);
                          toast.success("Copiado");
                        }}
                        aria-label="Copiar número"
                        title="Copiar"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                  {contactCity ? (
                    <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 truncate">{contactCity}</span>
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                {renderedConversation.contactId ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={onEditContact}
                    className="h-8 w-8"
                    aria-label="Editar"
                    title="Editar"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>

              <div className="mt-5 space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Etiquetas
                </h4>
                <ChatTagsControl
                  contactId={renderedConversation.contactId}
                  conversationId={renderedConversation.id}
                  tags={renderedConversation.tags ?? []}
                  canDelete={canDeleteTags}
                />
              </div>

              {contactPanelActions ? (
                <div className="mt-5 space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Agente asignado
                  </h4>
                  {contactPanelActions}
                </div>
              ) : null}
            </div>
          </aside>
        ) : null}
        </div>
      ) : (
        <div className="relative z-10 flex h-full w-full flex-1 items-center justify-center px-6 py-10 text-center">
          <div className="mx-auto flex max-w-sm flex-col items-center gap-4">
            <span className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
                <MessageSquareText className="h-7 w-7" />
              </span>
            </span>
            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold text-foreground">{emptySelectionTitle}</h3>
              <p className="text-sm leading-6 text-muted-foreground">
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
  assignedFilter = "all",
  statusFilter = "open",
  isManager = false,
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
  contactPanelActions,
  composer,
  emptyListTitle,
  emptyListDescription,
  emptySelectionTitle,
  emptySelectionDescription,
  messageScrollBehavior = "bottom",
}: SharedInboxProps) {
  const [conversationItems, setConversationItems] = useState<SharedInboxConversationItem[]>(() =>
    normalizeConversationItems(conversations, (item) =>
      buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item, assignedFilter, statusFilter),
    ),
  );
  const [hasMoreConversationItems, setHasMoreConversationItems] = useState(
    initialHasMoreConversations ?? conversations.length >= initialConversationBatchSize,
  );
  const [isLoadingMoreConversationItems, setIsLoadingMoreConversationItems] = useState(false);
  const [assignedCounts, setAssignedCounts] = useState<{ mine: number; unassigned: number; all: number } | null>(null);
  const [optimisticConversation, setOptimisticConversation] = useState<SharedInboxSelectedConversation | null>(null);
  const [liveConversation, setLiveConversation] = useState<SharedInboxSelectedConversation | null>(null);
  const [optimisticOutgoingMessage, setOptimisticOutgoingMessage] = useState<OptimisticDraftMessage | null>(null);
  const [replyTarget, setReplyTarget] = useState<ComposerReplyTarget | null>(null);
  const [deletedMessageIds, setDeletedMessageIds] = useState<ReadonlySet<string>>(() => new Set());
  const [editContactOpen, setEditContactOpen] = useState(false);
  const handleCloseEditContact = useCallback(() => setEditContactOpen(false), []);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const handleOpenEditContact = useCallback(() => setEditContactOpen(true), []);
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
  // Mientras un chat recién se abre, los ajustes programáticos de scroll (pin al fondo)
  // disparan el listener de scroll y podrían "armar"/lanzar la carga de mensajes anteriores,
  // que ancla la vista arriba. Suprimimos esa carga hasta este timestamp tras abrir.
  const suppressHistoryLoadUntilRef = useRef(0);
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
  // Ids de chats que coinciden con la búsqueda por CONTENIDO de mensaje (no por nombre/
  // teléfono/último mensaje visible). Vienen del fetch aumentativo al API de lista; sirven
  // para que esos chats aparezcan aunque el texto buscado no esté en los campos visibles.
  const [searchMatchIds, setSearchMatchIds] = useState<ReadonlySet<string> | null>(null);
  const searchAugmentAbortRef = useRef<AbortController | null>(null);
  const listQueryKeyRef = useRef(`${searchQuery.trim()}::${selectedConnectionKey.trim()}::${assignedFilter}`);

  useEffect(() => {
    if (searchInputRef.current && document.activeElement === searchInputRef.current) {
      return;
    }

    setSearchInputValue(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  // Conteos por filtro (Mías / Sin asignar / Todas) para mostrarlos junto a cada pestaña.
  useEffect(() => {
    const countsApiPath = conversationListApiPath.replace(/\/list$/, "/counts");
    if (countsApiPath === conversationListApiPath) {
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const fetchCounts = async () => {
      try {
        const params = new URLSearchParams();
        if (searchQuery.trim()) params.set("q", searchQuery.trim());
        if (selectedConnectionKey.trim()) params.set("connection", selectedConnectionKey.trim());
        const qs = params.toString();

        const response = await fetch(`${countsApiPath}${qs ? `?${qs}` : ""}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; counts?: { mine: number; unassigned: number; all: number } }
          | null;
        if (!cancelled && payload?.ok && payload.counts) {
          setAssignedCounts(payload.counts);
        }
      } catch {
        // Ignoramos errores de red: se reintenta en el siguiente intervalo.
      } finally {
        if (!cancelled) {
          timeoutId = setTimeout(fetchCounts, 15000);
        }
      }
    };

    fetchCounts();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [conversationListApiPath, searchQuery, selectedConnectionKey]);

  // Búsqueda aumentativa: trae del servidor los chats que coinciden por contenido de
  // mensaje o que están más allá de lo ya cargado, y los AGREGA (nunca quita) a la lista.
  // No navega ni reemplaza la lista: así borrar el buscador siempre restaura todos los
  // chats al instante (la lista base nunca se encoge por la búsqueda).
  const runSearchAugmentation = useCallback(
    async (rawQuery: string) => {
      const q = rawQuery.trim();
      searchAugmentAbortRef.current?.abort();

      if (!q) {
        searchAugmentAbortRef.current = null;
        setSearchMatchIds(null);
        return;
      }

      const controller = new AbortController();
      searchAugmentAbortRef.current = controller;

      try {
        const params = new URLSearchParams();
        params.set("q", q);
        params.set("limit", "40");
        if (selectedConnectionKey.trim()) params.set("connection", selectedConnectionKey.trim());
        if (assignedFilter !== "all") params.set("assigned", assignedFilter);
        if (statusFilter !== "open") params.set("status", statusFilter);

        const response = await fetch(`${conversationListApiPath}?${params.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; conversations?: SharedInboxConversationItem[] }
          | null;

        if (!payload?.ok || !Array.isArray(payload.conversations)) {
          return;
        }

        const normalized = normalizeConversationItems(payload.conversations, (item) =>
          buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, q, item, assignedFilter, statusFilter),
        );

        setConversationItems((current) => {
          const currentIds = new Set(current.map((item) => item.id));
          const additions = normalized.filter((item) => item.id && !currentIds.has(item.id));
          return additions.length === 0 ? current : sortConversationItems([...current, ...additions]);
        });
        setSearchMatchIds(new Set(normalized.map((item) => item.id)));
      } catch {
        // Abort o fallo de red: la búsqueda local sobre lo ya cargado sigue funcionando.
      } finally {
        if (searchAugmentAbortRef.current === controller) {
          searchAugmentAbortRef.current = null;
        }
      }
    },
    [conversationListApiPath, searchAction, selectedConnectionKey, assignedFilter, statusFilter],
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInputValue(value);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => {
        void runSearchAugmentation(value);
      }, 250);
    },
    [runSearchAugmentation],
  );

  const handleSearchClear = useCallback(() => {
    setSearchInputValue("");
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchAugmentAbortRef.current?.abort();
    searchAugmentAbortRef.current = null;
    setSearchMatchIds(null);
    searchInputRef.current?.focus();
  }, []);

  // Lista que se muestra: filtrado LOCAL e instantáneo de los chats ya cargados por nombre,
  // teléfono o último mensaje (sin tildes/mayúsculas), más los que el servidor marcó como
  // coincidencia por contenido de mensaje. Sin texto → se muestran todos. Esto hace que
  // escribir filtre al instante y que borrar restaure la lista completa de inmediato.
  const displayedConversationItems = useMemo(() => {
    const normalizedQuery = normalizeChatSearchText(searchInputValue.trim());
    if (!normalizedQuery) {
      return conversationItems;
    }

    return conversationItems.filter((item) => {
      if (searchMatchIds?.has(item.id)) {
        return true;
      }

      return (
        normalizeChatSearchText(item.label).includes(normalizedQuery) ||
        normalizeChatSearchText(item.secondaryLabel).includes(normalizedQuery) ||
        normalizeChatSearchText(item.lastMessage ?? "").includes(normalizedQuery)
      );
    });
  }, [conversationItems, searchInputValue, searchMatchIds]);

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

      if (assignedFilter !== "all") {
        params.set("assigned", assignedFilter);
      }

      if (statusFilter !== "open") {
        params.set("status", statusFilter);
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
        buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item, assignedFilter, statusFilter),
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
    assignedFilter,
  ]);

  const pendingConversation = usePendingConversationSelection();

  useEffect(() => {
    if (selectedConversation && !selectedConversation.isPreview) {
      saveConversationToCache(selectedConversation);
    }
  }, [selectedConversation]);

  useEffect(() => {
    const nextListQueryKey = `${searchQuery.trim()}::${selectedConnectionKey.trim()}::${assignedFilter}::${statusFilter}`;
    const queryChanged = listQueryKeyRef.current !== nextListQueryKey;
    listQueryKeyRef.current = nextListQueryKey;

    if (queryChanged) {
      setHasMoreConversationItems(initialHasMoreConversations ?? conversations.length >= initialConversationBatchSize);
      setConversationItems(
        normalizeConversationItems(conversations, (item) =>
          buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item, assignedFilter, statusFilter),
        ),
      );
      return;
    }

    setConversationItems((current) => {
      if (current.length === 0) {
        return sortConversationItems(
          normalizeConversationItems(conversations, (item) =>
            buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item, assignedFilter, statusFilter),
          ),
        );
      }

      const currentById = new Map(current.map((item) => [item.id, item]));
      const merged = normalizeConversationItems(conversations, (item) =>
        buildConversationItemHrefFromParams(searchAction, selectedConnectionKey, searchQuery, item, assignedFilter, statusFilter),
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
  }, [conversations, initialConversationBatchSize, initialHasMoreConversations, searchAction, searchQuery, selectedConnectionKey, assignedFilter, statusFilter]);

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
    () =>
      hasHydrated && selectedConversationKey
        ? readConversationFromCache(selectedConversationKey, { ignoreFreshness: true })
        : null,
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
    if (!pendingConversation?.id) {
      return;
    }

    const cacheKey = pendingConversation.cacheKey || pendingConversation.id;
    const cachedConversation = readConversationFromCache(cacheKey, { ignoreFreshness: true });

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

  // Los snapshots de realtime (chat-live-update / chat-list-update) llegan con el id crudo
  // de la conversación (sin prefijo "agent:"/"official:") y sin href. Si la conversación es
  // nueva (no estaba en el SSR), el item insertado quedaría con id sin prefijo y href "".
  // Al hacer click, router.push("") navega a la URL ACTUAL (no abre el chat nuevo: parece
  // que "entra y vuelve al chat anterior") y además el efecto que carga el historial se
  // salta el item por no empezar con "agent:". Normalizamos id (a chatKey) y href aquí para
  // que un chat recién llegado sea clickeable al primer intento.
  const normalizeRealtimeConversationItem = useCallback(
    (item: SharedInboxConversationItem): SharedInboxConversationItem => {
      if (item.href.trim() && item.id.includes(":")) {
        return item;
      }

      const chatKey = item.id.includes(":")
        ? item.id
        : `${item.source === "official" ? "official" : "agent"}:${item.id}`;
      const withKey = chatKey === item.id ? item : { ...item, id: chatKey };
      const href = buildConversationItemHrefFromParams(
        searchAction,
        selectedConnectionKey,
        searchQuery,
        withKey,
        assignedFilter,
        statusFilter,
      );

      return href === withKey.href ? withKey : { ...withKey, href };
    },
    [searchAction, selectedConnectionKey, searchQuery, assignedFilter, statusFilter],
  );

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
        const updatedItem = normalizeRealtimeConversationItem(buildConversationItemFromSnapshot(snapshot, currentItem));
        return updateConversationItemInSortedList(current, snapshot.id, updatedItem);
      });
    }

    window.addEventListener("chat-live-update", handleLiveUpdate as EventListener);
    return () => window.removeEventListener("chat-live-update", handleLiveUpdate as EventListener);
  }, [normalizeRealtimeConversationItem, pendingConversation?.chatKey, selectedConversationId]);

  useEffect(() => {
    function handleListUpdate(event: Event) {
      const customEvent = event as CustomEvent<{ conversation?: unknown }>;
      const snapshot = normalizeLiveConversationListSnapshot(customEvent.detail?.conversation);
      if (!snapshot) {
        return;
      }

      setConversationItems((current) => {
        const currentItem = findConversationItemBySnapshotId(current, snapshot.id) ?? undefined;
        const updatedItem = normalizeRealtimeConversationItem(buildConversationItemFromListSnapshot(snapshot, currentItem));
        return updateConversationItemInSortedList(current, snapshot.id, updatedItem);
      });
    }

    window.addEventListener("chat-list-update", handleListUpdate as EventListener);
    return () => window.removeEventListener("chat-list-update", handleListUpdate as EventListener);
  }, [normalizeRealtimeConversationItem]);

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
    // Dependemos solo de la clave efectiva (selectedConversationKey), no de
    // pendingConversation.chatKey y selectedConversationId por separado. Si dependiera de
    // ambos, cuando router.push actualiza selectedConversationId para "alcanzar" la
    // selección pendiente, el efecto se re-ejecutaría con la MISMA clave efectiva: el
    // cleanup abortaría el fetch en curso y la nueva corrida saldría por el guard de
    // in-flight, dejando el historial sin cargar hasta un segundo click.
  }, [selectedConversationKey]);

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

  const computedRenderedConversation = useMemo(() => {
    // Si hay contenido en vivo o en caché para este chat (con mensajes), es la fuente
    // completa: mostrarlo de inmediato. La caché hace que reabrir un chat sea instantáneo.
    if (
      liveOrCachedConversation &&
      liveOrCachedConversation.messages.length > 0 &&
      (!pendingConversationPreview || pendingConversationPreview.id === liveOrCachedConversation.id)
    ) {
      return liveOrCachedConversation;
    }

    // Sin caché todavía: mostramos el preview (último mensaje) mientras llega el historial.
    return pendingConversationPreview ?? liveOrCachedConversation;
  }, [liveOrCachedConversation, pendingConversationPreview]);

  // Anti-parpadeo: al cambiar de chat, el contenido pasa por estados intermedios
  // (preview → live/cache que momentáneamente llega sin mensajes → completo). Para no
  // mostrar un frame "vacío", si la versión calculada queda sin mensajes mantenemos la
  // última versión CON mensajes de la MISMA conversación (incluido el preview).
  const stickyRenderedConversationRef = useRef<SharedInboxSelectedConversation | null>(null);
  const renderedConversation = useMemo(() => {
    const computed = computedRenderedConversation;
    if (computed && computed.messages.length > 0) {
      stickyRenderedConversationRef.current = computed;
      return computed;
    }

    const sticky = stickyRenderedConversationRef.current;
    if (sticky && conversationIdMatchesKey(selectedConversationKey, sticky.id)) {
      return sticky;
    }

    return computed;
  }, [computedRenderedConversation, selectedConversationKey]);

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

  // Red de seguridad: si una seleccion pendiente nunca llega a resolverse (p. ej. el
  // servidor no devuelve el chat porque ya no esta asignado a este usuario), el overlay
  // "Historial" quedaria girando indefinidamente y confunde al empleado. Tras un tiempo
  // prudente sin resolver, limpiamos la seleccion para volver al estado vacio en vez de
  // dejar el spinner colgado.
  useEffect(() => {
    if (!pendingConversation?.id) {
      return;
    }

    if (pendingConversation.id === selectedConversationId || hasLoadedSelectedConversationContent) {
      return;
    }

    if (pendingConversation.hasCache || cachedConversationForCurrentSelection) {
      return;
    }

    const timer = window.setTimeout(() => {
      clearPendingConversationSelection();
      setOptimisticConversation(null);
    }, 10000);

    return () => window.clearTimeout(timer);
  }, [
    cachedConversationForCurrentSelection,
    hasLoadedSelectedConversationContent,
    pendingConversation?.hasCache,
    pendingConversation?.id,
    selectedConversationId,
  ]);

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
  const baseRenderedMessages = useMemo(
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
  // Aplica borrados optimistas: marca como eliminado al instante mientras el
  // servidor confirma (si falla, se revierte el id en deletedMessageIds).
  const renderedMessages = useMemo(
    () =>
      deletedMessageIds.size === 0
        ? baseRenderedMessages
        : baseRenderedMessages.map((message) =>
            deletedMessageIds.has(message.id) && !message.deletedAt
              ? { ...message, deletedAt: new Date() }
              : message,
          ),
    [baseRenderedMessages, deletedMessageIds],
  );
  // Ref para leer el último mensaje dentro de efectos sin meter el array en deps
  // (un array en deps cambia de tamaño y React lanza error).
  const renderedMessagesRef = useRef(renderedMessages);
  renderedMessagesRef.current = renderedMessages;

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

  // Resuelve la burbuja optimista segun el resultado de la accion de envio:
  // - result null  -> la accion lanzo excepcion -> marcar "error" (+ Reintentar)
  // - result.ok === false -> error de validacion interna -> marcar "error"
  // - result.suppressOptimistic -> se disparo un flujo -> quitar la burbuja del texto
  // - ok (o void) -> dejar la burbuja; el sync en tiempo real la reemplaza por el real
  const finalizeOptimisticSend = useCallback(
    (optimisticId: string, result: { ok?: boolean; suppressOptimistic?: boolean } | null) => {
      setOptimisticOutgoingMessage((current) => {
        if (!current || current.id !== optimisticId) {
          return current;
        }
        if (!result || result.ok === false) {
          return { ...current, outboundStatusLabel: "error" };
        }
        if (result.suppressOptimistic) {
          return null;
        }
        return current;
      });
    },
    [],
  );

  const handleComposerDraft = useCallback(
    (message: string, formData: FormData) => {
      if (!renderedConversation || !composer) {
        return;
      }

      const now = new Date();
      const optimisticId = `optimistic:${renderedConversation.id}:${Date.now()}`;
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

      // La burbuja aparece al instante y se ve como un mensaje ya enviado
      // (sin etiqueta "enviando" ni atenuado). Si falla, se marca "error" despues.
      setOptimisticOutgoingMessage({
        id: optimisticId,
        conversationId: renderedConversation.id,
        content: message,
        direction: "OUTBOUND",
        createdAt: now,
        authorType: "user",
        outboundStatusLabel: null,
        type: "TEXT",
        mediaUrl: null,
        rawPayload: replyTarget
          ? {
              optimistic: true,
              replyTo: {
                content: replyTarget.content,
                direction: replyTarget.direction,
                type: replyTarget.type,
              },
            }
          : { optimistic: true },
        isOptimistic: true,
      });

      window.dispatchEvent(
        new CustomEvent("chat-list-update", {
          detail: {
            conversation: optimisticListSnapshot,
          },
        }),
      );

      // Cita (Responder): mandamos el id (para citar en WhatsApp) y el preview
      // (texto + dirección) para que la cita se guarde y se vea siempre.
      if (replyTarget) {
        formData.set("quotedMessageId", replyTarget.id);
        formData.set("quotedContent", replyTarget.content);
        formData.set("quotedDirection", replyTarget.direction);
        setReplyTarget(null);
      }

      // Envio sin navegacion: la accion valida internamente y devuelve un resultado.
      void Promise.resolve(composer.action(formData))
        .then((result) => finalizeOptimisticSend(optimisticId, result ?? { ok: true }))
        .catch(() => finalizeOptimisticSend(optimisticId, null));
    },
    [renderedConversation, selectedConversationId, composer, finalizeOptimisticSend, replyTarget],
  );

  const handleReplyToMessage = useCallback((target: SharedInboxMessageItem) => {
    if (!target.id || target.id.startsWith("optimistic:")) {
      return;
    }
    const typeLabels: Record<string, string> = {
      IMAGE: "Imagen",
      AUDIO: "Audio",
      VIDEO: "Video",
      STICKER: "Sticker",
      DOCUMENT: "Documento",
    };
    const previewText = (target.content ?? "").trim() || typeLabels[target.type ?? "TEXT"] || "Mensaje";
    setReplyTarget({
      id: target.id,
      content: previewText,
      type: target.type ?? "TEXT",
      direction: target.direction,
    });
  }, []);

  const handleCancelReply = useCallback(() => setReplyTarget(null), []);

  const handleDeleteMessage = useCallback((target: SharedInboxMessageItem) => {
    if (!target.id || target.id.startsWith("optimistic:")) {
      return;
    }
    const isOutbound = target.direction === "OUTBOUND";
    const confirmText = isOutbound
      ? "¿Eliminar este mensaje? Se borrará también en el WhatsApp del cliente."
      : "¿Eliminar este mensaje de la bandeja? (Seguirá en el WhatsApp del cliente.)";
    if (typeof window !== "undefined" && !window.confirm(confirmText)) {
      return;
    }

    // Borrado optimista: se marca "eliminado" al instante. Si falla, se revierte.
    setDeletedMessageIds((current) => {
      const next = new Set(current);
      next.add(target.id);
      return next;
    });

    const formData = new FormData();
    formData.set("messageId", target.id);
    void Promise.resolve(deleteChatMessageAction(formData))
      .then((result) => {
        if (!result?.ok) {
          setDeletedMessageIds((current) => {
            const next = new Set(current);
            next.delete(target.id);
            return next;
          });
          toast.error(result?.error || "No se pudo eliminar el mensaje");
        }
      })
      .catch(() => {
        setDeletedMessageIds((current) => {
          const next = new Set(current);
          next.delete(target.id);
          return next;
        });
        toast.error("No se pudo eliminar el mensaje");
      });
  }, []);

  useEffect(() => {
    setReplyTarget(null);
  }, [selectedConversationId]);
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
  const composerHiddenFields = composer
    ? buildComposerHiddenFields(
        composer.hiddenFields,
        pendingConversation && pendingConversation.id === renderedConversation?.id ? pendingConversation : null,
      )
    : [];
  // Refs para mantener estable handleRetryFailedMessage (asi MessageBubble no
  // re-renderiza toda la lista en cada render por un callback nuevo).
  const composerRef = useRef(composer);
  composerRef.current = composer;
  const composerHiddenFieldsRef = useRef(composerHiddenFields);
  composerHiddenFieldsRef.current = composerHiddenFields;
  const optimisticOutgoingMessageRef = useRef(optimisticOutgoingMessage);
  optimisticOutgoingMessageRef.current = optimisticOutgoingMessage;

  const handleRetryFailedMessage = useCallback(() => {
    const composerValue = composerRef.current;
    const failed = optimisticOutgoingMessageRef.current;
    const text = failed?.content?.trim();
    if (!composerValue || !failed || !text) {
      return;
    }

    const formData = new FormData();
    formData.set("message", text);
    for (const field of composerHiddenFieldsRef.current) {
      formData.set(field.name, field.value);
    }

    // Reintento: vuelve a verse como mensaje enviado (sin etiqueta de error) y se
    // valida internamente; si vuelve a fallar, se marca "error" de nuevo.
    const optimisticId = `optimistic:${failed.conversationId}:${Date.now()}`;
    setOptimisticOutgoingMessage({
      ...failed,
      id: optimisticId,
      outboundStatusLabel: null,
      createdAt: new Date(),
    });

    void Promise.resolve(composerValue.action(formData))
      .then((result) => finalizeOptimisticSend(optimisticId, result ?? { ok: true }))
      .catch(() => finalizeOptimisticSend(optimisticId, null));
  }, [finalizeOptimisticSend]);
  // Identidad estable de la conversación: normalizamos el id (el preview viene como
  // "agent:<id>" y el cargado como "<id>"), si no, split(":")[0] daría "agent" para todos
  // los chats y no detectaría el cambio de conversación → el scroll no bajaría al fondo.
  // Usamos "|" como separador porque el id puede contener ":".
  const selectedConversationScrollKey = renderedConversation
    ? `${extractConversationIdFromKey(renderedConversation.id)}|${renderedMessages.length}|${renderedMessages.at(-1)?.id ?? ""}`
    : "empty";
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
      // Ventana tras abrir el chat: ignoramos los scrolls programáticos (pin al fondo) para
      // no armar ni lanzar la carga de mensajes anteriores, que anclaría la vista arriba.
      const historyLoadSuppressed = suppressHistoryLoadUntilRef.current > Date.now();

      if (!historyLoadSuppressed && nextScrollTop < previousScrollTop) {
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
        historyLoadSuppressed ||
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
      // Al cargar mensajes antiguos arriba, el contenido inferior no cambia, así que
      // mantener (scrollHeight - scrollTop) constante conserva la vista exacta. Como ya
      // no hay virtualización, la altura es real: basta fijar antes del paint (este
      // useLayoutEffect) + un par de frames por si algún media termina de cargar.
      const distanceFromBottom = Math.max(0, restore.scrollHeight - restore.scrollTop);
      const pinScroll = () => {
        const el = messagesScrollRef.current;
        if (!el) return;
        el.scrollTop = Math.max(0, el.scrollHeight - distanceFromBottom);
      };
      pinScroll();
      window.requestAnimationFrame(pinScroll);
      loadMoreHistoryRestoreRef.current = null;
      return;
    }

    const jumpToBottom = (smooth: boolean) => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }

      // En salto inmediato (no-smooth) fijamos el scroll YA, dentro de este useLayoutEffect
      // (antes del paint), para que no se vea un frame "arriba" antes del rAF. El rAF queda
      // como re-anclaje por si la altura cambia (media que termina de cargar, etc.).
      if (!smooth) {
        container.scrollTop = container.scrollHeight;
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

    const prevConvId = prevKey.split("|")[0];
    const curConvId = currentKey.split("|")[0];

    if (prevConvId !== curConvId) {
      // Different conversation opened — always jump to bottom.
      jumpToBottom(false);
      return;
    }

    // Same conversation: check for appended messages.
    const prevCount = Number(prevKey.split("|")[1]) || 0;
    const curCount = Number(currentKey.split("|")[1]) || 0;
    const added = curCount - prevCount;
    if (added <= 0) {
      // Mismo número de mensajes pero el contenido/altura pudo cambiar (p. ej. al pasar
      // de la caché al detalle del servidor). Si el usuario está al fondo, lo mantenemos
      // pegado abajo para que no parezca que "se subió".
      if (isNearBottomRef.current) {
        jumpToBottom(false);
      }
      return;
    }

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

    // Comportamiento estilo WhatsApp:
    // - Tu propio envío (burbuja optimista) → baja para verlo.
    // - Estás cerca del fondo (leyendo lo último) → baja natural al mensaje nuevo.
    // - Estás arriba en el historial → NO mueve el scroll; si es entrante, muestra
    //   el contador "↓ N" de no leídos.
    const lastMessage = renderedMessagesRef.current.at(-1);
    const lastMessageIsOwnDraft =
      typeof lastMessage?.id === "string" && lastMessage.id.startsWith("optimistic:");

    if (lastMessageIsOwnDraft || isNearBottomRef.current) {
      jumpToBottom(true);
      return;
    }

    // Scrolleado arriba: anclamos a la posición previa para que el re-render no la
    // mueva, y contamos el no leído si el mensaje es entrante.
    container.scrollTop = lastScrollTopRef.current;
    if (lastMessage?.direction === "INBOUND") {
      setUnreadCount((prev) => prev + added);
    }
  }, [selectedConversationScrollKey, messageScrollBehavior]);

  // Al ABRIR una conversación (cambia el id normalizado), fijamos el scroll al fondo de
  // forma agresiva en varios frames/timeouts. Así, aunque el contenido pase por las
  // transiciones caché → SSR → /live (que cambian la altura), el chat siempre queda en el
  // último mensaje y no se ve "subido". No interfiere con la llegada de mensajes nuevos
  // (eso lo maneja el efecto de arriba), porque solo corre cuando cambia la conversación.
  const openedConversationIdRef = useRef("");
  useLayoutEffect(() => {
    if (messageScrollBehavior !== "bottom") return;
    const convId = renderedConversation ? extractConversationIdFromKey(renderedConversation.id) : "";
    if (!convId || convId === openedConversationIdRef.current) return;
    openedConversationIdRef.current = convId;
    // Bloquea la carga automática de historial durante la apertura (los pines de scroll
    // disparan el listener y, si no, anclarían la vista arriba).
    suppressHistoryLoadUntilRef.current = Date.now() + 700;

    const pinToBottom = () => {
      const el = messagesScrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      lastScrollTopRef.current = el.scrollTop;
      isNearBottomRef.current = true;
    };

    pinToBottom();
    const raf1 = window.requestAnimationFrame(() => {
      pinToBottom();
      window.requestAnimationFrame(pinToBottom);
    });
    const t1 = window.setTimeout(pinToBottom, 80);
    const t2 = window.setTimeout(pinToBottom, 250);

    return () => {
      window.cancelAnimationFrame(raf1);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [renderedConversation, messageScrollBehavior]);

  // Cuando el contenido CRECE después del render (típicamente una imagen/media que termina
  // de cargar), si el usuario está al fondo o el chat se acaba de abrir, volvemos a pegar
  // la vista abajo. Sin esto, los chats con foto/video quedan a media altura al abrir.
  useEffect(() => {
    if (messageScrollBehavior !== "bottom") return;
    const container = messagesScrollRef.current;
    const content = container?.firstElementChild;
    if (!container || !content) return;

    let lastScrollHeight = container.scrollHeight;
    const observer = new ResizeObserver(() => {
      const el = messagesScrollRef.current;
      if (!el) return;
      const grew = el.scrollHeight > lastScrollHeight + 1;
      lastScrollHeight = el.scrollHeight;
      if (!grew) return;

      const justOpened = suppressHistoryLoadUntilRef.current > Date.now();
      if (isNearBottomRef.current || justOpened) {
        el.scrollTop = el.scrollHeight;
        lastScrollTopRef.current = el.scrollTop;
        isNearBottomRef.current = true;
      }
    });

    observer.observe(content);
    return () => observer.disconnect();
  }, [messageScrollBehavior, selectedConversationId]);

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
        <div className="hidden chat-inbox-sidebar min-h-0 overflow-hidden rounded-xl border border-white/10 bg-black p-0 text-white shadow-lg md:flex md:h-full">
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
        conversationItems={displayedConversationItems}
        selectedConversationId={selectedConversationId}
        searchAction={searchAction}
        selectedConnectionKey={selectedConnectionKey}
        searchQuery={searchQuery}
        assignedFilter={assignedFilter}
        statusFilter={statusFilter}
        assignedCounts={assignedCounts}
        isManager={isManager}
        searchInputValue={searchInputValue}
        searchInputRef={searchInputRef}
        onSearchChange={handleSearchChange}
        onSearchClear={handleSearchClear}
        onSearchSubmit={() => {
          if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
          void runSearchAugmentation(searchInputValue);
        }}
        hasMoreConversationItems={hasMoreConversationItems}
        isLoadingMoreConversationItems={isLoadingMoreConversationItems}
        onLoadMoreConversationItems={loadMoreConversationItems}
        mobileConversationActive={mobileConversationActive}
        emptyListTitle={emptyListTitle}
        emptyListDescription={emptyListDescription}
      />

      <ConversationPanel
        // Clave del panel = clave EFECTIVA del chat (pendiente o de la URL). Antes usaba
        // selectedConversationId (solo la URL), que cambia al confirmarse la navegación
        // DESPUÉS de mostrar el chat optimista → el panel se re-montaba a mitad de la
        // apertura, el contenedor de scroll nacía arriba y se veía un "sube y baja" antes
        // de re-anclar al fondo. selectedConversationKey es idéntica en el estado pendiente
        // y tras el commit (misma "agent:<id>"), así que el panel se monta UNA sola vez al
        // hacer click y el pin al fondo queda estable.
        key={mobileConversationActive ? (selectedConversationKey || "selected") : "empty"}
        canDeleteTags={isManager}
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
        onComposerDraft={handleComposerDraft}
        onRetryFailedMessage={handleRetryFailedMessage}
        onReplyToMessage={handleReplyToMessage}
        onDeleteMessage={handleDeleteMessage}
        replyTarget={replyTarget}
        onCancelReply={handleCancelReply}
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
        contactPanelActions={contactPanelActions}
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
    <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
      <DialogContent className="w-[min(92vw,34rem)] max-w-none overflow-hidden border border-border bg-popover p-0 shadow-lg">
        <div className="border-b border-border bg-card px-5 py-4">
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
                  className="rounded-2xl border border-border bg-muted/80 p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 via-lime-300 to-cyan-400 p-[2px]">
                      <div className="flex h-full w-full items-center justify-center rounded-full bg-card text-emerald-600">
                        <MessageCircle className="h-4 w-4" />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-semibold text-foreground">{previewText}</p>
                        <Badge variant="outline" className="h-5 border-emerald-500/20 bg-emerald-500/10 px-2 text-[10px] text-emerald-600">
                          {message.type ?? "TEXT"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{formatChatTime(message.createdAt)}</p>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-muted/70 px-6 py-10 text-center">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-card text-muted-foreground shadow-sm">
                <MessageCircle className="h-5 w-5" />
              </span>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">No hay estados sincronizados</p>
                <p className="text-sm text-muted-foreground">
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



