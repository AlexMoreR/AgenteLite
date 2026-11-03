// Coach con Opus (parte 3, 3-nov-2026): lo que la tarjeta "Revisión del día (Opus)" necesita de cada
// chat: el enlace al chat en el CRM (el mismo formato de /c/[numero]) y una etiqueta corta
// "#3948 · •••• 0204". Nunca sale el teléfono completo. Siempre filtrado por el negocio: un chatId de
// otro negocio no se encuentra y queda "Sin enlace al chat".
import { prisma } from "@/lib/prisma";

import { ultimos4 } from "./reglas";

export type EnlaceDeChatOpus = { href: string | null; etiqueta: string };

/** El enlace al chat exacto en la bandeja: `agent:` para el canal viejo, `official:` para la API oficial. */
export function hrefDeChatOpus(fuente: "agent" | "official", id: string) {
  return `/cliente/chats?chatKey=${encodeURIComponent(`${fuente}:${id}`)}&assigned=all`;
}

/** "#3948 · •••• 0204" (sin número o sin teléfono, lo que haya). Nunca más de 4 dígitos del teléfono. */
export function etiquetaDeChatOpus(numero: number | null | undefined, telefono: string | null | undefined) {
  const digitos = ultimos4(telefono);
  const partes = [
    typeof numero === "number" && numero > 0 ? `#${numero}` : "",
    digitos.length === 4 ? `•••• ${digitos}` : "",
  ].filter(Boolean);
  return partes.join(" · ") || "Chat";
}

/** Enlace y etiqueta de cada chatId de la revisión, buscados solo en este negocio. */
export async function enlacesDeChatsOpus(workspaceId: string, chatIds: string[]): Promise<Record<string, EnlaceDeChatOpus>> {
  const ids = [...new Set(chatIds.filter((id) => typeof id === "string" && id.trim()))];
  if (!ids.length) return {};
  const [viejos, oficiales] = await Promise.all([
    prisma.conversation.findMany({
      where: { id: { in: ids }, workspaceId },
      select: { id: true, numero: true, contact: { select: { phoneNumber: true } } },
    }),
    prisma.officialApiConversation.findMany({
      where: { id: { in: ids }, config: { workspaceId } },
      select: { id: true, numero: true, contact: { select: { phoneNumber: true, waId: true } } },
    }),
  ]);
  const enlaces: Record<string, EnlaceDeChatOpus> = {};
  for (const chat of oficiales) {
    enlaces[chat.id] = {
      href: hrefDeChatOpus("official", chat.id),
      etiqueta: etiquetaDeChatOpus(chat.numero, chat.contact?.phoneNumber ?? chat.contact?.waId),
    };
  }
  for (const chat of viejos) {
    enlaces[chat.id] = { href: hrefDeChatOpus("agent", chat.id), etiqueta: etiquetaDeChatOpus(chat.numero, chat.contact?.phoneNumber) };
  }
  return enlaces;
}
