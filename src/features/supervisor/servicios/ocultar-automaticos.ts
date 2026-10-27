import { prisma } from "@/lib/prisma";

import { motivoAutomatico } from "../dominio/chat-automatico";
import type { ChatAbierto } from "../dominio/detectores-atencion";
import { yaRevisadoComoAutomatico } from "../dominio/exclusiones";

/**
 * Los chats que son un robot (banco, códigos de verificación…) y todavía se ven en el CRM: se ocultan
 * igual que los proveedores (`excludedFromCrm = true`), con la nota `metadata.chatAutomatico` (motivo y
 * fecha). Mi día, el CRM, Llamadas y Campañas ya respetan esa marca. El dueño lo deshace desde
 * Contactos; con la nota puesta el Supervisor no lo vuelve a ocultar. Es lo ÚNICO que el Supervisor
 * escribe fuera de sus alertas, y solo toca contactos que nadie ha respondido.
 */
export function chatsParaOcultar(chats: ChatAbierto[]): Array<{ contactoId: string; motivo: string }> {
  const vistos = new Set<string>();
  const salida: Array<{ contactoId: string; motivo: string }> = [];
  for (const chat of chats) {
    if (!chat.contactoId || vistos.has(chat.contactoId)) continue;
    if (chat.ocultoDelCrm || chat.bloqueado || yaRevisadoComoAutomatico(chat.metadata)) continue;
    const motivo = motivoAutomatico({
      nombre: chat.nombreCliente,
      textos: [...(chat.textosDelCliente ?? []), ...chat.textosPendientes],
      ultimaRespuestaHumanaEn: chat.ultimaRespuestaHumanaEn,
    });
    if (!motivo) continue;
    vistos.add(chat.contactoId);
    salida.push({ contactoId: chat.contactoId, motivo });
  }
  return salida;
}

export async function ocultarChatsAutomaticos(workspaceId: string, chats: ChatAbierto[], ahora: Date): Promise<number> {
  let ocultos = 0;
  for (const { contactoId, motivo } of chatsParaOcultar(chats)) {
    const contacto = await prisma.contact.findFirst({ where: { id: contactoId, workspaceId }, select: { metadata: true, excludedFromCrm: true } });
    if (!contacto || contacto.excludedFromCrm || yaRevisadoComoAutomatico(contacto.metadata)) continue;
    const meta = contacto.metadata && typeof contacto.metadata === "object" ? (contacto.metadata as Record<string, unknown>) : {};
    await prisma.contact.update({
      where: { id: contactoId },
      data: { excludedFromCrm: true, metadata: { ...meta, chatAutomatico: { motivo, en: ahora.toISOString() } } },
    });
    ocultos += 1;
  }
  return ocultos;
}
