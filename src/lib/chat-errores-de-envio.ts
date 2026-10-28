import { gatewayDelCanal } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";
import type { MotivoDeFalloDeEnvio } from "@/lib/chat-envio-reintento";

/*
  Registro de cada error al enviar un texto desde Chats (tabla ChatSendError): linea, hora, motivo.

  Sirve para medir: la herramienta `errores_de_envio_de_chats` del MCP lo agrupa por dia, linea y
  motivo. Anotar NUNCA puede romper ni demorar el envio: todo va en try/catch y no lanza.
*/

export type OrigenDelErrorDeEnvio = "servidor" | "navegador";

export type DatosDeLinea = {
  lineaId: string | null;
  lineaNombre: string | null;
  gateway: string | null;
};

const SIN_LINEA: DatosDeLinea = { lineaId: null, lineaNombre: null, gateway: null };

/** La linea y el gateway del chat donde se intento enviar. Si no se puede saber, todo vacio. */
export async function datosDeLineaDelChat(input: {
  source: "agent" | "official";
  conversationId: string;
  workspaceId: string;
}): Promise<DatosDeLinea> {
  try {
    if (input.source === "official") {
      return { lineaId: null, lineaNombre: "API oficial", gateway: "OFFICIAL" };
    }
    const conversacion = await prisma.conversation.findFirst({
      where: { id: input.conversationId, workspaceId: input.workspaceId },
      select: { channel: { select: { id: true, name: true, evolutionInstanceName: true } } },
    });
    const canal = conversacion?.channel;
    if (!canal) {
      return SIN_LINEA;
    }
    return {
      lineaId: canal.id,
      lineaNombre: canal.name,
      gateway: canal.evolutionInstanceName ? await gatewayDelCanal(canal.evolutionInstanceName) : null,
    };
  } catch {
    return SIN_LINEA;
  }
}

/** Anota un error de envio. No lanza nunca. */
export async function anotarErrorDeEnvio(input: {
  workspaceId: string;
  conversationId?: string | null;
  linea?: DatosDeLinea | null;
  motivo: MotivoDeFalloDeEnvio;
  detalle?: string | null;
  clientMessageId?: string | null;
  userId?: string | null;
  intento?: number | null;
  origen: OrigenDelErrorDeEnvio;
}): Promise<void> {
  try {
    await prisma.chatSendError.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId ?? null,
        lineaId: input.linea?.lineaId ?? null,
        lineaNombre: input.linea?.lineaNombre ?? null,
        gateway: input.linea?.gateway ?? null,
        motivo: input.motivo,
        detalle: input.detalle ? input.detalle.slice(0, 500) : null,
        clientMessageId: input.clientMessageId ?? null,
        userId: input.userId ?? null,
        intento: Math.min(Math.max(Math.trunc(input.intento ?? 1), 1), 10),
        origen: input.origen,
      },
    });
  } catch (error) {
    console.warn("[chat-errores-de-envio] no se pudo anotar el error", error instanceof Error ? error.message : error);
  }
}
