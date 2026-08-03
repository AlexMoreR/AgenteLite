"use server";

import { auth } from "@/auth";
import { getFlowReply } from "@/lib/agent-product-flow";
import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { sendChatMediaReplyAction } from "@/app/actions/agent-actions";
import { sendUnifiedChatReplyAction } from "@/app/actions/chats-actions";

/**
 * Mandar un flujo entero desde el chat, con un toque.
 *
 * La asesora tenia que buscar el PDF del catalogo en su celular y subirlo a mano en cada
 * conversacion, aunque el flujo con ese mismo catalogo ya estuviera armado y el agente supiera
 * mandarlo solo. Esto le da el mismo boton que tiene el bot.
 *
 * Se manda paso por paso REUSANDO las acciones del compositor —las mismas que corren cuando ella
 * manda un archivo a mano— en vez de duplicar el motor del webhook. Asi queda registrado como un
 * envio suyo (cuenta en su tablero, toma el lead si no tenia dueño) y no se toca la pieza que
 * procesa todo lo que entra al negocio.
 */

export type FlowChoice = { id: string; title: string };

export async function listFlowsForChatAction(): Promise<FlowChoice[]> {
  const session = await auth();
  if (!session?.user?.id) {
    return [];
  }
  await requireClientWorkspaceAccess("chats");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    return [];
  }

  const items = await getCreatedFlowItems({
    workspaceId: membership.workspace.id,
    includeOfficialApi: true,
  });

  return items
    .map((item) => ({ id: item.id, title: item.title?.trim() || "Flujo sin nombre" }))
    .sort((a, b) => a.title.localeCompare(b.title, "es"));
}

export type SendFlowResult =
  | { ok: true; enviados: number; fallidos: number; omitidos: number }
  | { ok: false; error: string };

const PAUSA_ARCHIVO_MS = 3000;
const PAUSA_TEXTO_MS = 700;

function esperar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendFlowToChatAction(input: {
  source: "agent" | "official";
  conversationId: string;
  flowId: string;
  agentId?: string;
}): Promise<SendFlowResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "No autorizado" };
  }
  await requireClientWorkspaceAccess("chats");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id) {
    return { ok: false, error: "Workspace no encontrado" };
  }

  const flujo = await getFlowReply({
    workspaceId: membership.workspace.id,
    flowId: input.flowId,
    includeOfficialApi: true,
  });

  if (!flujo || flujo.steps.length === 0) {
    return { ok: false, error: "Ese flujo no tiene nada para enviar." };
  }

  let enviados = 0;
  let fallidos = 0;
  let omitidos = 0;

  for (const [indice, paso] of flujo.steps.entries()) {
    // Las pausas son las mismas que usa el agente: WhatsApp entrega mal varias cosas seguidas,
    // y al cliente le llega mas natural que caiga de a poco.
    if (indice > 0) {
      await esperar(paso.kind === "text" ? PAUSA_TEXTO_MS : PAUSA_ARCHIVO_MS);
    }

    try {
      if (paso.kind === "text") {
        const datos = new FormData();
        datos.set("source", input.source);
        datos.set("conversationId", input.conversationId);
        datos.set("message", paso.content);
        // Contenido preparado: va tal cual, sin la firma de la asesora encima.
        datos.set("skipSignature", "1");
        if (input.agentId) {
          datos.set("agentId", input.agentId);
        }
        const resultado = await sendUnifiedChatReplyAction(datos);
        if (resultado?.ok) enviados += 1;
        else fallidos += 1;
        continue;
      }

      if (paso.kind === "audio") {
        // El compositor manda audio por otro camino (nota de voz). Se cuenta aparte para poder
        // decirle a la asesora que ese paso quedo sin mandar, en vez de mentirle con un "listo".
        omitidos += 1;
        continue;
      }

      const tipo = paso.kind === "image" ? "IMAGE" : paso.kind === "video" ? "VIDEO" : "DOCUMENT";
      const nombreArchivo =
        paso.kind === "document" ? paso.fileName?.trim() || "documento.pdf" : `${paso.kind}.file`;

      const resultado = await sendChatMediaReplyAction({
        source: input.source,
        conversationId: input.conversationId,
        agentId: input.agentId,
        mediaUrl: paso.url,
        mediaType: tipo,
        fileName: nombreArchivo,
        mimeType: paso.kind === "document" ? "application/pdf" : "application/octet-stream",
        caption: paso.caption?.trim() || undefined,
        returnTo: "",
      });

      if (resultado && "ok" in resultado && resultado.ok) enviados += 1;
      else fallidos += 1;
    } catch (error) {
      fallidos += 1;
      console.error("[chats] fallo un paso al enviar el flujo a mano", {
        conversationId: input.conversationId,
        flowId: input.flowId,
        paso: paso.kind,
        detalle: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { ok: true, enviados, fallidos, omitidos };
}
