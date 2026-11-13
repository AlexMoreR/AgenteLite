"use server";

import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { getFlowReply } from "@/lib/agent-product-flow";
import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { getVisibleChannelIds } from "@/lib/channel-visibility";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";
import { esSupervisora } from "@/lib/permisos-del-equipo";
import { puedeAbrirChatPorClave } from "@/lib/chats-acceso-por-enlace";
import { getPrimaryWorkspaceForUser } from "@/lib/workspace";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { AVISO_MODO_MONITOREO, canalesQueMonitorea, estaEnModoMonitoreo } from "@/lib/modo-monitoreo";
import { armarPasos, calcularAvance } from "@/lib/flujos/envio-de-flujo";
import {
  ERROR_ENVIO_NO_ENCONTRADO,
  procesarEnvioDeFlujo,
  reintentarPasoDeEnvio,
  type ResultadoDeReintento,
} from "@/lib/flujos/procesar-envio-de-flujo";

/**
 * Mandar un flujo entero desde el chat, con un toque.
 *
 * La asesora tenia que buscar el PDF del catalogo en su celular y subirlo a mano en cada
 * conversacion, aunque el flujo con ese mismo catalogo ya estuviera armado y el agente supiera
 * mandarlo solo. Esto le da el mismo boton que tiene el bot.
 *
 * Se manda paso por paso REUSANDO los caminos del compositor —los mismos que corren cuando ella
 * manda un archivo a mano— en vez de duplicar el motor del webhook. Asi queda registrado como un
 * envio suyo (cuenta en su tablero, toma el lead si no tenia dueño) y no se toca la pieza que
 * procesa todo lo que entra al negocio.
 *
 * Desde la parte 2 de «Flujos: que se envien completos…» lo manda el SERVIDOR: la accion guarda una
 * fila EnvioDeFlujo y contesta al instante; procesarEnvioDeFlujo la manda despues de responder
 * (after()) y el cron la retoma si el proceso se cayo. Si la asesora cambia de chat o cierra la
 * pestaña, el flujo sale completo igual.
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
  // envioId y total: solo desde la parte 2 (el flujo lo manda el servidor). Opcionales: una pestaña
  // vieja los ignora y sigue mostrando «listo».
  | { ok: true; enviados: number; fallidos: number; omitidos: number; envioId?: string; total?: number }
  | { ok: false; error: string };

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
  const workspaceId = membership.workspace.id;
  const userId = session.user.id;
  const source = input?.source === "official" ? "official" : "agent";
  const conversationId = typeof input?.conversationId === "string" ? input.conversationId.trim() : "";
  const flowId = typeof input?.flowId === "string" ? input.flowId.trim() : "";
  const agentId = typeof input?.agentId === "string" && input.agentId.trim() ? input.agentId.trim() : null;
  if (!conversationId || !flowId) {
    return { ok: false, error: "Datos invalidos" };
  }

  // Quien solo monitorea no envia: se le dice de una vez, en vez de que cada paso falle despues.
  if (await estaEnModoMonitoreo({ workspaceId, userId })) {
    return { ok: false, error: AVISO_MODO_MONITOREO };
  }

  const [flujo, chat] = await Promise.all([
    getFlowReply({ workspaceId, flowId, includeOfficialApi: true }),
    source === "official"
      ? prisma.officialApiConversation.findFirst({
          where: { id: conversationId, config: { workspaceId } },
          select: { id: true },
        })
      : prisma.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { id: true } }),
  ]);

  if (!flujo || flujo.steps.length === 0) {
    return { ok: false, error: "Ese flujo no tiene nada para enviar." };
  }
  if (!chat) {
    return { ok: false, error: "No se encontro el chat" };
  }

  // Los pasos quedan como estaban al tocar «Enviar flujo»: si despues cambian el flujo, sale igual.
  const pasos = armarPasos(flujo.steps);
  const { total } = calcularAvance(pasos);
  const omitidos = pasos.length - total;

  const envio = await prisma.envioDeFlujo.create({
    data: {
      workspaceId,
      conversationId,
      source,
      flowId,
      agentId,
      userId,
      pasos: pasos as unknown as Prisma.InputJsonValue,
      total,
    },
    select: { id: true },
  });

  // Se manda despues de responder. Si el proceso se cae a la mitad, el cron lo retoma
  // (retomarEnviosQuedados en /api/cron/follows).
  after(() => procesarEnvioDeFlujo(envio.id));

  return { ok: true, enviados: 0, fallidos: 0, omitidos, envioId: envio.id, total };
}

export type ResultadoDeReintentarPaso = ResultadoDeReintento;

/** El indice mas alto que se acepta: un flujo nunca trae tantos pasos. */
const INDICE_MAXIMO = 1000;

/**
 * «No salió · Reintentar» de UN paso del flujo (parte 4 de «Flujos: que se envien completos…»).
 * Manda solo ese paso, si esta fallido; los demas no se tocan. Si el envio todavia se esta mandando
 * (candado vigente) contesta error sin mandar. Lo manda quien toca Reintentar, con su permiso.
 */
export async function reintentarPasoDeFlujoAction(input: {
  envioId: string;
  indice: number;
}): Promise<ResultadoDeReintentarPaso> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "No autorizado" };
  }
  const access = await requireClientWorkspaceAccess("chats");

  const membership = await getPrimaryWorkspaceForUser(session.user.id);
  if (!membership?.workspace.id || membership.workspace.id !== access.workspaceId) {
    return { ok: false, error: "Workspace no encontrado" };
  }
  const workspaceId = membership.workspace.id;
  const userId = session.user.id;
  const envioId = typeof input?.envioId === "string" ? input.envioId.trim() : "";
  const indice = input?.indice;
  if (!envioId || envioId.length > 100 || typeof indice !== "number" || !Number.isInteger(indice) || indice < 0 || indice > INDICE_MAXIMO) {
    return { ok: false, error: "Datos invalidos" };
  }

  // Quien solo monitorea no envia: se le dice de una vez.
  if (await estaEnModoMonitoreo({ workspaceId, userId })) {
    return { ok: false, error: AVISO_MODO_MONITOREO };
  }

  const envio = await prisma.envioDeFlujo.findFirst({
    where: { id: envioId, workspaceId },
    select: { conversationId: true, source: true },
  });
  if (!envio) {
    return { ok: false, error: ERROR_ENVIO_NO_ENCONTRADO };
  }

  // Quien reintenta tiene que poder abrir ese chat (las mismas reglas que la franja y /live).
  const [canalesMonitoreados, esJefe, canalesVisibles] = await Promise.all([
    canalesQueMonitorea({ workspaceId, userId }),
    esJefeDelNegocio(access) ? Promise.resolve(true) : esSupervisora(workspaceId, userId),
    getVisibleChannelIds({ workspaceId, userId, esJefe: access.isOwner || access.role === "ADMIN" }),
  ]);
  const permitido = await puedeAbrirChatPorClave({
    workspaceId,
    userId,
    fuente: envio.source === "official" ? "official" : "agent",
    conversationId: envio.conversationId,
    esJefe,
    canalesVisibles,
    canalesMonitoreados,
  });
  if (!permitido) {
    return { ok: false, error: ERROR_ENVIO_NO_ENCONTRADO };
  }

  return reintentarPasoDeEnvio({ envioId, indice, userId, workspaceId });
}
