import { prisma } from "@/lib/prisma";

import type { ChatAbierto } from "../dominio/detectores-atencion";
import { detectarChatAutomatico } from "../dominio/chat-automatico";

/**
 * Los chats automáticos (robots de bancos, códigos de verificación) se ocultan del CRM igual que los
 * proveedores: `Contact.excludedFromCrm = true` + una nota en `metadata.chatAutomatico` (motivo y fecha).
 * Mi día, el CRM, Llamadas y Campañas ya respetan esa marca. Se deshace desde Contactos (botón de mostrar)
 * y, con la nota puesta, el Supervisor no lo vuelve a ocultar. No toca mensajes ni chats.
 */

/** Los chats de la lista que son robot, no están ocultos y nunca fueron ocultados por el Supervisor. */
export function robotsPorOcultar(chats: ChatAbierto[]): Array<{ conversationId: string; motivo: string }> {
  const salida: Array<{ conversationId: string; motivo: string }> = [];
  for (const chat of chats) {
    if (chat.ocultoDelCrm || chat.bloqueado) continue;
    const meta = (chat.metadata ?? {}) as Record<string, unknown>;
    if (meta.chatAutomatico) continue; // ya se ocultó una vez: si el dueño lo mostró, se respeta
    const veredicto = detectarChatAutomatico({
      nombre: chat.nombreCliente,
      textos: [...(chat.textosDelCliente ?? []), ...chat.textosPendientes],
      respondioUnaPersona: Boolean(chat.ultimaRespuestaHumanaEn),
    });
    if (veredicto.automatico && veredicto.motivo) salida.push({ conversationId: chat.conversationId, motivo: veredicto.motivo });
  }
  return salida;
}

/** Oculta del CRM los contactos de esos chats. Devuelve cuántos ocultó. */
export async function ocultarChatsAutomaticos(workspaceId: string, robots: Array<{ conversationId: string; motivo: string }>, ahora: Date): Promise<number> {
  let ocultos = 0;
  for (const robot of robots) {
    const conversacion = await prisma.conversation.findFirst({
      where: { id: robot.conversationId, workspaceId },
      select: { contact: { select: { id: true, excludedFromCrm: true, metadata: true } } },
    });
    const contacto = conversacion?.contact;
    if (!contacto || contacto.excludedFromCrm) continue;
    const metadata = (contacto.metadata && typeof contacto.metadata === "object" && !Array.isArray(contacto.metadata) ? contacto.metadata : {}) as Record<string, unknown>;
    if (metadata.chatAutomatico) continue;
    await prisma.contact.update({
      where: { id: contacto.id },
      data: { excludedFromCrm: true, metadata: { ...metadata, chatAutomatico: { motivo: robot.motivo, en: ahora.toISOString() } } },
    });
    ocultos += 1;
  }
  return ocultos;
}
