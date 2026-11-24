import { prisma } from "@/lib/prisma";

/**
 * QUÉ HIZO CADA PERSONA: respuestas, asignaciones, cambios de etapa, llamadas.
 *
 * Pedido de Alex (28-09-2026). Se arma leyendo lo que ya pasa por la app, con una condición que
 * empezó ese mismo día: cada acción guarda el ID de quien la hizo (`actorUserId` en las notas,
 * `enviadoPorUserId` en los mensajes). Antes el autor solo vivía dentro del texto —"Magilus asignó
 * a María"— y contar por persona significaba adivinar leyendo nombres.
 *
 * Por eso esto NO muestra historia vieja: lo de antes del 28-09-2026 no tiene a quién colgarse.
 *
 * TODAS las consultas van acotadas por fecha, y no es un detalle: leer `rawPayload->>'campo'` sobre
 * muchas filas obliga a Postgres a descomprimir el payload entero de cada una, y eso es lo que
 * convirtió una consulta de esta misma base en 61 segundos. Con el rango puesto, el índice de
 * fecha recorta primero y solo se descomprime lo que de verdad se va a mostrar.
 */

export type TipoDeActividad = "respuesta" | "asignacion" | "etapa" | "etiqueta" | "resuelto" | "nota" | "llamada";

export type EventoDeActividad = {
  cuando: Date;
  tipo: TipoDeActividad;
  /** Lo que pasó, en palabras. */
  texto: string;
  /** Para poder abrir el chat desde la lista. */
  conversationId: string | null;
  cliente: string | null;
};

export type ResumenDePersona = {
  userId: string;
  respuestas: number;
  asignaciones: number;
  etapas: number;
  llamadas: number;
  total: number;
};

/** Cuántos eventos se traen del detalle de una persona. Más que esto ya no se lee, se cuenta. */
const TOPE_DE_EVENTOS = 150;

const TIPO_POR_KIND: Record<string, TipoDeActividad> = {
  assigned: "asignacion",
  unassigned: "asignacion",
  stage_changed: "etapa",
  tag_added: "etiqueta",
  tag_removed: "etiqueta",
  resolved: "resuelto",
  reopened: "resuelto",
  note: "nota",
};

/**
 * El resumen de todo el equipo en un rango: cuántas de cada cosa hizo cada persona.
 *
 * Son cuatro consultas agrupadas y no una por persona: con seis asesoras, una por cabeza serían
 * veinticuatro viajes a la base para dibujar una tabla.
 */
export async function resumenDelEquipo(input: {
  workspaceId: string;
  desde: Date;
  hasta: Date;
}): Promise<Map<string, ResumenDePersona>> {
  const { workspaceId, desde, hasta } = input;

  const [respuestas, notas, llamadas] = await Promise.all([
    prisma.$queryRaw<Array<{ userId: string; cuantas: bigint }>>`
      SELECT m."rawPayload"->>'enviadoPorUserId' AS "userId", count(*) AS cuantas
      FROM "Message" m
      WHERE m."workspaceId" = ${workspaceId}
        AND m."createdAt" >= ${desde} AND m."createdAt" < ${hasta}
        AND m."direction" = 'OUTBOUND' AND m."type" <> 'SYSTEM'
        AND m."rawPayload"->>'enviadoPorUserId' IS NOT NULL
      GROUP BY 1
    `,
    prisma.$queryRaw<Array<{ userId: string; kind: string; cuantas: bigint }>>`
      SELECT m."rawPayload"->>'actorUserId' AS "userId", m."rawPayload"->>'kind' AS kind, count(*) AS cuantas
      FROM "Message" m
      WHERE m."workspaceId" = ${workspaceId}
        AND m."createdAt" >= ${desde} AND m."createdAt" < ${hasta}
        AND m."type" = 'SYSTEM'
        AND m."rawPayload"->>'actorUserId' IS NOT NULL
      GROUP BY 1, 2
    `,
    prisma.callAttempt.groupBy({
      by: ["calledByUserId"],
      where: { workspaceId, calledAt: { gte: desde, lt: hasta }, calledByUserId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const salida = new Map<string, ResumenDePersona>();
  const fila = (userId: string) => {
    const actual = salida.get(userId) ?? { userId, respuestas: 0, asignaciones: 0, etapas: 0, llamadas: 0, total: 0 };
    salida.set(userId, actual);
    return actual;
  };

  for (const r of respuestas) {
    fila(r.userId).respuestas += Number(r.cuantas);
  }
  for (const n of notas) {
    const destino = fila(n.userId);
    const tipo = TIPO_POR_KIND[n.kind ?? ""] ?? "nota";
    if (tipo === "asignacion") destino.asignaciones += Number(n.cuantas);
    else if (tipo === "etapa") destino.etapas += Number(n.cuantas);
  }
  for (const l of llamadas) {
    if (l.calledByUserId) fila(l.calledByUserId).llamadas += l._count._all;
  }

  for (const persona of salida.values()) {
    persona.total = persona.respuestas + persona.asignaciones + persona.etapas + persona.llamadas;
  }
  return salida;
}

/** El detalle de una persona: qué hizo, en orden, con el chat al que corresponde. */
export async function eventosDePersona(input: {
  workspaceId: string;
  userId: string;
  desde: Date;
  hasta: Date;
}): Promise<EventoDeActividad[]> {
  const { workspaceId, userId, desde, hasta } = input;

  const [mensajes, llamadas] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        createdAt: Date;
        tipoDeMensaje: string;
        kind: string | null;
        esNota: boolean;
        content: string | null;
        conversationId: string | null;
        cliente: string | null;
      }>
    >`
      SELECT m."createdAt",
             m."type"::text AS "tipoDeMensaje",
             m."rawPayload"->>'kind' AS kind,
             (m."type" = 'SYSTEM') AS "esNota",
             m."content",
             m."conversationId",
             coalesce(c."name", c."phoneNumber") AS cliente
      FROM "Message" m
      LEFT JOIN "Contact" c ON c."id" = m."contactId"
      WHERE m."workspaceId" = ${workspaceId}
        AND m."createdAt" >= ${desde} AND m."createdAt" < ${hasta}
        AND m."direction" = 'OUTBOUND'
        AND (
          (m."type" <> 'SYSTEM' AND m."rawPayload"->>'enviadoPorUserId' = ${userId})
          OR (m."type" = 'SYSTEM' AND m."rawPayload"->>'actorUserId' = ${userId})
        )
      ORDER BY m."createdAt" DESC
      LIMIT ${TOPE_DE_EVENTOS}
    `,
    prisma.callAttempt.findMany({
      where: { workspaceId, calledByUserId: userId, calledAt: { gte: desde, lt: hasta } },
      orderBy: { calledAt: "desc" },
      take: TOPE_DE_EVENTOS,
      select: {
        calledAt: true,
        result: true,
        contact: { select: { name: true, phoneNumber: true } },
      },
    }),
  ]);

  const eventos: EventoDeActividad[] = [];

  for (const m of mensajes) {
    const cliente = m.cliente?.trim() || null;
    if (!m.esNota) {
      const texto = (m.content ?? "").trim();
      eventos.push({
        cuando: m.createdAt,
        tipo: "respuesta",
        // Un audio o una foto no traen texto: se dice qué fue en vez de dejar la línea vacía.
        texto: texto ? texto.slice(0, 160) : `Envió ${etiquetaDeTipo(m.tipoDeMensaje)}`,
        conversationId: m.conversationId,
        cliente,
      });
      continue;
    }
    eventos.push({
      cuando: m.createdAt,
      tipo: TIPO_POR_KIND[m.kind ?? ""] ?? "nota",
      texto: (m.content ?? "").trim().slice(0, 160),
      conversationId: m.conversationId,
      cliente,
    });
  }

  for (const l of llamadas) {
    eventos.push({
      cuando: l.calledAt,
      tipo: "llamada",
      texto: `Llamó · ${l.result}`,
      conversationId: null,
      cliente: l.contact?.name?.trim() || l.contact?.phoneNumber || null,
    });
  }

  return eventos.sort((a, b) => b.cuando.getTime() - a.cuando.getTime()).slice(0, TOPE_DE_EVENTOS);
}

function etiquetaDeTipo(tipo: string): string {
  switch (tipo) {
    case "AUDIO":
      return "un audio";
    case "IMAGE":
      return "una foto";
    case "VIDEO":
      return "un video";
    case "DOCUMENT":
      return "un documento";
    case "LOCATION":
      return "una ubicación";
    default:
      return "un mensaje";
  }
}
