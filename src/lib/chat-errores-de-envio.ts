import { prisma } from "@/lib/prisma";
import { MOTIVOS_DE_FALLA, type MotivoDeFalla } from "@/lib/chat-envio-reintento";

/**
 * Anota un error de envío del chat (línea, hora, motivo) para medirlos.
 *
 * Nunca lanza: medir no puede romper el envío ni tapar el error real.
 */
export async function registrarErrorDeEnvio(input: {
  workspaceId: string;
  conversationId?: string | null;
  lineaId?: string | null;
  lineaNombre?: string | null;
  gateway?: string | null;
  motivo: MotivoDeFalla | string;
  detalle?: string | null;
  clientMessageId?: string | null;
  userId?: string | null;
  intento?: number;
  origen?: "servidor" | "navegador";
}) {
  try {
    const motivo = (MOTIVOS_DE_FALLA as readonly string[]).includes(input.motivo) ? input.motivo : "otro";
    await prisma.chatSendError.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId ?? null,
        lineaId: input.lineaId ?? null,
        lineaNombre: input.lineaNombre?.slice(0, 120) ?? null,
        gateway: input.gateway ?? null,
        motivo,
        detalle: input.detalle?.slice(0, 500) ?? null,
        clientMessageId: input.clientMessageId ?? null,
        userId: input.userId ?? null,
        intento: Math.max(1, Math.min(input.intento ?? 1, 9)),
        origen: input.origen ?? "servidor",
      },
    });
  } catch (error) {
    console.error("[chat-errores-de-envio] no se pudo anotar el error de envio", error);
  }
}
