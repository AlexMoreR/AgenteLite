import { elV3AtendioLaCharla } from "@/features/agente-v3/motor/estado";
import { prisma } from "@/lib/prisma";

import { PREFIJO_TRAS_ASESORA, esDiaSiguiente, frenoDelDiaSiguienteAlEnviar } from "../dominio/dia-siguiente";
import { leerConfigSeguimiento } from "./config";

/**
 * Lo que revisa el motor de seguimientos justo antes de enviar un "Etapa <paso> · día siguiente"
 * (ver dominio/dia-siguiente.ts). Va ADEMÁS del anti-bloqueo de siempre, y aplica aunque "un solo
 * dueño" esté apagado: interruptor apagado, chat pausado, etapa cerrada, chat que el V3 nunca
 * atendió, o un "Tras asesora" agendado después. null = puede salir. Ante un error, null (sale
 * como cualquier "Etapa …": el resto del anti-bloqueo sigue).
 */
export async function revisarDiaSiguienteAlEnviar(follow: {
  workspaceId: string;
  contactId: string;
  channelId: string | null;
  name: string | null;
  createdAt: Date;
}): Promise<ReturnType<typeof frenoDelDiaSiguienteAlEnviar>> {
  if (!esDiaSiguiente(follow.name)) return null;
  try {
    const config = await leerConfigSeguimiento(follow.workspaceId);
    const charla = await prisma.conversation.findFirst({
      where: { workspaceId: follow.workspaceId, contactId: follow.contactId, ...(follow.channelId ? { channelId: follow.channelId } : {}) },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true, automationPaused: true, contact: { select: { crmStage: true } } },
    });
    const [v3Atendio, trasAsesora] = await Promise.all([
      charla ? elV3AtendioLaCharla(charla.id) : Promise.resolve(false),
      prisma.follow.count({
        where: {
          workspaceId: follow.workspaceId,
          contactId: follow.contactId,
          name: { startsWith: PREFIJO_TRAS_ASESORA },
          createdAt: { gt: follow.createdAt },
        },
      }),
    ]);
    return frenoDelDiaSiguienteAlEnviar({
      activo: Boolean(config.diaSiguiente?.rearmar),
      pausado: charla ? Boolean(charla.automationPaused) : null,
      etapaCrm: charla?.contact?.crmStage ? String(charla.contact.crmStage) : null,
      v3Atendio,
      trasAsesoraDespues: trasAsesora > 0,
    });
  } catch (error) {
    console.warn("[dia-siguiente] fallo la revision al enviar; sigue el anti-bloqueo de siempre", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
