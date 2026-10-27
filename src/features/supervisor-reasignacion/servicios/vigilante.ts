import { Prisma } from "@prisma/client";

import { recordConversationActivity } from "@/lib/conversation-activity";
import { prisma } from "@/lib/prisma";
import { notifyRealtimeUpdate } from "@/lib/realtime-notify";
import { calcularReparto } from "@/lib/channel-collaborators";
import { filtrarSinPausaManual } from "@/lib/en-linea";
import { filtrarPorHorario } from "@/lib/horario-de-reparto";
import { avisarAsignacionPorPush } from "@/lib/reparto-de-leads";
import { sendPushToUser } from "@/lib/web-push";
import { turnoDeLaConversacion } from "@/lib/turno-de-la-conversacion";

import { leerConfigGravedad, pushAAlexander, whatsAppAPersonaDelEquipo } from "@/features/avisos-gravedad/servicios/enrutador";
import { estadoDeEspera } from "@/features/supervisor/dominio/detectores-atencion";
import { motivoDeExclusion } from "@/features/supervisor/dominio/exclusiones";
import { leerChatsAbiertos } from "@/features/supervisor/servicios/datos";

import {
  CANAL_ADMIN_POR_DEFECTO,
  DOMINIO_APP,
  clienteLegible,
  decidir,
  enHorarioLaboral,
  llaveDeAviso,
  textoDeAvisos,
  textoReasignacionAnterior,
  textoReasignacionNueva,
  type ChatVigilado,
  type ConfigReasignacion,
  type Decision,
} from "../dominio/reglas";
import { leerConfigReasignacion, negociosConReasignacion } from "./config";

/**
 * EL VIGILANTE DEL SUPERVISOR DE REASIGNACIÓN (servicio). Las reglas están en ../dominio/reglas.ts.
 *
 * Lo llama el reloj de /api/cron/follows en cada vuelta (cada minuto). Sin ajuste, o con los dos
 * interruptores apagados, no hace nada. Fuera del horario laboral sale sin leer un solo chat.
 *
 * Nunca le escribe al cliente: los WhatsApp salen por la línea administrativa a los números del
 * equipo. Cada aviso se ANOTA antes de mandarse (SupervisorAviso, único por chat + tipo + episodio):
 * si no se pudo anotar, no se manda, y así dos vueltas seguidas nunca repiten el mismo aviso.
 */

let corriendo = false;

export type ResultadoDeVuelta = { negocios: number; avisos: number; reasignados: number; sinCandidata: number };

export async function vueltaDeReasignacion(ahora = new Date()): Promise<ResultadoDeVuelta> {
  const total: ResultadoDeVuelta = { negocios: 0, avisos: 0, reasignados: 0, sinCandidata: 0 };
  if (corriendo) return total;
  corriendo = true;
  try {
    for (const { workspaceId } of await negociosConReasignacion()) {
      try {
        const config = await leerConfigReasignacion(workspaceId);
        if (!enHorarioLaboral(ahora, config.horario)) continue;
        const r = await vigilarNegocio(workspaceId, config, ahora);
        total.negocios += 1;
        total.avisos += r.avisos;
        total.reasignados += r.reasignados;
        total.sinCandidata += r.sinCandidata;
      } catch (error) {
        console.error("[supervisor-reasignacion]", workspaceId, error instanceof Error ? error.message : error);
      }
    }
    return total;
  } finally {
    corriendo = false;
  }
}

/* ------------------------------------------------------------------------------------------------
   LECTURA
------------------------------------------------------------------------------------------------ */

async function primerosPendientes(ids: string[], ahora: Date): Promise<Map<string, Date>> {
  if (!ids.length) return new Map();
  const desde = new Date(ahora.getTime() - 7 * 86_400_000);
  const filas = await prisma.$queryRaw<Array<{ id: string; desde: Date }>>(Prisma.sql`
    SELECT m."conversationId" AS "id", min(m."createdAt") AS "desde"
      FROM "Message" m
     WHERE m."conversationId" IN (${Prisma.join(ids)})
       AND m."direction" = 'INBOUND' AND m."type"::text <> 'SYSTEM'
       AND m."createdAt" >= ${desde}
       AND m."createdAt" > COALESCE((
         SELECT max(h."createdAt") FROM "Message" h
          WHERE h."conversationId" = m."conversationId" AND h."direction" = 'OUTBOUND' AND h."type"::text <> 'SYSTEM'
            AND h."rawPayload"->>'source' IN ('manual', 'instance')), '-infinity'::timestamp)
     GROUP BY m."conversationId"`);
  return new Map(filas.map((f) => [f.id, new Date(f.desde)]));
}

/** Asesoras que pueden recibir un chat: de las líneas del V3, activas, en su horario y sin pausa a mano. */
async function asesorasQuePuedenRecibir(workspaceId: string, ahora: Date): Promise<string[]> {
  const canales = await prisma.whatsAppChannel.findMany({
    where: { workspaceId, metadata: { path: ["agenteV3"], equals: true } },
    select: { metadata: true },
  });
  const ruedas = [...new Set(canales.flatMap((canal) => calcularReparto(canal.metadata)))];
  if (!ruedas.length) return [];
  const miembros = await prisma.workspaceMember.findMany({
    where: { workspaceId, isActive: true, userId: { in: ruedas } },
    select: { userId: true },
  });
  const activas = miembros.map((m) => m.userId);
  const enHorario = await filtrarPorHorario(workspaceId, activas, ahora);
  const sinPausa = await filtrarSinPausaManual(workspaceId, enHorario, ahora);
  return enHorario.filter((id) => sinPausa.has(id));
}

async function chatsVigilados(workspaceId: string, ahora: Date, config: ConfigReasignacion): Promise<ChatVigilado[]> {
  const abiertos = await leerChatsAbiertos({ workspaceId, ahora });
  const base = abiertos.flatMap((chat) => {
    // Sin asesora, lo del reparto y el rescate de huérfanos; no es de este vigilante.
    if (!chat.asesoraId) return [];
    // Los mismos filtros del Supervisor: cerrados, robots, ocultos, del exterior, dormidos.
    // Sin las respuestas humanas: un Caliente callado por la asesora sí cuenta.
    const excluido = motivoDeExclusion(
      {
        etapa: chat.etapa,
        telefono: chat.telefono,
        esLid: chat.esLid,
        telefonoDescubierto: chat.telefonoDescubierto,
        metadata: chat.metadata,
        dormidoHasta: chat.dormidoHasta,
        ocultoDelCrm: chat.ocultoDelCrm,
        automatico: chat.automatico,
        textos: chat.textosDelCliente,
      },
      ahora,
    );
    if (excluido) return [];
    const estado = estadoDeEspera(chat, ahora, config.horario);
    const esperando = estado.esperando && !estado.cierre;
    return [{ chat, estado, esperando }];
  });
  const pendientes = await primerosPendientes(
    base.filter((b) => b.esperando).map((b) => b.chat.conversationId),
    ahora,
  );
  const numeros = base.length
    ? await prisma.conversation.findMany({ where: { workspaceId, id: { in: base.map((b) => b.chat.conversationId) } }, select: { id: true, numero: true } })
    : [];
  const numeroDe = new Map(numeros.map((n) => [n.id, n.numero]));
  return base.map(({ chat, estado, esperando }) => ({
    conversationId: chat.conversationId,
    numero: numeroDe.get(chat.conversationId) ?? null,
    asesoraId: chat.asesoraId,
    etapa: chat.etapa,
    caliente: estado.caliente,
    nombre: chat.nombreCliente ?? null,
    telefono: chat.telefono ?? null,
    esperando,
    botPidioAsesora: esperando && turnoDeLaConversacion(chat.mensajes ?? [], { caliente: estado.caliente, asignada: true }).motivo === "bot_pidio_asesora",
    primerPendienteEn: esperando ? (pendientes.get(chat.conversationId) ?? chat.ultimoClienteEn ?? null) : null,
    asignadaEn: chat.asignadaEn ?? null,
    ultimaRespuestaHumanaEn: chat.ultimaRespuestaHumanaEn ?? null,
  }));
}

/* ------------------------------------------------------------------------------------------------
   ACCIÓN
------------------------------------------------------------------------------------------------ */

type Anotado = { id: string; decision: Decision };

/** Anota el aviso. Si ya estaba anotado (o no se pudo anotar) devuelve null y NO se manda nada. */
async function anotar(workspaceId: string, d: Decision): Promise<Anotado | null> {
  try {
    const fila = await prisma.supervisorAviso.create({
      data: {
        workspaceId,
        conversationId: d.chat.conversationId,
        tipo: d.tipo,
        asesoraId: d.asesoraId,
        asesoraNuevaId: d.tipo === "REASIGNACION" ? d.asesoraNuevaId : null,
        episodio: d.episodio,
        minutosEsperando: d.minutos,
      },
      select: { id: true },
    });
    return { id: fila.id, decision: d };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
      console.warn("[supervisor-reasignacion] no se pudo anotar el aviso", error instanceof Error ? error.message : error);
    }
    return null;
  }
}

async function cerrarFila(id: string, enviado: boolean, error?: string | null) {
  await prisma.supervisorAviso.update({ where: { id }, data: { whatsappEnviado: enviado, error: error ?? null } }).catch(() => {});
}

async function nombresDe(ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids)].filter(Boolean);
  const usuarios = unicos.length ? await prisma.user.findMany({ where: { id: { in: unicos } }, select: { id: true, name: true, email: true } }) : [];
  return new Map(usuarios.map((u) => [u.id, u.name?.trim() || u.email || "una asesora"]));
}

async function vigilarNegocio(workspaceId: string, config: ConfigReasignacion, ahora: Date): Promise<Omit<ResultadoDeVuelta, "negocios">> {
  const resultado = { avisos: 0, reasignados: 0, sinCandidata: 0 };
  const chats = await chatsVigilados(workspaceId, ahora, config);
  if (!chats.length) return resultado;

  const ids = chats.filter((c) => c.esperando || c.caliente).map((c) => c.conversationId);
  const anotados = ids.length ? await prisma.supervisorAviso.findMany({ where: { workspaceId, conversationId: { in: ids } }, select: { conversationId: true, tipo: true, episodio: true } }) : [];
  const registrados = new Set(anotados.map((a) => llaveDeAviso(a.conversationId, a.tipo as never, a.episodio)));
  const candidatas = config.reasignacionActiva ? await asesorasQuePuedenRecibir(workspaceId, ahora) : [];

  const decisiones = decidir({ chats, ahora, config, candidatas, registrados });
  if (!decisiones.length) return resultado;

  const canalId = config.canalId ?? CANAL_ADMIN_POR_DEFECTO;
  const nombres = await nombresDe(decisiones.flatMap((d) => [d.asesoraId, d.tipo === "REASIGNACION" ? d.asesoraNuevaId : ""]));

  // 1) Avisos: UN mensaje por asesora, aunque tenga varios chats esperando.
  const porAsesora = new Map<string, Anotado[]>();
  for (const d of decisiones) {
    if (d.tipo !== "AVISO" && d.tipo !== "BOT_PIDIO_ASESORA" && d.tipo !== "CALIENTE_24H") continue;
    const nota = await anotar(workspaceId, d);
    if (nota) porAsesora.set(d.asesoraId, [...(porAsesora.get(d.asesoraId) ?? []), nota]);
  }
  for (const [asesoraId, notas] of porAsesora) {
    const texto = textoDeAvisos(notas.map((n) => n.decision));
    const envio = await whatsAppAPersonaDelEquipo({ workspaceId, userId: asesoraId, texto, canalId });
    for (const n of notas) await cerrarFila(n.id, envio.ok, envio.ok ? null : envio.motivo);
    if (!envio.ok) {
      // Sin WhatsApp (sin número, línea caída) le llega al menos la notificación al teléfono.
      await sendPushToUser({
        userId: asesoraId,
        payload: {
          title: notas.length === 1 ? "⏰ Cliente esperando respuesta" : `⏰ ${notas.length} clientes esperando`,
          body: notas.map((n) => clienteLegible(n.decision.chat)).slice(0, 4).join(", "),
          tag: `reasignacion:aviso:${asesoraId}`,
          url: notas.length === 1 ? `/cliente/chats?chatKey=agent:${notas[0].decision.chat.conversationId}&assigned=all` : "/cliente/crm/mi-dia",
        },
      }).catch(() => 0);
    }
    resultado.avisos += notas.length;
  }

  // 2) Reasignaciones y chats sin quién los reciba.
  for (const d of decisiones) {
    if (d.tipo === "REASIGNACION") {
      const nota = await anotar(workspaceId, d);
      if (!nota) continue;
      if (await reasignar(workspaceId, nota, d, nombres, canalId)) resultado.reasignados += 1;
    } else if (d.tipo === "SIN_CANDIDATA") {
      const nota = await anotar(workspaceId, d);
      if (!nota) continue;
      resultado.sinCandidata += 1;
      const gravedad = await leerConfigGravedad(workspaceId).catch(() => null);
      const enviados = gravedad
        ? await pushAAlexander(workspaceId, gravedad, {
            title: "⚠️ Chat sin quién lo reciba",
            body: `${clienteLegible(d.chat)} lleva ${d.minutos} min sin respuesta de ${nombres.get(d.asesoraId) ?? "su asesora"} y no hay otra asesora activa.`,
            tag: `reasignacion:sin-candidata:${d.chat.conversationId}`,
            url: d.chat.numero ? `${DOMINIO_APP}/c/${d.chat.numero}` : "/cliente/direccion/supervisor",
          }).catch(() => 0)
        : 0;
      await cerrarFila(nota.id, false, enviados > 0 ? "no hay otra asesora activa; se avisó al dueño" : "no hay otra asesora activa");
    }
  }
  return resultado;
}

/** Pasa el chat de la asesora que no contestó a la nueva. Devuelve true si se movió. */
async function reasignar(
  workspaceId: string,
  nota: Anotado,
  d: Extract<Decision, { tipo: "REASIGNACION" }>,
  nombres: Map<string, string>,
  canalId: string,
): Promise<boolean> {
  const conversationId = d.chat.conversationId;
  // Si ella acaba de escribir, no se mueve (puede pasar entre la lectura y este momento).
  const respondio = await prisma.message.findFirst({
    where: {
      conversationId,
      direction: "OUTBOUND",
      type: { not: "SYSTEM" },
      createdAt: { gt: d.episodio },
      OR: [{ rawPayload: { path: ["source"], equals: "manual" } }, { rawPayload: { path: ["source"], equals: "instance" } }],
    },
    select: { id: true },
  });
  if (respondio) {
    await cerrarFila(nota.id, false, "la asesora respondió antes de moverlo; no se reasignó");
    return false;
  }
  // Solo si el chat SIGUE siendo de la asesora anterior y abierto.
  const movido = await prisma.conversation.updateMany({
    where: { id: conversationId, workspaceId, assignedToUserId: d.asesoraId, status: "OPEN" },
    data: { assignedToUserId: d.asesoraNuevaId },
  });
  if (movido.count === 0) {
    await cerrarFila(nota.id, false, "el chat ya había cambiado de asesora; no se reasignó");
    return false;
  }
  const anterior = nombres.get(d.asesoraId) ?? "La asesora anterior";
  const nueva = nombres.get(d.asesoraNuevaId) ?? "otra asesora";
  await recordConversationActivity({
    workspaceId,
    conversationId,
    kind: "assigned",
    assigneeUserId: d.asesoraNuevaId,
    origen: "supervisor-reasignacion",
    text: `${nueva} asignado por el Supervisor (${anterior} no respondió en ${d.minutos} min)`,
  });
  void notifyRealtimeUpdate({ workspaceId, conversationId, type: "chat-estado", data: { source: "supervisor-reasignacion" } });
  void avisarAsignacionPorPush({ conversationId, userId: d.asesoraNuevaId });

  const [aNueva, aAnterior] = await Promise.all([
    whatsAppAPersonaDelEquipo({ workspaceId, userId: d.asesoraNuevaId, texto: textoReasignacionNueva(d, anterior), canalId }),
    whatsAppAPersonaDelEquipo({ workspaceId, userId: d.asesoraId, texto: textoReasignacionAnterior(d, nueva), canalId }),
  ]);
  const fallas = [aNueva.ok ? null : `a la nueva: ${aNueva.motivo}`, aAnterior.ok ? null : `a la anterior: ${aAnterior.motivo}`].filter(Boolean);
  await cerrarFila(nota.id, aNueva.ok && aAnterior.ok, fallas.length ? fallas.join("; ") : null);
  return true;
}
