import { readGatewayConnection } from "@/lib/evolution";
import { prisma } from "@/lib/prisma";
import type { MotivoDeFallo } from "@/lib/chat-envio-reintento";

/*
  Registro de cada mensaje de una asesora que NO salio desde Chats (tabla ChatSendError).

  Sirve para medir: errores de envio por dia, por linea y por motivo (herramienta del MCP
  errores_de_envio_de_chats). Es a prueba de fallos a proposito: si anotar falla, se loguea y
  sigue; medir nunca puede romper el envio. Sin telefonos ni texto del mensaje, solo ids internos.
*/

const DETALLE_MAX = 300;

export type ErrorDeEnvio = {
  workspaceId: string;
  source: "agent" | "official";
  conversationId: string | null;
  motivo: MotivoDeFallo;
  detalle?: string | null;
  clientMessageId?: string | null;
  userId?: string | null;
  intento?: number;
  origen?: "servidor" | "navegador";
  /** Cuando fallo, si no fue recien (los del navegador se anotan al volver la red). */
  ocurrioEn?: Date;
};

type Linea = { lineaId: string | null; lineaNombre: string | null; gateway: string | null };

const SIN_LINEA: Linea = { lineaId: null, lineaNombre: null, gateway: null };

/** La linea del chat y su gateway, solo si el chat es de ese negocio. */
async function lineaDelChat(input: {
  workspaceId: string;
  source: "agent" | "official";
  conversationId: string | null;
}): Promise<Linea> {
  if (!input.conversationId) {
    return SIN_LINEA;
  }
  if (input.source === "official") {
    const filas = await prisma.$queryRaw<Array<{ id: string; nombre: string | null }>>`
      SELECT cfg."id", ('API oficial ' || COALESCE(cfg."phoneNumberId", '')) AS "nombre"
      FROM "OfficialApiConversation" c
      INNER JOIN "OfficialApiClientConfig" cfg ON cfg."id" = c."configId"
      WHERE c."id" = ${input.conversationId}
        AND cfg."workspaceId" = ${input.workspaceId}
      LIMIT 1
    `;
    const fila = filas[0];
    return fila ? { lineaId: fila.id, lineaNombre: fila.nombre, gateway: "OFFICIAL" } : SIN_LINEA;
  }
  const conversacion = await prisma.conversation.findFirst({
    where: { id: input.conversationId, workspaceId: input.workspaceId },
    select: { channel: { select: { id: true, name: true, metadata: true } } },
  });
  const canal = conversacion?.channel;
  if (!canal) {
    return SIN_LINEA;
  }
  return {
    lineaId: canal.id,
    lineaNombre: canal.name,
    // Los canales viejos no tienen gateway guardado y son de Evolution GO (mismo default que evolution.ts).
    gateway: readGatewayConnection(canal.metadata)?.kind ?? "EVOLUTION_GO",
  };
}

export async function anotarErrorDeEnvio(error: ErrorDeEnvio): Promise<void> {
  try {
    const linea = await lineaDelChat(error).catch(() => SIN_LINEA);
    const intento = Number.isInteger(error.intento) && (error.intento ?? 0) > 0 ? Math.min(error.intento ?? 1, 10) : 1;
    await prisma.chatSendError.create({
      data: {
        workspaceId: error.workspaceId,
        // Solo si el chat es de ese negocio: el id puede venir del navegador.
        conversationId: linea.lineaId ? error.conversationId : null,
        lineaId: linea.lineaId,
        lineaNombre: linea.lineaNombre,
        gateway: linea.gateway,
        motivo: error.motivo,
        detalle: error.detalle ? error.detalle.slice(0, DETALLE_MAX) : null,
        clientMessageId: error.clientMessageId ?? null,
        userId: error.userId ?? null,
        intento,
        origen: error.origen ?? "servidor",
        ...(error.ocurrioEn ? { createdAt: error.ocurrioEn } : {}),
      },
    });
  } catch (fallo) {
    console.error("[chat-errores-de-envio] no se pudo anotar el error de envio", {
      motivo: error.motivo,
      conversationId: error.conversationId,
      error: fallo instanceof Error ? fallo.message : String(fallo),
    });
  }
}
