import { redirect } from "next/navigation";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getVisibleChannelIds } from "@/lib/channel-visibility";
import { prisma } from "@/lib/prisma";

/**
 * Link corto de un chat: app.aizenbot.com/c/1234.
 *
 * Los avisos que salen por WhatsApp llevaban el link entero
 * (/cliente/chats?chatKey=agent:cvb085ce...&assigned=all), dos renglones de letras que nadie lee
 * (Alex, 03-10-2026). Aca solo se traduce el numero al chat y se abre la bandeja de siempre: la
 * pantalla de chats, el realtime y todo lo demas siguen funcionando con la clave larga, sin enterarse.
 *
 * El numero es seguido y se puede adivinar, asi que se cuida lo mismo que la bandeja: solo chats
 * del negocio de quien entra, y a quien no es jefe solo los de sus lineas.
 */
export default async function LinkCortoDeChatPage({ params }: { params: Promise<{ numero: string }> }) {
  const access = await requireClientWorkspaceAccess("chats", { redirectTo: "/login" });
  const { numero: texto } = await params;
  const numero = Number.parseInt(texto, 10);
  if (!Number.isSafeInteger(numero) || numero <= 0 || String(numero) !== texto.trim()) {
    redirect("/cliente/chats");
  }

  const delCanalViejo = await prisma.conversation.findFirst({
    where: { numero, workspaceId: access.workspaceId },
    select: { id: true, channelId: true },
  });

  if (delCanalViejo) {
    const esJefe = access.isOwner || access.membershipRole === "OWNER" || access.membershipRole === "ADMIN";
    const lineasVisibles = await getVisibleChannelIds({
      workspaceId: access.workspaceId,
      userId: access.userId,
      esJefe,
    });
    if (lineasVisibles && (!delCanalViejo.channelId || !lineasVisibles.includes(delCanalViejo.channelId))) {
      redirect("/cliente/chats");
    }
    // assigned=all: el aviso le llega a todo el equipo y casi siempre el chat es de otra asesora;
    // filtrado en "Mias" no aparecia. A quien no es jefe el servidor le fuerza "Mias" igual.
    redirect(`/cliente/chats?chatKey=${encodeURIComponent(`agent:${delCanalViejo.id}`)}&assigned=all`);
  }

  const deLaApiOficial = await prisma.officialApiConversation.findFirst({
    where: { numero, config: { workspaceId: access.workspaceId } },
    select: { id: true },
  });
  if (deLaApiOficial) {
    redirect(`/cliente/chats?chatKey=${encodeURIComponent(`official:${deLaApiOficial.id}`)}&assigned=all`);
  }

  redirect("/cliente/chats");
}
