import { registrarCambioDeEtapa } from "@/lib/historial-etapa";
import { Prisma } from "@prisma/client";

import { avisoSiNoSePuedeDescartar } from "@/features/crm/services/candado-descarte-sin-respuesta";
import { registrarEventos } from "@/features/embudo/servicios/eventos";
import { cancelarAutomaticosPendientesDelContacto } from "@/features/seguimientos/services/follows";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { SQL_CHAT_ABIERTO } from "@/lib/chat-resuelto-sql";
import { prisma } from "@/lib/prisma";
import { resolveCallablePhone } from "@/lib/whatsapp-lid";

import type { ConfigSeguimientoInteligente } from "../dominio/config";
import { FASE_ATENDIDA_POR_AUTOMATIZACION, MOTIVO_RECUPERACION, eventosDeCierrePorAutomatizacion } from "../dominio/recuperacion";
import { nombreDeFamilia } from "../dominio/producto";
import { leerConfigSeguimiento } from "./config";
import { corteDeLaConfig, filtroSinReactivar } from "./reactivacion";

/**
 * RECUPERACIÓN 72 HORAS: lo que necesita la base (la regla está en dominio/recuperacion.ts).
 *
 *  - El descarte (PERDIDO "sin_respuesta", la misma puerta y candado que el descarte del CRM), con
 *    nota a la vista, cancelación de los automáticos pendientes y evento para deshacer.
 *  - Aprobar / no aprobar el descarte de un lead con intención fuerte (la supervisora).
 *  - Deshacer un descarte (vuelve a la etapa anterior y esa recuperación ya no descarta).
 *  - Las listas de Mi día y el resumen del Supervisor. Solo modo ACTIVO aparece a las asesoras.
 * Nada de esto le escribe al cliente.
 */

export const MOTIVO_DESCARTE = "sin_respuesta";
export const ETIQUETA_DESCARTE = "Descartado — Sin respuesta";

function anotarError(donde: string, error: unknown, extra: Record<string, unknown> = {}) {
  console.warn(`[recuperacion-72h] ${donde}`, { ...extra, error: error instanceof Error ? error.message : String(error) });
}

function horaCorta(iso: unknown): string {
  if (typeof iso !== "string") return "—";
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? "—" : fecha.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" });
}

type Charla = { workspaceId: string; conversationId: string; contactId: string; channelId: string | null };

/**
 * PERDIDO "sin_respuesta" por la Recuperación. `aprobadoPor` = la supervisora (intención fuerte).
 * Devuelve null si descartó, o el motivo por el que no (candado, ya cerrado…).
 */
export async function descartarPorRecuperacion(
  charla: Charla,
  recuperacion: Record<string, unknown> | null | undefined,
  opciones: { aprobadoPor?: { id: string; nombre: string } | null; ahora?: Date } = {},
): Promise<string | null> {
  const ahora = opciones.ahora ?? new Date();
  const aviso = await avisoSiNoSePuedeDescartar({ contactId: charla.contactId, lostReason: MOTIVO_DESCARTE }).catch(
    (error) => `no se pudo revisar el candado: ${error instanceof Error ? error.message : String(error)}`,
  );
  if (aviso) return aviso;
  const antes = await prisma.contact.findUnique({ where: { id: charla.contactId }, select: { crmStage: true, lostReason: true } });
  if (!antes) return "el contacto no existe";
  const movidos = await prisma.$executeRaw(Prisma.sql`
    UPDATE "Contact"
    SET "crmStage" = 'PERDIDO', "lostReason" = ${MOTIVO_DESCARTE}, "wonAt" = NULL, "wonQuoteRef" = NULL, "updatedAt" = NOW()
    WHERE "id" = ${charla.contactId} AND "crmStage"::text NOT IN ('GANADO', 'PERDIDO')
  `);
  if (movidos === 0) return "ya estaba cerrado (Ganado o Perdido)";
  await registrarCambioDeEtapa({
    workspaceId: charla.workspaceId,
    contactId: charla.contactId,
    conversationId: charla.conversationId,
    etapaAnterior: antes.crmStage,
    etapaNueva: "PERDIDO",
    origen: opciones.aprobadoPor ? "ASESORA" : "AUTOMATICO",
    quien: opciones.aprobadoPor?.id ?? null,
    nota: "descarte por Recuperación 72 h",
  });
  const r = recuperacion ?? {};
  const texto = opciones.aprobadoPor
    ? `${ETIQUETA_DESCARTE} (Recuperación 72 h, aprobado por ${opciones.aprobadoPor.nombre}): último intento sin respuesta (llamada ${horaCorta(r.llamadaEn)}, audio ${horaCorta(r.audioEn)}).`
    : `${ETIQUETA_DESCARTE} (Recuperación 72 h): llamada ${horaCorta(r.llamadaEn)} sin contestar, audio ${horaCorta(r.audioEn)} y 24 h sin respuesta.`;
  await recordConversationActivity({
    workspaceId: charla.workspaceId,
    conversationId: charla.conversationId,
    channelId: charla.channelId,
    contactId: charla.contactId,
    kind: "stage_changed",
    actorUserId: opciones.aprobadoPor?.id ?? null,
    origen: "recuperacion-72h",
    text: texto,
  }).catch((error) => anotarError("no se pudo dejar la nota del descarte", error));
  await cancelarAutomaticosPendientesDelContacto({ workspaceId: charla.workspaceId, contactId: charla.contactId, motivo: "etapa_cerrada" });
  await registrarEventos(charla, [
    {
      tipo: "DESCARTE_CADENCIA",
      origen: opciones.aprobadoPor ? "asesora" : "motor",
      claveUnica: `DESCARTE-REC:${charla.conversationId}:${typeof r.entradaEn === "string" ? r.entradaEn.slice(0, 16) : ahora.toISOString().slice(0, 10)}`,
      createdAt: ahora,
      datos: {
        modo: "activo",
        motivo: MOTIVO_RECUPERACION,
        etapaAnterior: antes.crmStage,
        motivoAnterior: antes.lostReason,
        aprobadoPor: opciones.aprobadoPor?.id ?? null,
        recuperacion: r,
      },
    },
    {
      tipo: "RECUPERACION_72H",
      origen: opciones.aprobadoPor ? "asesora" : "motor",
      claveUnica: `REC:activo:${charla.conversationId}:${typeof r.entradaEn === "string" ? r.entradaEn.slice(0, 16) : ""}:descartado`,
      createdAt: ahora,
      datos: { modo: "activo", fase: "descartado", aprobadoPor: opciones.aprobadoPor?.id ?? null, ...r },
    },
  ]);
  return null;
}

async function charlaDe(workspaceId: string, conversationId: string): Promise<Charla | null> {
  const c = await prisma.conversation.findFirst({ where: { id: conversationId, workspaceId }, select: { contactId: true, channelId: true } });
  return c ? { workspaceId, conversationId, contactId: c.contactId, channelId: c.channelId } : null;
}

/** Quién aprueba los descartes de intención fuerte: el de la config o la supervisora del Supervisor accionable. */
export async function aprobadorDeRecuperacion(workspaceId: string, config: ConfigSeguimientoInteligente): Promise<string | null> {
  if (config.recuperacion72h.aprobadorId) return config.recuperacion72h.aprobadorId;
  // La supervisora del Supervisor accionable (`supervisor:accionable:<ws>`.supervisoraId), leída directo.
  const fila = await prisma.appSetting.findUnique({ where: { key: `supervisor:accionable:${workspaceId}` } }).catch(() => null);
  try {
    const valor = fila?.value ? (JSON.parse(fila.value) as { supervisoraId?: unknown }) : null;
    return typeof valor?.supervisoraId === "string" && valor.supervisoraId ? valor.supervisoraId : null;
  } catch {
    return null;
  }
}

/** La supervisora aprueba (o no) el descarte de un lead con intención fuerte. */
export async function resolverAprobacion(input: {
  workspaceId: string;
  conversationId: string;
  usuario: { id: string; nombre: string };
  aprobar: boolean;
  ahora?: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ahora = input.ahora ?? new Date();
  const lead = await prisma.embudoLead.findFirst({ where: { conversationId: input.conversationId, workspaceId: input.workspaceId }, select: { accionDatos: true } });
  const datos = (lead?.accionDatos ?? {}) as Record<string, unknown>;
  const recuperacion = (datos.recuperacion && typeof datos.recuperacion === "object" ? datos.recuperacion : {}) as Record<string, unknown>;
  if (datos.motivo !== MOTIVO_RECUPERACION || !recuperacion.fuerte || !(datos.toque === "aprobacion" || datos.toque === "llamar_2")) {
    return { ok: false, error: "Este chat ya no está pendiente de aprobación." };
  }
  const charla = await charlaDe(input.workspaceId, input.conversationId);
  if (!charla) return { ok: false, error: "No se encontró el chat." };
  if (input.aprobar) {
    const motivo = await descartarPorRecuperacion(charla, recuperacion, { aprobadoPor: input.usuario, ahora });
    return motivo ? { ok: false, error: `No se descartó: ${motivo}` } : { ok: true };
  }
  await registrarEventos(charla, [
    {
      tipo: "RECUPERACION_72H",
      origen: "asesora",
      claveUnica: `REC:activo:${input.conversationId}:${typeof recuperacion.entradaEn === "string" ? recuperacion.entradaEn.slice(0, 16) : ""}:mantener`,
      createdAt: ahora,
      datos: { modo: "activo", fase: "mantener", por: input.usuario.id, ...recuperacion },
    },
  ]);
  await recordConversationActivity({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    channelId: charla.channelId,
    contactId: charla.contactId,
    kind: "note",
    actorUserId: input.usuario.id,
    origen: "recuperacion-72h",
    text: `Recuperación 72 h: ${input.usuario.nombre} decidió NO descartar (intención fuerte). Sigue abierto.`,
  }).catch(() => undefined);
  return { ok: true };
}

/** Deshace el descarte de la Recuperación: vuelve a la etapa anterior y esa recuperación ya no descarta. */
export async function deshacerDescarte(input: {
  workspaceId: string;
  conversationId: string;
  usuario: { id: string; nombre: string };
  ahora?: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ahora = input.ahora ?? new Date();
  const evento = await prisma.embudoEvento.findFirst({
    where: { conversationId: input.conversationId, workspaceId: input.workspaceId, tipo: "DESCARTE_CADENCIA", datos: { path: ["motivo"], equals: MOTIVO_RECUPERACION } },
    orderBy: { createdAt: "desc" },
    select: { datos: true },
  });
  const datos = (evento?.datos ?? {}) as Record<string, unknown>;
  if (!evento) return { ok: false, error: "No hay un descarte de la Recuperación 72 h en este chat." };
  const charla = await charlaDe(input.workspaceId, input.conversationId);
  if (!charla) return { ok: false, error: "No se encontró el chat." };
  const etapa = typeof datos.etapaAnterior === "string" && datos.etapaAnterior !== "PERDIDO" ? datos.etapaAnterior : "CALIFICADO";
  const movidos = await prisma.$executeRaw(Prisma.sql`
    UPDATE "Contact"
    SET "crmStage" = ${etapa}::"CrmStage", "lostReason" = NULL, "updatedAt" = NOW()
    WHERE "id" = ${charla.contactId} AND "crmStage"::text = 'PERDIDO' AND "lostReason" = ${MOTIVO_DESCARTE}
  `);
  if (movidos === 0) return { ok: false, error: "El contacto ya no está en Descartado — Sin respuesta." };
  await registrarCambioDeEtapa({
    workspaceId: input.workspaceId,
    contactId: charla.contactId,
    conversationId: input.conversationId,
    etapaAnterior: "PERDIDO",
    etapaNueva: etapa,
    origen: "ASESORA",
    quien: input.usuario.id,
    nota: "deshacer descarte de Recuperación 72 h",
  });
  const recuperacion = (datos.recuperacion && typeof datos.recuperacion === "object" ? datos.recuperacion : {}) as Record<string, unknown>;
  await registrarEventos(charla, [
    {
      tipo: "RECUPERACION_72H",
      origen: "asesora",
      claveUnica: `REC:activo:${input.conversationId}:${typeof recuperacion.entradaEn === "string" ? recuperacion.entradaEn.slice(0, 16) : ahora.toISOString()}:deshecho`,
      createdAt: ahora,
      datos: { modo: "activo", fase: "deshecho", por: input.usuario.id, etapa, ...recuperacion },
    },
  ]);
  await recordConversationActivity({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    channelId: charla.channelId,
    contactId: charla.contactId,
    kind: "stage_changed",
    actorUserId: input.usuario.id,
    origen: "recuperacion-72h",
    text: `${input.usuario.nombre} deshizo el descarte de la Recuperación 72 h: vuelve a ${etapa}.`,
  }).catch(() => undefined);
  return { ok: true };
}

/** Las recuperaciones que ya se cerraron a mano (deshecho / mantener): esa entrada no vuelve a descartar. */
export async function recuperacionesCerradasAMano(conversationId: string): Promise<string[]> {
  const filas = await prisma.embudoEvento.findMany({
    where: { conversationId, tipo: "RECUPERACION_72H", createdAt: { gte: new Date(Date.now() - 60 * 86_400_000) } },
    select: { datos: true },
    take: 50,
  });
  return filas
    .map((f) => (f.datos ?? {}) as Record<string, unknown>)
    // "automatizacion": la atendió una automatización que le envió algo (cerrarRecuperacionPorAutomatizacion).
    .filter((d) => d.fase === "deshecho" || d.fase === "mantener" || d.fase === FASE_ATENDIDA_POR_AUTOMATIZACION)
    .map((d) => (typeof d.entradaEn === "string" ? d.entradaEn.slice(0, 16) : ""))
    .filter(Boolean);
}

/**
 * Una AUTOMATIZACIÓN le acaba de enviar un flujo o un texto a este contacto: si tenía pendiente la
 * tarea de la Recuperación 72 h, queda hecha (sale de Mi día, del tope y de las listas de
 * Recuperación) con una nota en el chat. Lo llama el motor de seguimientos DESPUÉS de que el envío
 * salió (un envío frenado por el anti-bloqueo no cierra nada). Nunca lanza.
 */
export async function cerrarRecuperacionPorAutomatizacion(input: {
  workspaceId: string;
  contactId: string;
  channelId: string | null;
  automatizacion: string;
  ahora?: Date;
}): Promise<boolean> {
  const ahora = input.ahora ?? new Date();
  try {
    const conversacion = await prisma.conversation.findFirst({
      where: { workspaceId: input.workspaceId, contactId: input.contactId, ...(input.channelId ? { channelId: input.channelId } : {}) },
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
      select: { id: true, channelId: true },
    });
    if (!conversacion) return false;
    const lead = await prisma.embudoLead.findFirst({
      where: { conversationId: conversacion.id, workspaceId: input.workspaceId },
      select: { accion: true, accionDatos: true },
    });
    const eventos = lead
      ? eventosDeCierrePorAutomatizacion({
          conversationId: conversacion.id,
          accion: lead.accion,
          accionDatos: (lead.accionDatos ?? null) as Record<string, unknown> | null,
          automatizacion: input.automatizacion,
          ahora,
        })
      : null;
    if (!eventos) return false;
    await registrarEventos(
      { workspaceId: input.workspaceId, conversationId: conversacion.id, contactId: input.contactId, channelId: conversacion.channelId },
      eventos.map((e) => ({ tipo: e.tipo, origen: "motor" as const, claveUnica: e.claveUnica ?? null, createdAt: ahora, datos: e.datos })),
    );
    await recordConversationActivity({
      workspaceId: input.workspaceId,
      conversationId: conversacion.id,
      channelId: conversacion.channelId,
      contactId: input.contactId,
      kind: "note",
      origen: "automatizacion",
      text: `Recuperación 72 h: atendida por la automatización «${input.automatizacion}» (se le envió el mensaje). Sale de la lista de llamadas; si el cliente responde, sigue el flujo normal.`,
    }).catch(() => undefined);
    return true;
  } catch (error) {
    anotarError("no se pudo cerrar la recuperacion por la automatizacion", error, { contactId: input.contactId });
    return false;
  }
}

/* ------------------------------------------------------------------------------------------------
   LISTAS (Mi día y Supervisor)
------------------------------------------------------------------------------------------------ */

export type RecuperacionDelLead = {
  conversationId: string;
  contactId: string;
  channelId: string | null;
  nombre: string;
  telefonoFinal: string | null;
  /** Para el botón Llamar de la propia asesora (no se muestra completo). */
  telefonoParaLlamar: string | null;
  accion: string;
  fase: string;
  prioridad: string;
  vence: Date | null;
  plazoEn: Date | null;
  llamadaEn: Date | null;
  audioEn: Date | null;
  fuerte: boolean;
  motivoFuerte: string | null;
  producto: string | null;
  mensajeSugerido: string | null;
  asesoraId: string | null;
  asesoraNombre: string | null;
  deNombre: string | null;
  topeEstado: string | null;
};

type FilaRec = {
  conversationId: string;
  contactId: string;
  channelId: string | null;
  nombre: string | null;
  telefono: string | null;
  metadata: unknown;
  accion: string | null;
  tareaPrioridad: string | null;
  tareaVence: Date | null;
  accionDatos: Record<string, unknown> | null;
  productoInteres: string | null;
  asesoraId: string | null;
  asesoraNombre: string | null;
  deNombre: string | null;
};

function fecha(valor: unknown): Date | null {
  if (typeof valor !== "string") return null;
  const f = new Date(valor);
  return Number.isNaN(f.getTime()) ? null : f;
}

function aRecuperacion(fila: FilaRec): RecuperacionDelLead {
  const datos = fila.accionDatos ?? {};
  const rec = (datos.recuperacion && typeof datos.recuperacion === "object" ? datos.recuperacion : {}) as Record<string, unknown>;
  const tope = (datos.tope && typeof datos.tope === "object" ? datos.tope : {}) as Record<string, unknown>;
  const telefono = (fila.telefono ?? "").replace(/\D/g, "");
  return {
    conversationId: fila.conversationId,
    contactId: fila.contactId,
    channelId: fila.channelId,
    nombre: fila.nombre?.trim() || "Cliente",
    telefonoFinal: telefono.length >= 7 && telefono.length <= 13 ? telefono.slice(-4) : null,
    telefonoParaLlamar: resolveCallablePhone({ phoneNumber: fila.telefono, metadata: fila.metadata }) ?? fila.telefono,
    accion: fila.accion ?? "",
    fase: typeof datos.toque === "string" ? datos.toque : "",
    prioridad: fila.tareaPrioridad ?? (typeof datos.prioridad === "string" ? datos.prioridad : "B"),
    vence: fila.tareaVence ? new Date(fila.tareaVence) : fecha(datos.vence),
    plazoEn: fecha(rec.plazoEn),
    llamadaEn: fecha(rec.llamadaEn),
    audioEn: fecha(rec.audioEn),
    fuerte: Boolean(rec.fuerte),
    motivoFuerte: typeof rec.motivoFuerte === "string" ? rec.motivoFuerte : null,
    producto: fila.productoInteres ? nombreDeFamilia(fila.productoInteres) : null,
    mensajeSugerido: typeof datos.mensajeSugerido === "string" ? datos.mensajeSugerido : null,
    asesoraId: fila.asesoraId,
    asesoraNombre: fila.asesoraNombre,
    deNombre: fila.deNombre,
    topeEstado: typeof tope.estado === "string" ? tope.estado : null,
  };
}

async function leerRecuperaciones(input: { workspaceId: string; asesoraId?: string; fases?: string[]; limite?: number }): Promise<RecuperacionDelLead[]> {
  // "Llamar solo las de 7 días o menos": las tareas con el cliente callado hace más van a reactivación.
  const config = await leerConfigSeguimiento(input.workspaceId).catch(() => null);
  const corte = config ? corteDeLaConfig(config) : null;
  const filas = await prisma.$queryRaw<FilaRec[]>(Prisma.sql`
    SELECT l."conversationId", c."contactId", c."channelId", ct."name" AS "nombre", ct."phoneNumber" AS "telefono", ct."metadata",
           l."accion", l."tareaPrioridad", l."tareaVence", l."accionDatos", l."productoInteres",
           c."assignedToUserId" AS "asesoraId", u."name" AS "asesoraNombre", de."name" AS "deNombre"
      FROM "EmbudoLead" l
      JOIN "Conversation" c ON c."id" = l."conversationId"
      JOIN "Contact" ct ON ct."id" = c."contactId"
      LEFT JOIN "User" u ON u."id" = c."assignedToUserId"
      LEFT JOIN "User" de ON de."id" = l."accionDatos"->'tope'->>'de'
     WHERE l."workspaceId" = ${input.workspaceId}
       AND l."accionDatos"->>'motivo' = ${MOTIVO_RECUPERACION}
       AND l."accionDatos"->>'modo' = 'activo'
       AND ct."crmStage"::text NOT IN ('GANADO', 'PERDIDO')
       ${SQL_CHAT_ABIERTO}
       ${filtroSinReactivar(corte)}
       ${input.fases?.length ? Prisma.sql`AND l."accionDatos"->>'toque' IN (${Prisma.join(input.fases)})` : Prisma.empty}
       ${
         input.asesoraId
           ? /*
               La tarea es de quien dice el plan del tope (la dueña o a quien se le pasó); lo que no es
               tarea (espera, antes de hora) y no tiene plan, de la dueña del chat.
             */
             Prisma.sql`AND (
               (l."accionDatos"->'tope' IS NULL AND c."assignedToUserId" = ${input.asesoraId})
               OR (l."accionDatos"->'tope'->>'para' = ${input.asesoraId} AND l."accionDatos"->'tope'->>'estado' IN ('propia', 'redistribuida'))
             )`
           : Prisma.empty
       }
     ORDER BY l."tareaPrioridad" ASC NULLS LAST, l."tareaVence" ASC NULLS LAST
     LIMIT ${input.limite ?? 60}`);
  return filas.map(aRecuperacion);
}

/** Mi día de una asesora: sus tareas (llamar / audio / segunda llamada) y lo que está en espera. */
export async function leerRecuperacionesDeAsesora(workspaceId: string, asesoraId: string): Promise<{ tareas: RecuperacionDelLead[]; enEspera: RecuperacionDelLead[] }> {
  const todas = await leerRecuperaciones({ workspaceId, asesoraId, fases: ["llamar", "audio", "llamar_2", "espera"], limite: 60 });
  return {
    tareas: todas.filter((r) => r.accion === "tarea_asesora"),
    enEspera: todas.filter((r) => r.accion !== "tarea_asesora" && r.fase === "espera"),
  };
}

/** Los de intención fuerte que esperan la aprobación del descarte (Supervisor y Mi día de la aprobadora). */
export async function leerAprobacionesPendientes(workspaceId: string): Promise<RecuperacionDelLead[]> {
  return leerRecuperaciones({ workspaceId, fases: ["aprobacion", "llamar_2"], limite: 40 });
}

export type ResumenDeRecuperacion = {
  modo: string;
  /** En curso ahora (solo activo): por fase. */
  enCurso: Record<string, number>;
  porAsesora: Array<{ asesora: string; llamar: number; audio: number; espera: number; segunda: number; aprobacion: number }>;
  /** Últimas 24 h (eventos; en sombra, lo que HABRÍA pasado). */
  hoy: { entraron: number; descartados: number; recuperados: number; fuertes: number; habriaDescartado: number };
  /** Descartados en las últimas 24 h (para deshacer). */
  descartados: Array<{ conversationId: string; nombre: string; telefonoFinal: string | null; en: Date; asesora: string | null }>;
  aprobaciones: RecuperacionDelLead[];
};

export async function resumenDeRecuperacion(workspaceId: string, modo: string, ahora = new Date()): Promise<ResumenDeRecuperacion> {
  const desde = new Date(ahora.getTime() - 86_400_000);
  const [enCurso, eventos, descartados, aprobaciones] = await Promise.all([
    modo === "activo" ? leerRecuperaciones({ workspaceId, limite: 500 }) : Promise.resolve([] as RecuperacionDelLead[]),
    prisma.$queryRaw<Array<{ fase: string | null; modo: string | null; fuerte: string | null; total: bigint | number }>>(Prisma.sql`
      SELECT e."datos"->>'fase' AS "fase", e."datos"->>'modo' AS "modo", e."datos"->>'fuerte' AS "fuerte", count(*) AS "total"
        FROM "EmbudoEvento" e
       WHERE e."workspaceId" = ${workspaceId} AND e."tipo" = 'RECUPERACION_72H' AND e."createdAt" > ${desde}
       GROUP BY 1, 2, 3`),
    prisma.$queryRaw<Array<{ conversationId: string; nombre: string | null; telefono: string | null; en: Date; asesora: string | null }>>(Prisma.sql`
      SELECT e."conversationId", ct."name" AS "nombre", ct."phoneNumber" AS "telefono", e."createdAt" AS "en", u."name" AS "asesora"
        FROM "EmbudoEvento" e
        JOIN "Conversation" c ON c."id" = e."conversationId"
        JOIN "Contact" ct ON ct."id" = c."contactId"
        LEFT JOIN "User" u ON u."id" = c."assignedToUserId"
       WHERE e."workspaceId" = ${workspaceId} AND e."tipo" = 'DESCARTE_CADENCIA' AND e."createdAt" > ${desde}
         AND e."datos"->>'motivo' = ${MOTIVO_RECUPERACION}
         AND ct."crmStage"::text = 'PERDIDO'
       ORDER BY e."createdAt" DESC LIMIT 30`),
    modo === "activo" ? leerAprobacionesPendientes(workspaceId) : Promise.resolve([] as RecuperacionDelLead[]),
  ]);
  const cuenta: Record<string, number> = {};
  const porAsesora = new Map<string, { asesora: string; llamar: number; audio: number; espera: number; segunda: number; aprobacion: number }>();
  for (const r of enCurso) {
    const clave = r.accion === "tarea_asesora" ? r.fase : r.fase === "llamar" ? "en_cola" : r.fase;
    cuenta[clave] = (cuenta[clave] ?? 0) + 1;
    const nombre = r.asesoraNombre ?? "Sin asesora";
    const fila = porAsesora.get(nombre) ?? { asesora: nombre, llamar: 0, audio: 0, espera: 0, segunda: 0, aprobacion: 0 };
    if (r.fase === "llamar") fila.llamar += 1;
    else if (r.fase === "audio") fila.audio += 1;
    else if (r.fase === "espera") fila.espera += 1;
    else if (r.fase === "llamar_2") fila.segunda += 1;
    else if (r.fase === "aprobacion") fila.aprobacion += 1;
    porAsesora.set(nombre, fila);
  }
  const hoy = { entraron: 0, descartados: 0, recuperados: 0, fuertes: 0, habriaDescartado: 0 };
  for (const e of eventos) {
    if (e.modo !== modo) continue;
    const n = Number(e.total);
    if (e.fase === "llamar") {
      hoy.entraron += n;
      if (e.fuerte === "true") hoy.fuertes += n;
    }
    if (e.fase === "descartado") hoy.descartados += n;
    if (e.fase === "recuperado") hoy.recuperados += n;
    if (e.fase === "descartar") hoy.habriaDescartado += n;
  }
  return {
    modo,
    enCurso: cuenta,
    porAsesora: [...porAsesora.values()].sort((a, b) => a.asesora.localeCompare(b.asesora)),
    hoy,
    descartados: descartados.map((d) => {
      const tel = (d.telefono ?? "").replace(/\D/g, "");
      return { conversationId: d.conversationId, nombre: d.nombre?.trim() || "Cliente", telefonoFinal: tel.length >= 7 ? tel.slice(-4) : null, en: new Date(d.en), asesora: d.asesora };
    }),
    aprobaciones,
  };
}

/** Para pasarla a la pantalla (fechas en ISO). */
export function comoVista(r: RecuperacionDelLead) {
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    conversationId: r.conversationId,
    contactId: r.contactId,
    channelId: r.channelId,
    nombre: r.nombre,
    telefonoFinal: r.telefonoFinal,
    telefonoParaLlamar: r.telefonoParaLlamar,
    fase: r.fase,
    prioridad: r.prioridad,
    vence: iso(r.vence),
    plazoEn: iso(r.plazoEn),
    llamadaEn: iso(r.llamadaEn),
    audioEn: iso(r.audioEn),
    fuerte: r.fuerte,
    motivoFuerte: r.motivoFuerte,
    producto: r.producto,
    mensajeSugerido: r.mensajeSugerido,
    asesoraNombre: r.asesoraNombre,
    deNombre: r.deNombre,
    topeEstado: r.topeEstado,
  };
}
