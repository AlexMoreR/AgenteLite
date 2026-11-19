import { prisma } from "@/lib/prisma";
import { leerConfigDeAsignacion } from "@/lib/reparto-cuando-lo-necesita";
import { autoAssignConversationToCollaborator } from "@/lib/reparto-de-leads";

/*
  EL AGENTE PIDE ASESORA → SE ASIGNA (T-772, parte 2). Lo llaman las tres salidas del agente V3 en
  el webhook de Evolution: `pasarAUnaAsesora` (video, audio o foto que no entiende),
  `avisarAsesorDelV3` (el libro o el redactor piden una persona) y `pausarIaDelV3` (se pausa la IA).

  Antes el chat solo se repartía dentro del aviso por WhatsApp, y solo si ese aviso estaba
  configurado: sin aviso, el agente se callaba y el chat quedaba sin dueña hasta el rescate. Ahora
  se reparte con la rueda de siempre aunque el aviso no esté, si:
    - el interruptor (a) `agentePide` está prendido (`reparto:cuando:<ws>`), y
    - el chat no tiene asesora (si ya es de alguien, no se toca nunca).
  No manda nada a la clienta: solo la rueda (y su push a la asesora que lo recibe).
  Pruebas: npm run test:reparto-cuando-lo-necesita.
*/
export async function asignarPorqueElAgentePide(input: {
  conversationId: string;
  channelId: string;
  workspaceId: string;
}): Promise<string | null> {
  const config = await leerConfigDeAsignacion(input.workspaceId);
  if (!config.agentePide) return null;

  const conversacion = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { assignedToUserId: true },
  });
  if (!conversacion || conversacion.assignedToUserId) return null;

  return autoAssignConversationToCollaborator({
    conversationId: input.conversationId,
    channelId: input.channelId,
    workspaceId: input.workspaceId,
  });
}
