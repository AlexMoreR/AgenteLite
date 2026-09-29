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

/*
  QUE ARCHIVO ES: el tipo real y su nombre, sacados de la direccion.

  Esto mandaba `application/octet-stream` y un nombre inventado ("image.file") para toda foto y
  todo video. WhatsApp recibia el mensaje -le daba su id y hasta lo marcaba como entregado-, pero
  al llegar al telefono no lo podia dibujar: le habiamos dicho que era un archivo de tipo
  desconocido. En el chat del cliente no aparecia nada (Alex, 28-09-2026).

  El video se salvaba de casualidad: su ruta de WAHA lleva `convert: true`, asi que WAHA lo
  re-codifica y le pone el tipo correcto por su cuenta. Las fotos no pasan por ahi, y por eso
  llegaba el video y no las fotos, que es exactamente lo que se veia.

  El camino automatico -el del agente- nunca tuvo el problema porque manda "image/jpeg" a mano.
  Aca se saca de la extension, que ademas conserva el nombre de verdad del archivo.
*/
const MIME_POR_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  pdf: "application/pdf",
};

/** Si la direccion no dice nada, se usa lo mismo que manda el agente para ese tipo. */
const MIME_POR_DEFECTO: Record<string, string> = {
  image: "image/jpeg",
  video: "video/mp4",
  document: "application/pdf",
};

function describirArchivo(
  kind: string,
  url: string,
  nombreDelPaso?: string | null,
): { mime: string; nombre: string } {
  const ultimoTramo = decodeURIComponent(url.split("?")[0].split("/").pop() ?? "");
  const extension = ultimoTramo.includes(".") ? (ultimoTramo.split(".").pop() ?? "").toLowerCase() : "";
  const mime = MIME_POR_EXTENSION[extension] ?? MIME_POR_DEFECTO[kind] ?? "application/octet-stream";

  const nombre =
    nombreDelPaso?.trim() ||
    ultimoTramo ||
    (kind === "image" ? "foto.jpg" : kind === "video" ? "video.mp4" : "documento.pdf");

  return { mime, nombre };
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
      // Solo el documento trae nombre propio; la foto y el video lo sacan de la direccion.
      const archivo = describirArchivo(paso.kind, paso.url, paso.kind === "document" ? paso.fileName : null);

      const resultado = await sendChatMediaReplyAction({
        source: input.source,
        conversationId: input.conversationId,
        agentId: input.agentId,
        mediaUrl: paso.url,
        mediaType: tipo,
        fileName: archivo.nombre,
        mimeType: archivo.mime,
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
