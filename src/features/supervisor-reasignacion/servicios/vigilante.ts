import { calcularReparto } from "@/lib/channel-collaborators";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { sendEvolutionTextMessageWithReconnect } from "@/lib/evolution";
import { filtrarSinPausaManual } from "@/lib/en-linea";
import { filtrarPorHorario } from "@/lib/horario-de-reparto";
import { prisma } from "@/lib/prisma";
import { notifyRealtimeUpdate } from "@/lib/realtime-notify";
import { sendPushToUser } from "@/lib/web-push";

import { CONFIG_GRAVEDAD_POR_DEFECTO } from "@/features/avisos-gravedad/dominio/reglas";
import { leerConfigGravedad, numeroDeAvisosDeLaPersona, pushAAlexander } from "@/features/avisos-gravedad/servicios/enrutador";
import { enHorario, type ChatAbierto } from "@/features/supervisor/dominio/detectores-atencion";
import { leerChatsAbiertos, nombresDeAsesoras } from "@/features/supervisor/servicios/datos";

import {
  armarMensaje,
  claveDeAviso,
  decidir,
  enlaceDelChat,
  lineaDeAviso,
  type Anotados,
  type ConfigReasignacion,
  type Decision,
  type TipoDeAviso,
} from "../dominio/reglas";
import { negociosConVigilante } from "./config";

/**
 * EL VIGILANTE DE REASIGNACIÓN (servicio; las reglas están en ../dominio/reglas.ts).
 *
 * Una vuelta por minuto (la llama /api/cron/follows) para cada negocio con algún interruptor prendido
 * en AppSetting `supervisor:reasignacion:<workspaceId>`. Sin fila, o con los dos en false, NO hace nada.
 *
 * Reglas de seguridad:
 *  - Nunca le escribe a un cliente: los WhatsApp salen por la línea configurada, solo si es
 *    ADMINISTRATIVA, y solo a números de la lista de avisos del equipo (Mi empresa → Equipo).
 *  - Primero se ANOTA en SupervisorAviso (regla única por chat + tipo + mensaje del cliente) y solo si
 *    se pudo anotar se manda o se reasigna: así no hay avisos duplicados ni entre vueltas ni entre procesos.
 *  - Reasignar solo si el chat sigue siendo de la asesora anterior, sigue abierto y ella no escribió ya.
 *  - Nunca lanza hacia el reloj.
 */

let corriendo = false;

const VENTANA_DE_ANOTADOS_MS = 30 * 24 * 3_600_000;

export type ResultadoDeLaVuelta = { negocios: number; avisos: number; reasignaciones: number };

export async function vueltaDeReasignacion(ahora = new Date()): Promise<ResultadoDeLaVuelta> {
  const total: ResultadoDeLaVuelta = { negocios: 0, avisos: 0, reasignaciones: 0 };
  if (corriendo) return total;
  corriendo = true;
  try {
    const negocios = await negociosConVigilante();
    for (const { workspaceId, config } of negocios) {
      // Fuera de horario no avisa ni reasigna: ni siquiera se leen los chats.
      if (!enHorario(ahora, config.horario)) continue;
      try {
        const r = await vigilarNegocio(workspaceId, config, ahora);
        total.negocios += 1;
        total.avisos += r.avisos;
        total.reasignaciones += r.reasignaciones;
      } catch (error) {
        console.error("[supervisor-reasignacion]", workspaceId, error instanceof Error ? error.message : error);
      }
    }
  } catch (error) {
    console.error("[supervisor-reasignacion]", error instanceof Error ? error.message : error);
  } finally {
    corriendo = false;
  }
  return total;
}

type DatosDelChat = { numero: number | null; channelId: string | null; contactId: string | null };

async function datosDeLosChats(workspaceId: string, ids: string[]): Promise<Map<string, DatosDelChat>> {
  if (!ids.length) return new Map();
  const filas = await prisma.conversation.findMany({
    where: { workspaceId, id: { in: ids } },
    select: { id: true, numero: true, channelId: true, contactId: true },
  });
  return new Map(filas.map((f) => [f.id, { numero: f.numero ?? null, channelId: f.channelId ?? null, contactId: f.contactId ?? null }]));
}

/** Por línea de ventas: las asesoras que HOY pueden recibir un chat (activas, en horario de reparto y sin pausa a mano). */
async function candidatasPorLinea(workspaceId: string, channelIds: string[], ahora: Date): Promise<Map<string, string[]>> {
  const salida = new Map<string, string[]>();
  if (!channelIds.length) return salida;
  const canales = await prisma.whatsAppChannel.findMany({ where: { workspaceId, id: { in: channelIds } }, select: { id: true, metadata: true } });
  const delCanal = new Map(canales.map((c) => [c.id, calcularReparto(c.metadata)]));
  const todos = [...new Set([...delCanal.values()].flat())];
  if (!todos.length) return salida;
  const activos = await prisma.workspaceMember.findMany({ where: { workspaceId, isActive: true, userId: { in: todos } }, select: { userId: true } });
  const activosSet = new Set(activos.map((m) => m.userId));
  const enHorarioDeReparto = new Set(await filtrarPorHorario(workspaceId, todos.filter((id) => activosSet.has(id)), ahora));
  const sinPausa = await filtrarSinPausaManual(workspaceId, [...enHorarioDeReparto], ahora);
  for (const [canalId, ids] of delCanal) salida.set(canalId, ids.filter((id) => enHorarioDeReparto.has(id) && sinPausa.has(id)));
  return salida;
}

async function leerAnotados(workspaceId: string, ids: string[], ahora: Date): Promise<Anotados> {
  const mapa: Anotados = new Map();
  if (!ids.length) return mapa;
  const filas = await prisma.supervisorAviso.findMany({
    where: { workspaceId, conversationId: { in: ids }, creadoEn: { gte: new Date(ahora.getTime() - VENTANA_DE_ANOTADOS_MS) } },
    select: { conversationId: true, tipo: true, episodio: true, creadoEn: true },
  });
  for (const f of filas) mapa.set(claveDeAviso(f.conversationId, f.tipo as TipoDeAviso, new Date(f.episodio)), new Date(f.creadoEn));
  return mapa;
}

/** Anota el aviso. null = no se pudo (ya estaba anotado o falló): en ese caso NO se manda ni se mueve nada. */
async function anotar(workspaceId: string, d: Decision, extra: { error?: string } = {}): Promise<string | null> {
  try {
    const fila = await prisma.supervisorAviso.create({
      data: {
        workspaceId,
        conversationId: d.chat.conversationId,
        tipo: d.tipo,
        asesoraId: d.asesoraId,
        asesoraNuevaId: d.asesoraNuevaId ?? null,
        episodio: d.episodio,
        minutosEsperando: d.minutos,
        error: extra.error ?? null,
      },
      select: { id: true },
    });
    return fila.id;
  } catch (error) {
    if ((error as { code?: string })?.code !== "P2002") {
      console.warn("[supervisor-reasignacion] no se pudo anotar", error instanceof Error ? error.message : error);
    }
    return null;
  }
}

type Linea = { userId: string; texto: string; filaId: string; principal: boolean };

/** Manda un WhatsApp a una persona del equipo por la línea administrativa. Nunca a un cliente. */
async function enviarAlEquipo(
  workspaceId: string,
  userId: string,
  texto: string,
  linea: { instancia: string | null; error: string | null },
): Promise<{ ok: boolean; error?: string }> {
  if (!linea.instancia) return { ok: false, error: linea.error ?? "sin línea de avisos" };
  const numero = await numeroDeAvisosDeLaPersona(workspaceId, userId).catch(() => null);
  if (!numero) return { ok: false, error: "sin número de avisos en Equipo" };
  try {
    await sendEvolutionTextMessageWithReconnect({ instanceName: linea.instancia, phoneNumber: numero, text: texto });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `WhatsApp falló: ${(error instanceof Error ? error.message : String(error)).slice(0, 160)}` };
  }
}

async function lineaDeAvisos(workspaceId: string, config: ConfigReasignacion): Promise<{ instancia: string | null; error: string | null }> {
  const canal = await prisma.whatsAppChannel
    .findFirst({ where: { id: config.canalId, workspaceId }, select: { purpose: true, evolutionInstanceName: true } })
    .catch(() => null);
  if (!canal?.evolutionInstanceName) return { instancia: null, error: "la línea de avisos no existe" };
  if (canal.purpose !== "ADMIN") return { instancia: null, error: "la línea de avisos no es administrativa" };
  return { instancia: canal.evolutionInstanceName, error: null };
}

async function vigilarNegocio(workspaceId: string, config: ConfigReasignacion, ahora: Date): Promise<{ avisos: number; reasignaciones: number }> {
  const chats = await leerChatsAbiertos({ workspaceId, ahora });
  if (!chats.length) return { avisos: 0, reasignaciones: 0 };
  const ids = chats.map((c) => c.conversationId);
  const [anotados, datos, nombres] = await Promise.all([leerAnotados(workspaceId, ids, ahora), datosDeLosChats(workspaceId, ids), nombresDeAsesoras(workspaceId).catch(() => ({}) as Record<string, string>)]);
  const canales = [...new Set([...datos.values()].map((d) => d.channelId).filter((c): c is string => Boolean(c)))];
  const candidatas = await candidatasPorLinea(workspaceId, canales, ahora);

  const decisiones = decidir({
    chats,
    ahora,
    config,
    anotados,
    candidatasDe: (chat) => candidatas.get(datos.get(chat.conversationId)?.channelId ?? "") ?? [],
  });
  if (!decisiones.length) return { avisos: 0, reasignaciones: 0 };

  const nombreDe = (id: string | undefined) => (id && nombres[id]) || "otra asesora";
  const enlaceDe = (chat: ChatAbierto) => enlaceDelChat(datos.get(chat.conversationId)?.numero, chat.conversationId);
  const lineas: Linea[] = [];
  const paraElDueno: string[] = [];
  let avisos = 0;
  let reasignaciones = 0;

  for (const d of decisiones) {
    const enlace = enlaceDe(d.chat);
    if (d.tipo === "SIN_CANDIDATA" || d.tipo === "ESCALADA_DUENO") {
      const id = await anotar(workspaceId, d, { error: d.tipo === "SIN_CANDIDATA" ? "no hay otra asesora disponible" : "la nueva asesora tampoco contestó" });
      if (!id) continue;
      paraElDueno.push(lineaDeAviso({ tipo: d.tipo, chat: d.chat, minutos: d.minutos, enlace, otra: nombreDe(d.asesoraId) }));
      continue;
    }
    if (d.tipo === "REASIGNACION") {
      const nueva = d.asesoraNuevaId as string;
      const id = await anotar(workspaceId, d);
      if (!id) continue;
      const dato = datos.get(d.chat.conversationId);
      // Nadie escribió mientras tanto: si la asesora acaba de contestar, el chat no se mueve.
      const contesto = await prisma.message.findFirst({
        where: {
          conversationId: d.chat.conversationId,
          direction: "OUTBOUND",
          type: { not: "SYSTEM" },
          createdAt: { gt: d.episodio },
          OR: [{ rawPayload: { path: ["source"], equals: "manual" } }, { rawPayload: { path: ["source"], equals: "instance" } }],
        },
        select: { id: true },
      });
      const movido = contesto
        ? { count: 0 }
        : await prisma.conversation.updateMany({
            where: { id: d.chat.conversationId, workspaceId, assignedToUserId: d.asesoraId, status: "OPEN" },
            data: { assignedToUserId: nueva },
          });
      if (movido.count !== 1) {
        await prisma.supervisorAviso.update({ where: { id }, data: { error: contesto ? "la asesora contestó justo antes: no se movió" : "el chat ya había cambiado: no se movió" } }).catch(() => {});
        continue;
      }
      reasignaciones += 1;
      await recordConversationActivity({
        workspaceId,
        conversationId: d.chat.conversationId,
        channelId: dato?.channelId ?? null,
        contactId: dato?.contactId ?? null,
        kind: "assigned",
        actorUserId: null,
        assigneeUserId: nueva,
        origen: "supervisor-reasignacion",
        text: `Asignado por el Supervisor a ${nombreDe(nueva)} (${nombreDe(d.asesoraId)} llevaba ${d.minutos} min sin responder)`,
      });
      await notifyRealtimeUpdate({ workspaceId, conversationId: d.chat.conversationId, type: "conversation-assigned" });
      lineas.push({ userId: nueva, filaId: id, principal: true, texto: lineaDeAviso({ tipo: "REASIGNACION", chat: d.chat, minutos: d.minutos, enlace, otra: nombreDe(d.asesoraId) }) });
      lineas.push({ userId: d.asesoraId, filaId: id, principal: false, texto: lineaDeAviso({ tipo: "REASIGNACION", chat: d.chat, minutos: d.minutos, enlace, otra: nombreDe(nueva), paraLaAnterior: true }) });
      continue;
    }
    // AVISO, BOT_PIDIO_ASESORA, CALIENTE_24H
    const id = await anotar(workspaceId, d);
    if (!id) continue;
    avisos += 1;
    lineas.push({ userId: d.asesoraId, filaId: id, principal: true, texto: lineaDeAviso({ tipo: d.tipo, chat: d.chat, minutos: d.minutos, enlace }) });
  }

  // UN mensaje por persona y por vuelta.
  const linea = lineas.length ? await lineaDeAvisos(workspaceId, config) : { instancia: null, error: null };
  const porPersona = new Map<string, Linea[]>();
  for (const l of lineas) porPersona.set(l.userId, [...(porPersona.get(l.userId) ?? []), l]);
  for (const [userId, suyas] of porPersona) {
    const resultado = await enviarAlEquipo(workspaceId, userId, armarMensaje(suyas.map((l) => l.texto)), linea);
    const principales = suyas.filter((l) => l.principal).map((l) => l.filaId);
    if (principales.length) {
      await prisma.supervisorAviso
        .updateMany({ where: { id: { in: principales } }, data: { whatsappEnviado: resultado.ok, error: resultado.ok ? null : (resultado.error ?? "no salió") } })
        .catch(() => {});
    }
    if (!resultado.ok) {
      // Las que no son principales (la asesora anterior de una reasignación) solo dejan la nota del fallo.
      for (const l of suyas.filter((x) => !x.principal)) {
        await prisma.supervisorAviso.updateMany({ where: { id: l.filaId, error: null }, data: { error: `aviso a la anterior: ${resultado.error ?? "no salió"}` } }).catch(() => {});
      }
      // Sin WhatsApp, al menos la notificación al teléfono.
      await sendPushToUser({
        userId,
        payload: { title: "Chat esperando respuesta", body: `${suyas.length} chat(s) del Supervisor: abre Mi día.`, tag: `reasignacion:${userId}`, url: "/cliente/crm/mi-dia" },
      }).catch(() => 0);
    }
  }

  if (paraElDueno.length) {
    const gravedad = await leerConfigGravedad(workspaceId).catch(() => CONFIG_GRAVEDAD_POR_DEFECTO);
    await pushAAlexander(workspaceId, gravedad, {
      title: "Supervisor: chat sin quién lo atienda",
      body: paraElDueno.join("\n").slice(0, 180),
      tag: `reasignacion:dueno:${ahora.getTime()}`,
      url: "/cliente/crm/supervisor",
    }).catch(() => 0);
  }
  return { avisos, reasignaciones };
}
