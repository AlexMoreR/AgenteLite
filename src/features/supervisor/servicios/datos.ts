import { Prisma } from "@prisma/client";

import { leerHistorialDelLibro, leerLibro } from "@/features/agente-v3/servicios/almacen";
import type { LibroDeReglas } from "@/features/agente-v3/domain/reglas";
import { leerConfigEmbudo } from "@/features/embudo/servicios/config";
import { getFlowReply } from "@/lib/agent-product-flow";
import { estaResuelto } from "@/lib/chat-resuelto";
import { prisma } from "@/lib/prisma";
import { isMarkedAsLid, readDiscoveredPhone } from "@/lib/whatsapp-lid";

import { turnoDeLaConversacion, type EventoDelChat, type TurnoDeLaConversacion } from "@/lib/turno-de-la-conversacion";

import { esCaliente, ORIGEN_EN_ESPERA, ORIGEN_FIN_DE_ESPERA, type ChatAbierto } from "../dominio/detectores-atencion";
import { motivoDeExclusion } from "../dominio/exclusiones";
import type { FlujoConocido } from "../dominio/guardian";
import { fichaDelLead, type FichaDelLead, type MensajeDelSupervisor } from "../dominio/lead";
import type { CambioDelLibro } from "../dominio/tipos";

/**
 * LO QUE EL SUPERVISOR LEE DE LA BASE. Solo lectura: ninguna función de este archivo escribe.
 *
 * Las líneas vigiladas son las que atiende el agente V3 (WhatsAppChannel.metadata.agenteV3 = true),
 * igual que el aviso de "cliente esperando".
 */

const DIA = 24 * 3_600_000;

async function lineasDelV3(workspaceId: string): Promise<string[]> {
  const canales = await prisma.whatsAppChannel.findMany({
    where: { workspaceId, metadata: { path: ["agenteV3"], equals: true } },
    select: { id: true },
  });
  return canales.map((canal) => canal.id);
}

type FilaDeMensaje = {
  conversationId: string;
  id: string;
  direction: string;
  type: string;
  content: string | null;
  transcripcion: string | null;
  createdAt: Date;
  source: string | null;
  kind: string | null;
  assigneeUserId: string | null;
  enviadoPorUserId: string | null;
};

/**
 * Las fichas de los leads que entraron en los últimos `dias` (16 por defecto: 14 de base + 2 de
 * observación). Dos consultas: conversaciones y mensajes (con el índice por conversación y fecha).
 * El texto se recorta a 600 caracteres: para los detectores alcanza y la consulta pesa menos.
 */
export async function leerFichasRecientes(input: {
  workspaceId: string;
  ahora: Date;
  dias?: number;
  versionEn?: (cuando: Date) => number | null;
}): Promise<FichaDelLead[]> {
  const lineas = await lineasDelV3(input.workspaceId);
  if (lineas.length === 0) return [];
  const desde = new Date(input.ahora.getTime() - (input.dias ?? 16) * DIA);
  const config = await leerConfigEmbudo(input.workspaceId);

  const conversaciones = await prisma.conversation.findMany({
    where: { workspaceId: input.workspaceId, channelId: { in: lineas }, createdAt: { gte: desde } },
    select: { id: true, assignedToUserId: true, contact: { select: { metadata: true, crmStage: true } } },
  });
  if (conversaciones.length === 0) return [];

  const filas = await prisma.$queryRaw<FilaDeMensaje[]>(Prisma.sql`
    SELECT m."conversationId", m."id", m."direction"::text AS "direction", m."type"::text AS "type",
           left(m."content", 600) AS "content", left(m."transcripcion", 400) AS "transcripcion", m."createdAt",
           m."rawPayload"->>'source' AS "source", m."rawPayload"->>'kind' AS "kind",
           m."rawPayload"->>'assigneeUserId' AS "assigneeUserId", m."rawPayload"->>'enviadoPorUserId' AS "enviadoPorUserId"
      FROM "Message" m
     WHERE m."conversationId" IN (${Prisma.join(conversaciones.map((c) => c.id))})
       AND m."createdAt" >= ${desde}
     ORDER BY m."conversationId", m."createdAt"`);

  const porChat = new Map<string, MensajeDelSupervisor[]>();
  for (const fila of filas) {
    const lista = porChat.get(fila.conversationId) ?? [];
    lista.push({ ...fila, createdAt: new Date(fila.createdAt) });
    porChat.set(fila.conversationId, lista);
  }

  const fichas: FichaDelLead[] = [];
  for (const conversacion of conversaciones) {
    const meta = (conversacion.contact?.metadata ?? {}) as Record<string, unknown>;
    const titulo = typeof meta.adTitle === "string" ? meta.adTitle : null;
    const anuncioId = typeof meta.adSourceId === "string" ? meta.adSourceId : null;
    const ficha = fichaDelLead(conversacion.id, porChat.get(conversacion.id) ?? [], {
      config,
      anuncio: titulo || anuncioId ? { titulo, id: anuncioId } : null,
      asesoraId: conversacion.assignedToUserId,
      versionEn: input.versionEn,
    });
    if (ficha) {
      ficha.etapa = conversacion.contact?.crmStage ?? null;
      fichas.push(ficha);
    }
  }
  return fichas;
}

type FilaDeChat = {
  conversationId: string;
  asesoraId: string | null;
  asesoraNombre: string | null;
  etapa: string | null;
  pausado: boolean | null;
  ultimoClienteEn: Date | null;
  ultimaRespuestaHumanaEn: Date | null;
  textos: string[] | null;
  textosCliente: string[] | null;
  telefono: string | null;
  metadata: unknown;
  dormidoHasta: Date | null;
  asignadaEn: Date | null;
  asignadaA: string | null;
  temperatura: string | null;
  nombreCliente: string | null;
  /** Los últimos 40 mensajes y notas (JSON): turno y "solo acusa recibo de un acuerdo". */
  eventos?: Array<{ d: string; t: string; o: string | null; x: string | null; en: string }> | null;
  /** Solo con `conRespuestaDeLaAsesora`: lo que escribió la asesora asignada y el último "En espera". */
  primeraRespuestaAsesoraEn?: Date | null;
  ultimaRespuestaAsesoraEn?: Date | null;
  esperaEn?: Date | null;
  esperaOrigen?: string | null;
};

/** Un timestamp de Postgres "sin zona" dentro de un JSON es UTC. */
function fechaUtc(texto: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(texto) ? texto : `${texto}Z`);
}

/** Los últimos 40 mensajes y notas de cada chat: turno (con su interruptor) y acuse con acuerdo (siempre). */
const LATERAL_EVENTOS_DEL_TURNO = Prisma.sql`
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('d', e."d", 't', e."t", 'o', e."o", 'x', e."x", 'en', e."createdAt") ORDER BY e."createdAt") AS "eventos" FROM (
          SELECT m."direction"::text AS "d", m."type"::text AS "t", m."rawPayload"->>'source' AS "o",
                 left(coalesce(nullif(m."transcripcion", ''), m."content", ''), 400) AS "x", m."createdAt"
            FROM "Message" m
           WHERE m."conversationId" = c."id"
           ORDER BY m."createdAt" DESC LIMIT 40) e) ev ON true`;


/**
 * Lo que escribió la asesora ASIGNADA y el último "En espera" de cada chat. Cuenta un mensaje desde
 * el CRM con su usuario (o sin usuario guardado) o desde el celular pasado el primer minuto del chat,
 * y solo desde que le llegó el chat (si la nota de asignación es de otra asesora, no se filtra por
 * fecha). El bot, los flujos, los seguimientos, las notas y otra persona del equipo no cuentan.
 */
const LATERAL_RESPUESTA_DE_LA_ASESORA = Prisma.sql`
      LEFT JOIN LATERAL (
        SELECT m."createdAt" FROM "Message" m WHERE m."conversationId" = c."id" ORDER BY m."createdAt" ASC LIMIT 1) ini ON true
      LEFT JOIN LATERAL (
        SELECT min(m."createdAt") AS "primera", max(m."createdAt") AS "ultima" FROM "Message" m
         WHERE c."assignedToUserId" IS NOT NULL AND m."conversationId" = c."id" AND m."direction" = 'OUTBOUND'
           AND m."type"::text <> 'SYSTEM'
           AND ((m."rawPayload"->>'source' = 'manual'
                 AND (m."rawPayload"->>'enviadoPorUserId' IS NULL OR m."rawPayload"->>'enviadoPorUserId' = c."assignedToUserId"))
             OR (m."rawPayload"->>'source' = 'instance'
                 AND m."createdAt" >= ini."createdAt" + interval '60 seconds'))
           AND (asg."createdAt" IS NULL OR (asg."asignadaA" IS NOT NULL AND asg."asignadaA" <> c."assignedToUserId")
                OR m."createdAt" >= asg."createdAt")) ase ON true
      LEFT JOIN LATERAL (
        SELECT m."createdAt", m."rawPayload"->>'origen' AS "origen" FROM "Message" m
         WHERE m."conversationId" = c."id" AND m."type"::text = 'SYSTEM'
           AND m."rawPayload"->>'origen' IN (${ORIGEN_EN_ESPERA}, ${ORIGEN_FIN_DE_ESPERA})
         ORDER BY m."createdAt" DESC LIMIT 1) esp ON true`;

const COLUMNAS_RESPUESTA_DE_LA_ASESORA = Prisma.sql`,
           ase."primera" AS "primeraRespuestaAsesoraEn", ase."ultima" AS "ultimaRespuestaAsesoraEn",
           esp."createdAt" AS "esperaEn", esp."origen" AS "esperaOrigen"`;

/** Los mensajes y notas de la fila, como eventos del chat. */
function eventosDeLaFila(fila: Pick<FilaDeChat, "eventos">): EventoDelChat[] {
  return (fila.eventos ?? []).map((e) => ({
    direccion: e.d === "INBOUND" ? "IN" : "OUT",
    tipo: e.t,
    origen: e.o,
    texto: e.x,
    en: fechaUtc(e.en),
  }));
}

/** El turno de un chat a partir de su fila (lib/turno-de-la-conversacion.ts). */
export function turnoDeLaFila(fila: Pick<FilaDeChat, "eventos" | "etapa" | "temperatura" | "asesoraId" | "ultimaRespuestaHumanaEn" | "textos">): TurnoDeLaConversacion {
  return turnoDeLaConversacion(eventosDeLaFila(fila), {
    caliente: esCaliente({ etapa: fila.etapa, temperatura: fila.temperatura }),
    asignada: Boolean(fila.asesoraId),
    tuvoContactoHumano: Boolean(fila.ultimaRespuestaHumanaEn),
  });
}

/** Lo de las exclusiones (exterior, LID, dormido) desde las columnas de la fila. */
function datosDeExclusion(fila: { telefono: string | null; metadata: unknown; dormidoHasta: Date | null }) {
  return {
    telefono: fila.telefono,
    metadata: fila.metadata,
    esLid: isMarkedAsLid(fila.metadata),
    telefonoDescubierto: readDiscoveredPhone(fila.metadata),
    dormidoHasta: fila.dormidoHasta ? new Date(fila.dormidoHasta) : null,
  };
}

type FilaDeExclusion = {
  conversationId: string;
  etapa: string | null;
  telefono: string | null;
  metadata: unknown;
  dormidoHasta: Date | null;
  ultimoClienteEn: Date | null;
  ultimaRespuestaHumanaEn: Date | null;
  textosCliente: string[] | null;
  estado: string | null;
};

/** Los últimos 20 textos del cliente (para no tratar como "del exterior" a quien nombra una ciudad de Colombia). */
const LATERAL_TEXTOS_DEL_CLIENTE = Prisma.sql`
      LEFT JOIN LATERAL (
        SELECT array_agg(left(coalesce(nullif(u20."transcripcion", ''), u20."content", ''), 200)) AS "textosCliente" FROM (
          SELECT m."transcripcion", m."content" FROM "Message" m
           WHERE m."conversationId" = c."id" AND m."direction" = 'INBOUND' AND m."type"::text <> 'SYSTEM'
           ORDER BY m."createdAt" DESC LIMIT 20) u20) todos ON true`;

/**
 * Los chats (de las alertas de atención abiertas) que ya no son tarea: PERDIDO/GANADO, resueltos, fuera de
 * Colombia, dormidos o ya respondidos por una persona. UNA consulta, solo dentro del negocio.
 */
export async function chatsExcluidosDeAtencion(workspaceId: string, ids: string[], ahora: Date): Promise<Set<string>> {
  const unicos = [...new Set(ids)].filter(Boolean);
  if (unicos.length === 0) return new Set();
  const filas = await prisma.$queryRaw<FilaDeExclusion[]>(Prisma.sql`
    SELECT c."id" AS "conversationId", ct."crmStage"::text AS "etapa", ct."phoneNumber" AS "telefono", ct."metadata",
           l."dormidoHasta", cli."createdAt" AS "ultimoClienteEn", hum."createdAt" AS "ultimaRespuestaHumanaEn", todos."textosCliente",
           c."status"::text AS "estado"
      FROM "Conversation" c
      JOIN "Contact" ct ON ct."id" = c."contactId"
      LEFT JOIN "EmbudoLead" l ON l."conversationId" = c."id"
      LEFT JOIN LATERAL (
        SELECT m."createdAt" FROM "Message" m
         WHERE m."conversationId" = c."id" AND m."direction" = 'INBOUND' AND m."type"::text <> 'SYSTEM'
         ORDER BY m."createdAt" DESC LIMIT 1) cli ON true
      LEFT JOIN LATERAL (
        SELECT m."createdAt" FROM "Message" m
         WHERE m."conversationId" = c."id" AND m."direction" = 'OUTBOUND' AND m."type"::text <> 'SYSTEM'
           AND m."rawPayload"->>'source' IN ('manual', 'instance')
         ORDER BY m."createdAt" DESC LIMIT 1) hum ON true
      ${LATERAL_TEXTOS_DEL_CLIENTE}
     WHERE c."workspaceId" = ${workspaceId} AND c."id" IN (${Prisma.join(unicos)})`);
  const excluidos = new Set<string>();
  for (const fila of filas) {
    const motivo = motivoDeExclusion(
      {
        etapa: fila.etapa,
        resuelto: estaResuelto(fila.estado),
        ...datosDeExclusion(fila),
        ultimoClienteEn: fila.ultimoClienteEn ? new Date(fila.ultimoClienteEn) : null,
        ultimaRespuestaHumanaEn: fila.ultimaRespuestaHumanaEn ? new Date(fila.ultimaRespuestaHumanaEn) : null,
        textos: fila.textosCliente ?? [],
      },
      ahora,
    );
    if (motivo) excluidos.add(fila.conversationId);
  }
  return excluidos;
}

/**
 * Los chats abiertos de las líneas del V3 con movimiento en 72 h, con lo que hace falta para el
 * chequeo de atención: último mensaje del cliente, última respuesta humana y los textos del
 * cliente desde entonces. UNA consulta (con LATERAL por chat sobre el índice conversationId+fecha).
 */
export async function leerChatsAbiertos(input: {
  workspaceId: string;
  ahora: Date;
  /** Interruptor `turno:config`: lee los últimos mensajes y notas y calcula de quién es el turno. */
  conTurno?: boolean;
  /** Lee también si la asesora asignada ya le escribió al cliente y si el chat está "En espera" (vigilante de reasignación). */
  conRespuestaDeLaAsesora?: boolean;
}): Promise<ChatAbierto[]> {
  const lineas = await lineasDelV3(input.workspaceId);
  if (lineas.length === 0) return [];
  const desde = new Date(input.ahora.getTime() - 3 * DIA);
  const filas = await prisma.$queryRaw<FilaDeChat[]>(Prisma.sql`
    SELECT c."id" AS "conversationId", c."assignedToUserId" AS "asesoraId", u."name" AS "asesoraNombre",
           ct."crmStage"::text AS "etapa", c."automationPaused" AS "pausado",
           cli."createdAt" AS "ultimoClienteEn", hum."createdAt" AS "ultimaRespuestaHumanaEn", txt."textos",
           ct."phoneNumber" AS "telefono", ct."metadata", l."dormidoHasta", todos."textosCliente",
           asg."createdAt" AS "asignadaEn", asg."asignadaA", l."temperatura", ct."name" AS "nombreCliente",
           ev."eventos"${input.conRespuestaDeLaAsesora ? COLUMNAS_RESPUESTA_DE_LA_ASESORA : Prisma.empty}
      FROM "Conversation" c
      JOIN "Contact" ct ON ct."id" = c."contactId"
      LEFT JOIN "User" u ON u."id" = c."assignedToUserId"
      LEFT JOIN "EmbudoLead" l ON l."conversationId" = c."id"
      LEFT JOIN LATERAL (
        SELECT m."createdAt", m."rawPayload"->>'assigneeUserId' AS "asignadaA" FROM "Message" m
         WHERE c."assignedToUserId" IS NOT NULL AND m."conversationId" = c."id" AND m."type"::text = 'SYSTEM'
           AND m."rawPayload"->>'kind' = 'assigned'
         ORDER BY m."createdAt" DESC LIMIT 1) asg ON true
      LEFT JOIN LATERAL (
        SELECT m."createdAt" FROM "Message" m
         WHERE m."conversationId" = c."id" AND m."direction" = 'INBOUND' AND m."type"::text <> 'SYSTEM'
         ORDER BY m."createdAt" DESC LIMIT 1) cli ON true
      LEFT JOIN LATERAL (
        SELECT m."createdAt" FROM "Message" m
         WHERE m."conversationId" = c."id" AND m."direction" = 'OUTBOUND' AND m."type"::text <> 'SYSTEM'
           AND m."rawPayload"->>'source' IN ('manual', 'instance')
         ORDER BY m."createdAt" DESC LIMIT 1) hum ON true
      LEFT JOIN LATERAL (
        SELECT array_agg(t."texto" ORDER BY t."createdAt") AS "textos" FROM (
          SELECT left(coalesce(nullif(m."transcripcion", ''), m."content", ''), 300) AS "texto", m."createdAt"
            FROM "Message" m
           WHERE m."conversationId" = c."id" AND m."direction" = 'INBOUND' AND m."type"::text <> 'SYSTEM'
             AND (hum."createdAt" IS NULL OR m."createdAt" > hum."createdAt")
           ORDER BY m."createdAt" DESC LIMIT 5) t) txt ON true
      ${LATERAL_TEXTOS_DEL_CLIENTE}
      ${LATERAL_EVENTOS_DEL_TURNO}
      ${input.conRespuestaDeLaAsesora ? LATERAL_RESPUESTA_DE_LA_ASESORA : Prisma.empty}
     WHERE c."channelId" IN (${Prisma.join(lineas)})
       AND c."status" = 'OPEN'
       AND c."lastMessageAt" >= ${desde}`);
  return filas.map((fila) => ({
    conversationId: fila.conversationId,
    asesoraId: fila.asesoraId,
    asesoraNombre: fila.asesoraNombre,
    etapa: fila.etapa,
    pausado: Boolean(fila.pausado),
    ultimoClienteEn: fila.ultimoClienteEn ? new Date(fila.ultimoClienteEn) : null,
    ultimaRespuestaHumanaEn: fila.ultimaRespuestaHumanaEn ? new Date(fila.ultimaRespuestaHumanaEn) : null,
    textosPendientes: fila.textos ?? [],
    textosDelCliente: fila.textosCliente ?? [],
    ...datosDeExclusion(fila),
    // Solo cuenta la asignación a la asesora ACTUAL (si la nota es de otra, no se sabe desde cuándo).
    asignadaEn: fila.asignadaEn && (!fila.asignadaA || fila.asignadaA === fila.asesoraId) ? new Date(fila.asignadaEn) : null,
    temperatura: fila.temperatura,
    nombreCliente: fila.nombreCliente,
    mensajes: eventosDeLaFila(fila),
    ...(input.conTurno ? { turno: turnoDeLaFila(fila) } : {}),
    ...(input.conRespuestaDeLaAsesora
      ? {
          primeraRespuestaAsesoraEn: fila.primeraRespuestaAsesoraEn ? new Date(fila.primeraRespuestaAsesoraEn) : null,
          ultimaRespuestaAsesoraEn: fila.ultimaRespuestaAsesoraEn ? new Date(fila.ultimaRespuestaAsesoraEn) : null,
          enEsperaDesde: fila.esperaOrigen === ORIGEN_EN_ESPERA && fila.esperaEn ? new Date(fila.esperaEn) : null,
        }
      : {}),
  }));
}

export type LineaDelLibro = {
  actual: LibroDeReglas;
  /** Versión → libro (las que guarda el historial, hasta 30, más la actual). */
  libros: Map<number, LibroDeReglas>;
  cambios: CambioDelLibro[];
  versionEn: (cuando: Date) => number | null;
};

/** El libro actual, su historial y la lista de cambios con fecha (del historial que ya existe). */
export async function leerLineaDelLibro(workspaceId: string): Promise<LineaDelLibro> {
  const [actual, historial] = await Promise.all([leerLibro(workspaceId), leerHistorialDelLibro(workspaceId)]);
  const libros = new Map<number, LibroDeReglas>();
  for (const fila of historial) libros.set(fila.version, { ...fila.libro, version: fila.version });
  libros.set(actual.version, actual);
  // El historial guarda la versión ANTERIOR con la hora del cambio: la N+1 rige desde ese `at`.
  const cambios: CambioDelLibro[] = historial
    .map((fila) => ({ version: fila.version + 1, anterior: fila.version, en: new Date(fila.at), autor: fila.autor ?? null, resumen: fila.resumen ?? null }))
    .filter((cambio) => libros.has(cambio.version))
    .sort((a, b) => a.en.getTime() - b.en.getTime());
  const versionEn = (cuando: Date) => {
    let version: number | null = cambios[0]?.anterior ?? actual.version;
    for (const cambio of cambios) if (cambio.en.getTime() <= cuando.getTime()) version = cambio.version;
    return version;
  };
  return { actual, libros, cambios, versionEn };
}

/** Los flujos que nombra el libro, con sus pasos y textos (para que el Guardian vea lo que mandan). */
export async function leerFlujosDelLibro(workspaceId: string, libro: LibroDeReglas): Promise<Record<string, FlujoConocido>> {
  const ids = new Set<string>();
  for (const regla of libro.reglas) for (const accion of regla.entonces) if (accion.tipo === "flujo") ids.add(accion.flujoId);
  const salida: Record<string, FlujoConocido> = {};
  for (const id of ids) {
    const flujo = await getFlowReply({ workspaceId, flowId: id, includeOfficialApi: true }).catch(() => null);
    if (!flujo) continue;
    salida[id] = {
      pasos: flujo.steps.length,
      fotosOVideos: flujo.steps.filter((paso) => paso.kind === "image" || paso.kind === "video").length,
      textos: flujo.steps.flatMap((paso) => (paso.kind === "text" ? [paso.content] : paso.caption ? [paso.caption] : [])),
    };
  }
  return salida;
}

export async function nombresDeAsesoras(workspaceId: string): Promise<Record<string, string>> {
  const miembros = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: { userId: true, user: { select: { name: true } } },
  });
  return Object.fromEntries(miembros.map((m) => [m.userId, m.user?.name ?? m.userId]));
}

export type PausaAcordadaDelChat = {
  conversationId: string;
  nombre: string;
  telefonoFinal: string | null;
  asesoraNombre: string | null;
  /** Lo que dijo el cliente. */
  frase: string;
  /** La fecha en palabras ("finales de noviembre", "3 días"). */
  como: string | null;
  retomarEn: Date;
};

type FilaDePausa = {
  conversationId: string;
  nombre: string | null;
  telefono: string | null;
  asesoraNombre: string | null;
  dormidoHasta: Date;
  accionDatos: Record<string, unknown> | null;
};

/**
 * Los chats en "pausa acordada" (26-10-2026): filas de EmbudoLead con accion "dormido" y motivo
 * `pausa_acordada` que el motor del seguimiento inteligente dejó. Solo lectura, una consulta.
 */
export async function leerPausasAcordadas(workspaceId: string, ahora: Date): Promise<PausaAcordadaDelChat[]> {
  const filas = await prisma.$queryRaw<FilaDePausa[]>(Prisma.sql`
    SELECT l."conversationId", ct."name" AS "nombre", ct."phoneNumber" AS "telefono", u."name" AS "asesoraNombre",
           l."dormidoHasta", l."accionDatos"
      FROM "EmbudoLead" l
      JOIN "Conversation" c ON c."id" = l."conversationId"
      JOIN "Contact" ct ON ct."id" = c."contactId"
      LEFT JOIN "User" u ON u."id" = c."assignedToUserId"
     WHERE l."workspaceId" = ${workspaceId}
       AND l."accion" = 'dormido'
       AND l."accionDatos"->>'motivo' = 'pausa_acordada'
       AND l."dormidoHasta" > ${ahora}
       AND ct."crmStage"::text NOT IN ('GANADO', 'PERDIDO')
       AND c."status" = 'OPEN'
     ORDER BY l."dormidoHasta" ASC
     LIMIT 50`);
  return filas.map((fila) => {
    const datos = fila.accionDatos ?? {};
    const telefono = (fila.telefono ?? "").replace(/\D/g, "");
    return {
      conversationId: fila.conversationId,
      nombre: fila.nombre?.trim() || "Cliente",
      telefonoFinal: telefono.length >= 7 && telefono.length <= 13 ? telefono.slice(-4) : null,
      asesoraNombre: fila.asesoraNombre,
      frase: typeof datos.fechaFragmento === "string" ? datos.fechaFragmento : "",
      como: typeof datos.fechaComo === "string" ? datos.fechaComo : null,
      retomarEn: new Date(fila.dormidoHasta),
    };
  });
}
