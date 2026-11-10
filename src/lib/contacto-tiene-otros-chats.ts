import { prisma } from "@/lib/prisma";

/**
 * Si el contacto tiene OTRO chat ademas de este (otra linea de WhatsApp o el canal oficial).
 *
 * La etapa del CRM es del contacto, no del chat. Cuando una accion del chat abierto la cambia, el
 * chat abierto se pone al dia trayendo su fila, pero la fila del otro chat del mismo contacto no:
 * en ese caso el control vuelve a pedir la pantalla entera, como antes. Ver
 * refrescar-tras-accion-del-chat.ts.
 *
 * Ante la duda (si falla la consulta) dice que si: pedir la pantalla entera es lo de siempre.
 */
export async function contactoTieneOtrosChats(
  workspaceId: string,
  contactId: string,
  conversationId: string | null,
): Promise<boolean> {
  try {
    const [otroChat, chatOficial] = await Promise.all([
      prisma.conversation.findFirst({
        where: { workspaceId, contactId, ...(conversationId ? { id: { not: conversationId } } : {}) },
        select: { id: true },
      }),
      prisma.officialApiContact.findFirst({
        where: { crmContactId: contactId, config: { workspaceId } },
        select: { id: true },
      }),
    ]);
    return Boolean(otroChat || chatOficial);
  } catch {
    return true;
  }
}
