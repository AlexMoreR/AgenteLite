"use server";

import type { DatosDelLead } from "@/features/mapa-del-lead/dominio/mapa";
import { contactoDelChat, leerDatosDelLead } from "@/features/mapa-del-lead/servicios/leer";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

/**
 * Datos del MAPA DEL LEAD de un chat. Solo lectura.
 *
 * Permiso: el mismo que para ver la bandeja (módulo "chats" del negocio). Quien puede abrir el chat
 * puede ver su mapa; el contacto se busca SIEMPRE dentro del negocio de quien pregunta.
 */
export async function leerMapaDelLeadAction(input: { chatKey: string }): Promise<{ datos: DatosDelLead } | { error: string }> {
  const access = await requireClientWorkspaceAccess("chats");
  const chatKey = typeof input?.chatKey === "string" ? input.chatKey.trim() : "";
  if (!chatKey) return { error: "Falta el chat" };
  try {
    const contactId = await contactoDelChat(access.workspaceId, chatKey);
    if (!contactId) return { error: "Este chat no tiene ficha en el CRM" };
    return await leerDatosDelLead(access.workspaceId, contactId);
  } catch (error) {
    console.error("[mapa-del-lead] no se pudo leer", error);
    return { error: "No se pudo armar el mapa" };
  }
}
